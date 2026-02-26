import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./auth";

/** Express Request extended with user claims from Replit auth / demo auth */
interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    claims: {
      sub: string;
      email: string;
      first_name: string;
      last_name: string;
      profile_image_url: string | null;
      exp: number;
    };
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
  };
}
import { asyncHandler } from "./asyncHandler";
import { insertPrdSchema, users, aiPreferencesSchema } from "@shared/schema";
import { generatePRDContent } from "./anthropic";
import { exportToLinear, checkLinearConnection } from "./linearHelper";
import { exportToDart, updateDartDoc, checkDartConnection, getDartboards } from "./dartHelper";
import { generatePDF, generateWord } from "./exportUtils";
import { generateClaudeMD } from "./claudemdGenerator";
import { initializeTemplates } from "./initTemplates";
import { db, pool } from "./db";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { parsePRDToStructure } from "./prdParser";
import { computeCompleteness } from "./prdCompleteness";
import { setupWebSocket, broadcastPrdUpdate } from "./wsServer";
import type { PRDStructure } from "./prdStructure";
import { requirePrdAccess, requireEditablePrdId } from "./prdAccess";
import { isDartDocUpdateConsistent, normalizeDartDocId } from "./dartDocAccess";
import { buildPrdVersionSnapshot, getNextPrdVersionNumber } from "./prdVersioningUtils";
import { canUserAccessTemplate } from "./templateAccess";
import { collectCollaboratorIds, mapCollaboratorUsers } from "./collaborators";
import { validateApprovalReviewers } from "./approvalReviewers";
import { canShareWithUser, planShareAction } from "./sharePolicy";
import { logger } from "./logger";
import {
  updateUserSchema,
  createTemplateSchema,
  updatePrdSchema,
  requestApprovalSchema,
  respondApprovalSchema,
  sharePrdSchema,
} from "./schemas";

/**
 * Synchronizes PRD content header metadata with actual PRD data.
 * Updates Version and Status fields in the document if they exist.
 * Supports both English and German field names and values.
 */
export function syncPrdHeaderMetadata(
  content: string,
  versionNumber: string | null,
  status: string
): string {
  let updatedContent = content;

  // Map status to display format (with proper capitalization)
  const statusDisplayMap: Record<string, { en: string; de: string }> = {
    'draft': { en: 'Draft', de: 'Entwurf' },
    'in-progress': { en: 'In Progress', de: 'In Bearbeitung' },
    'review': { en: 'Review', de: 'Review' },
    'pending-approval': { en: 'Pending Approval', de: 'Ausstehende Genehmigung' },
    'approved': { en: 'Approved', de: 'Genehmigt' },
    'completed': { en: 'Completed', de: 'Abgeschlossen' }
  };

  const statusDisplay = statusDisplayMap[status] || { en: status, de: status };

  // Detect document language by checking for German status values
  const germanStatusValues = ['Entwurf', 'In Bearbeitung', 'Ausstehende Genehmigung', 'Genehmigt', 'Abgeschlossen'];
  const isGermanDocument = germanStatusValues.some(val => content.includes(val));
  const statusValue = isGermanDocument ? statusDisplay.de : statusDisplay.en;

  // Update Version field if present
  // Matches patterns like: Version: 0.5, Version: v8, Version : 1.0, **Version:** 2.0
  // Supports optional 'v' prefix and preserves any trailing annotations in parentheses
  if (versionNumber) {
    updatedContent = updatedContent.replace(
      /(\*{0,2}Version\*{0,2}\s*:\s*)(?:v\s*)?[\d.]+(\s*\([^)]*\))?/gi,
      `$1${versionNumber}$2`
    );
  }

  // Update Status field if present
  // Matches patterns like: Status: Draft, Status: Entwurf, **Status:** In Progress
  // Matches until end of line or next field to avoid over-matching
  updatedContent = updatedContent.replace(
    /(\*{0,2}Status\*{0,2}\s*:\s*)([\w\s\-äöüÄÖÜß]+?)(\n|$)/gi,
    `$1${statusValue}$3`
  );

  return updatedContent;
}

// Rate-limiter factory — reusable in-memory per-IP limiter
function createRateLimiter(maxRequests: number, windowMs: number = 60000) {
  const map = new Map<string, { count: number; resetAt: number }>();

  // Periodic cleanup every 60s to prevent unbounded growth
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, val] of map) {
      if (now >= val.resetAt) map.delete(key);
    }
  }, 60000);
  cleanupInterval.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = map.get(ip);
    if (entry && now < entry.resetAt) {
      if (entry.count >= maxRequests) {
        return res.status(429).json({ message: 'Too many requests' });
      }
      entry.count++;
    } else {
      map.set(ip, { count: 1, resetAt: now + windowMs });
    }
    next();
  };
}

const aiRateLimiter = createRateLimiter(5, 60000);     // 5 AI calls/min
const writeRateLimiter = createRateLimiter(30, 60000);  // 30 writes/min
const authRateLimiter = createRateLimiter(10, 60000);   // 10 auth attempts/min
const errorRateLimiter = createRateLimiter(10, 60000);  // 10 error reports/min

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize templates
  await initializeTemplates();
  
  // Auth middleware
  await setupAuth(app);

  // Health-check endpoint (no auth required)
  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'error', timestamp: new Date().toISOString() });
    }
  });

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = req.user.claims.sub;
    const user = await storage.getUser(userId);
    res.json(user);
  }));

  app.patch('/api/auth/user', isAuthenticated, authRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = req.user.claims.sub;
    const validated = updateUserSchema.parse(req.body);
    const user = await storage.updateUser(userId, validated);
    res.json(user);
  }));

  // AI Settings routes
  app.get('/api/settings/ai', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = req.user.claims.sub;
    const user = await db.select({
      aiPreferences: users.aiPreferences
    }).from(users).where(eq(users.id, userId)).limit(1);

    const stored = (user[0]?.aiPreferences as any) || {};
    const tier = stored.tier || 'production';
    const tierModels = stored.tierModels || {};
    const activeTierModels = tierModels[tier] || {};

    const preferences = {
      ...stored,
      tier,
      tierModels,
      generatorModel: activeTierModels.generatorModel || stored.generatorModel || 'google/gemini-2.5-flash',
      reviewerModel: activeTierModels.reviewerModel || stored.reviewerModel || 'anthropic/claude-sonnet-4',
      fallbackModel: activeTierModels.fallbackModel || stored.fallbackModel || 'deepseek/deepseek-r1-0528:free',
      iterativeTimeoutMinutes: stored.iterativeTimeoutMinutes || 30,
    };

    res.json(preferences);
  }));

  app.patch('/api/settings/ai', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = req.user.claims.sub;
    const preferences = aiPreferencesSchema.parse(req.body);

    const existing = await db.select({
      aiPreferences: users.aiPreferences
    }).from(users).where(eq(users.id, userId)).limit(1);
    const existingPrefs = (existing[0]?.aiPreferences as any) || {};
    const existingTierModels = existingPrefs.tierModels || {};

    const activeTier = preferences.tier || existingPrefs.tier || 'production';
    // Only override the active tier's models when fields are explicitly provided.
    // Without this guard, a PATCH with just {"tier":"development"} would overwrite
    // the development tier models with undefined → {}, losing the configuration.
    const tierUpdate: Record<string, string> = {};
    if (preferences.generatorModel) tierUpdate.generatorModel = preferences.generatorModel;
    if (preferences.reviewerModel) tierUpdate.reviewerModel = preferences.reviewerModel;
    if (preferences.fallbackModel) tierUpdate.fallbackModel = preferences.fallbackModel;

    const updatedTierModels = {
      ...existingTierModels,
      ...preferences.tierModels,
      [activeTier]: {
        ...(existingTierModels[activeTier] || {}),
        ...tierUpdate,
      },
    };

    const merged = {
      ...existingPrefs,
      ...preferences,
      tierModels: updatedTierModels,
    };

    await db.update(users)
      .set({
        aiPreferences: merged as any,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    res.json(merged);
  }));

  // Language Settings routes
  app.patch('/api/settings/language', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = req.user.claims.sub;

    // Validate language settings
    const languageSchema = z.object({
      uiLanguage: z.enum(['auto', 'en', 'de']).default('auto'),
      defaultContentLanguage: z.enum(['auto', 'en', 'de']).default('auto'),
    });

    const validated = languageSchema.parse(req.body);

    await db.update(users)
      .set({
        uiLanguage: validated.uiLanguage,
        defaultContentLanguage: validated.defaultContentLanguage,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    res.json(validated);
  }));

  // Dashboard routes
  app.get('/api/dashboard/stats', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = req.user.claims.sub;
    const stats = await storage.getDashboardStats(userId);
    res.json(stats);
  }));

  // PRD routes
  app.get('/api/prds', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = req.user.claims.sub;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const result = await storage.getPrds(userId, limit, offset);
    res.json(result);
  }));

  app.get('/api/prds/:id', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const prd = await requirePrdAccess(storage, req, res, id, 'view');
    if (!prd) return;

    res.json(prd);
  }));

  app.get('/api/prds/:id/collaborators', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const prd = await requirePrdAccess(storage, req, res, id, 'view');
    if (!prd) return;

    const shares = await storage.getPrdShares(id);
    const collaboratorIds = collectCollaboratorIds(prd.userId, shares);

    if (collaboratorIds.length === 0) {
      return res.json([]);
    }

    type CollaboratorRow = {
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      profileImageUrl: string | null;
    };
    const collaboratorRows: CollaboratorRow[] = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        profileImageUrl: users.profileImageUrl,
      })
      .from(users)
      .where(inArray(users.id, collaboratorIds));

    const usersById = new Map(collaboratorRows.map((u) => [u.id, u]));
    res.json(mapCollaboratorUsers(collaboratorIds, usersById));
  }));

  app.post('/api/prds', isAuthenticated, writeRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = req.user.claims.sub;
    const prdData = insertPrdSchema.parse({
      ...req.body,
      userId,
    });

    const prd = await storage.createPrd(prdData);
    res.json(prd);
  }));

  app.patch('/api/prds/:id', isAuthenticated, writeRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const prd = await requirePrdAccess(storage, req, res, id, 'edit');
    if (!prd) return;

    // Validate known fields; passthrough allows structuredContent etc.
    const validated = updatePrdSchema.parse(req.body);

    // If content is being updated, synchronize header metadata
    let updateData = { ...validated };
    if (updateData.content) {
      // Save raw incoming content BEFORE header sync for comparison
      const rawIncomingContent = updateData.content;

      // Get current version count to determine version number
      const versions = await storage.getPrdVersions(id);
      const versionNumber = getNextPrdVersionNumber(versions.length);
      const status = updateData.status || prd.status;

      // Sync the header metadata in the content
      updateData.content = syncPrdHeaderMetadata(
        updateData.content,
        versionNumber,
        status
      );

      // Only invalidate structuredContent when the user actually changed the content body.
      // Skip invalidation when the incoming content matches what's stored (e.g. frontend
      // saving back the same AI-generated content that the server already autosaved).
      if (!updateData.structuredContent && (prd as any).structuredContent) {
        const contentChanged = rawIncomingContent.trim() !== prd.content.trim();
        if (contentChanged) {
          updateData.structuredContent = null;
          updateData.structuredAt = null;
        }
      } else if (!updateData.structuredContent && !(prd as any).structuredContent) {
        // No existing structure to preserve - nothing to do
      }
    }

    const updated = await storage.updatePrd(id, updateData);
    res.json(updated);
    broadcastPrdUpdate(id, 'prd:updated');
  }));

  app.delete('/api/prds/:id', isAuthenticated, writeRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const prd = await storage.getPrd(id);
    if (!prd) return res.status(404).json({ message: "PRD not found" });
    if (prd.userId !== req.user.claims.sub) {
      return res.status(403).json({ message: "Only the owner can delete this PRD" });
    }
    await storage.deletePrd(id);
    res.json({ success: true });
  }));

  // Template routes
  app.get('/api/templates', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = req.user.claims.sub;
    const templates = await storage.getTemplates(userId);
    res.json(templates);
  }));

  app.get('/api/templates/:id', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const userId = req.user.claims.sub;
    const template = await storage.getTemplate(id);

    if (!template) {
      return res.status(404).json({ message: "Template not found" });
    }

    if (!canUserAccessTemplate(template, userId)) {
      return res.status(403).json({ message: "You don't have permission to access this template" });
    }

    res.json(template);
  }));

  app.post('/api/templates', isAuthenticated, writeRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = req.user.claims.sub;
    const validated = createTemplateSchema.parse(req.body);

    const template = await storage.createTemplate({
      name: validated.name,
      description: validated.description,
      category: validated.category,
      content: validated.content,
      userId,
      isDefault: 'false',
    });

    res.json(template);
  }));

  // Version routes
  app.get('/api/prds/:id/versions', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const prd = await requirePrdAccess(storage, req, res, id, 'view');
    if (!prd) return;

    const versions = await storage.getPrdVersions(id);
    res.json(versions);
  }));

  app.post('/api/prds/:id/versions', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const userId = req.user.claims.sub;
    const prd = await requirePrdAccess(storage, req, res, id, 'edit');
    if (!prd) return;

    const versions = await storage.getPrdVersions(id);
    const versionNumber = getNextPrdVersionNumber(versions.length);
    const version = await storage.createPrdVersion(
      buildPrdVersionSnapshot(prd as any, versionNumber, userId),
    );

    res.json(version);
  }));

  app.delete('/api/prds/:id/versions/:versionId', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id, versionId } = req.params;

    const prd = await requirePrdAccess(storage, req, res, id, 'edit');
    if (!prd) return;

    const version = await storage.getPrdVersion(versionId);
    if (!version) {
      return res.status(404).json({ message: "Version not found" });
    }

    if (version.prdId !== id) {
      return res.status(400).json({ message: "Version does not belong to this PRD" });
    }

    const versions = await storage.getPrdVersions(id);
    if (versions.length > 0 && versions[0].id === versionId) {
      return res.status(400).json({ message: "Cannot delete the current (latest) version" });
    }

    await storage.deletePrdVersion(versionId);
    res.json({ success: true });
  }));

  // Share routes
  app.post('/api/prds/:id/share', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const { email, permission } = sharePrdSchema.parse(req.body);

    // Only the owner can share a PRD
    const userId = req.user.claims.sub;
    const prd = await storage.getPrd(id);
    if (!prd) return res.status(404).json({ message: "PRD not found" });
    if (prd.userId !== userId) {
      return res.status(403).json({ message: "Only the owner can share this PRD" });
    }
    // Find user by email
    const sharedUser = await storage.getUserByEmail(email);
    if (!sharedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!canShareWithUser(userId, sharedUser.id)) {
      return res.status(400).json({ message: "You cannot share a PRD with yourself" });
    }

    const requestedPermission: "view" | "edit" = permission === "edit" ? "edit" : "view";
    const existingShares = await storage.getPrdShares(id);
    const existingShare = existingShares.find((share) => share.sharedWith === sharedUser.id);
    const action = planShareAction(existingShare, requestedPermission);

    if (action.type === "none" && existingShare) {
      return res.json(existingShare);
    }

    if (action.type === "update") {
      const updatedShare = await storage.updateSharedPrdPermission(action.shareId, action.permission);
      return res.json(updatedShare);
    }

    const share = await storage.createSharedPrd({
      prdId: id,
      sharedWith: sharedUser.id,
      permission: requestedPermission,
    });
    res.json(share);
  }));

  app.get('/api/prds/:id/shares', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const prd = await requirePrdAccess(storage, req, res, id, 'view');
    if (!prd) return;

    const shares = await storage.getPrdShares(id);
    res.json(shares);
  }));

  // Comment routes
  app.get('/api/prds/:id/comments', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const prd = await requirePrdAccess(storage, req, res, id, 'view');
    if (!prd) return;

    const commentsData = await storage.getComments(id);

    // Batch-fetch all unique users (avoids N+1 queries)
    const userIds = Array.from(new Set(commentsData.map((c: any) => c.userId)));
    const usersData: Array<{ id: string; firstName: string | null; lastName: string | null; email: string | null; profileImageUrl: string | null }> = userIds.length > 0
      ? await db.select().from(users).where(inArray(users.id, userIds))
      : [];
    const userMap = new Map(usersData.map(u => [u.id, u]));

    const commentsWithUsers = commentsData.map(comment => {
      const user = userMap.get(comment.userId);
      return {
        ...comment,
        user: user ? {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          profileImageUrl: user.profileImageUrl,
        } : null,
      };
    });

    res.json(commentsWithUsers);
  }));

  app.post('/api/prds/:id/comments', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const prd = await requirePrdAccess(storage, req, res, id, 'view');
    if (!prd) return;

    const userId = req.user.claims.sub;
    const { content, sectionId } = req.body;

    if (!content || content.trim() === '') {
      return res.status(400).json({ message: "Comment content is required" });
    }

    const comment = await storage.createComment({
      prdId: id,
      userId,
      content,
      sectionId: sectionId || null,
    });

    // Return comment with user info
    const user = await storage.getUser(userId);
    res.json({
      ...comment,
      user: user ? {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        profileImageUrl: user.profileImageUrl,
      } : null,
    });
    broadcastPrdUpdate(id, 'comment:added');
  }));

  // Approval routes
  app.get('/api/prds/:id/approval', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const prd = await requirePrdAccess(storage, req, res, id, 'view');
    if (!prd) return;

    const approval = await storage.getApproval(id);

    if (!approval) {
      return res.json(null);
    }

    // Batch-fetch requester + completer in one query (avoids N+1)
    const relatedUserIds = [approval.requestedBy, approval.completedBy].filter(Boolean) as string[];
    type UserRow = { id: string; firstName: string | null; lastName: string | null; email: string | null };
    const relatedUsers: UserRow[] = relatedUserIds.length > 0
      ? await db.select().from(users).where(inArray(users.id, relatedUserIds))
      : [];
    const userMap = new Map(relatedUsers.map(u => [u.id, u]));

    const requester = userMap.get(approval.requestedBy);
    const completer = approval.completedBy ? userMap.get(approval.completedBy) : null;

    res.json({
      ...approval,
      requester: requester ? {
        id: requester.id,
        firstName: requester.firstName,
        lastName: requester.lastName,
        email: requester.email,
      } : null,
      completer: completer ? {
        id: completer.id,
        firstName: completer.firstName,
        lastName: completer.lastName,
        email: completer.email,
      } : null,
    });
  }));

  app.post('/api/prds/:id/approval/request', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const prd = await requirePrdAccess(storage, req, res, id, 'edit');
    if (!prd) return;

    const userId = req.user.claims.sub;
    const { reviewers } = requestApprovalSchema.parse(req.body);

    // Check if there's already a pending approval
    const existingApproval = await storage.getApproval(id);
    if (existingApproval && existingApproval.status === 'pending') {
      return res.status(400).json({ message: "There is already a pending approval request" });
    }

    const shares = await storage.getPrdShares(id);
    const { normalizedReviewerIds, unauthorizedReviewerIds } = validateApprovalReviewers(
      reviewers,
      prd.userId,
      shares,
    );

    if (normalizedReviewerIds.length === 0) {
      return res.status(400).json({ message: "At least one valid reviewer is required" });
    }

    if (unauthorizedReviewerIds.length > 0) {
      return res.status(400).json({ message: "All reviewers must already have access to this PRD" });
    }

    const approval = await storage.createApproval({
      prdId: id,
      requestedBy: userId,
      reviewers: normalizedReviewerIds,
      status: 'pending',
    });

    // Update PRD status to pending-approval
    await storage.updatePrd(id, { status: 'pending-approval' });

    // Return approval with requester info
    const requester = await storage.getUser(userId);
    res.json({
      ...approval,
      requester: requester ? {
        id: requester.id,
        firstName: requester.firstName,
        lastName: requester.lastName,
        email: requester.email,
      } : null,
    });
  }));

  app.post('/api/prds/:id/approval/respond', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const userId = req.user.claims.sub;
    const { approved } = respondApprovalSchema.parse(req.body);

    const prd = await requirePrdAccess(storage, req, res, id, 'view');
    if (!prd) return;

    const approval = await storage.getApproval(id);
    if (!approval) {
      return res.status(404).json({ message: "No approval request found" });
    }

    if (approval.status !== 'pending') {
      return res.status(400).json({ message: "Approval request is no longer pending" });
    }

    // Check if user is a reviewer
    if (!approval.reviewers.includes(userId)) {
      return res.status(403).json({ message: "You are not a reviewer for this PRD" });
    }

    const newStatus = approved ? 'approved' : 'rejected';
    const updatedApproval = await storage.updateApproval(approval.id, {
      status: newStatus,
      completedBy: userId,
      completedAt: new Date(),
    });

    // Update PRD status
    const prdStatus = approved ? 'approved' : 'review';
    await storage.updatePrd(id, { status: prdStatus });

    // Return approval with completer info
    const completer = await storage.getUser(userId);
    res.json({
      ...updatedApproval,
      completer: completer ? {
        id: completer.id,
        firstName: completer.firstName,
        lastName: completer.lastName,
        email: completer.email,
      } : null,
    });
    broadcastPrdUpdate(id, 'approval:updated');
  }));

  // AI generation route (legacy - uses single Anthropic model)
  app.post('/api/ai/generate', isAuthenticated, aiRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { prompt, currentContent } = req.body;

    if (!prompt) {
      return res.status(400).json({ message: "Prompt is required" });
    }

    const content = await generatePRDContent(prompt, currentContent || "");
    res.json({ content });
  }));

  // OpenRouter models list endpoint
  const { isOpenRouterConfigured, getOpenRouterConfigError, fetchOpenRouterModels, MODEL_TIERS } = await import('./openrouter');
  
  app.get('/api/openrouter/models', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!isOpenRouterConfigured()) {
      return res.status(503).json({ message: getOpenRouterConfigError() });
    }
    const models = await fetchOpenRouterModels();
    res.json({ models, tierDefaults: MODEL_TIERS });
  }));

  // Dual-AI generation routes (HRP-17)
  const { getDualAiService } = await import('./dualAiService');
  const { logAiUsage, getUserAiUsageStats } = await import('./aiUsageLogger');

  // AI Usage statistics endpoint
  app.get('/api/ai/usage', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = req.user.claims.sub;
    const since = req.query.since as string | undefined;
    const stats = await getUserAiUsageStats(userId, since);
    if (!stats) {
      return res.status(500).json({ message: 'Failed to retrieve usage statistics' });
    }
    res.json(stats);
  }));

  app.post('/api/ai/generate-dual', isAuthenticated, aiRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    // Check if OpenRouter is configured
    if (!isOpenRouterConfigured()) {
      return res.status(503).json({
        message: getOpenRouterConfigError()
      });
    }

    const { userInput, existingContent, mode, prdId } = req.body;
    const userId = req.user.claims.sub;
    const editablePrdId = await requireEditablePrdId(storage, req, res, prdId, {
      invalidMessage: "PRD ID must be a non-empty string",
    });
    if (prdId !== undefined && prdId !== null && !editablePrdId) {
      return;
    }

    if (!userInput && !existingContent) {
      return res.status(400).json({ message: "User input or existing content is required" });
    }

    const service = getDualAiService();
    const result = await service.generatePRD({
      userInput: userInput || '',
      existingContent,
      mode: mode || 'improve'
    }, userId);

    // Log AI usage for both generator and reviewer
    await logAiUsage(
      userId,
      'generator',
      result.generatorResponse.model,
      result.generatorResponse.tier as any,
      result.generatorResponse.usage,
      editablePrdId || undefined
    );

    await logAiUsage(
      userId,
      'reviewer',
      result.reviewerResponse.model,
      result.reviewerResponse.tier as any,
      result.reviewerResponse.usage,
      editablePrdId || undefined
    );

    // Signal to frontend whether server will autosave (so frontend skips content in PATCH)
    const saveRequested = !!(editablePrdId && result.finalContent && result.structuredContent);
    res.json({ ...result, autoSaveRequested: saveRequested });

    // Background autosave: persist structuredContent alongside content if prdId provided
    if (saveRequested && editablePrdId) {
      (async () => {
        try {
          const existingPrd = await storage.getPrd(editablePrdId);
          if (!existingPrd) return;
          await storage.updatePrd(editablePrdId, {
            content: result.finalContent,
            structuredContent: result.structuredContent,
            structuredAt: new Date(),
          } as any);
          logger.debug("Dual AI autosave completed", { prdId: editablePrdId, hasStructure: true });
        } catch (saveError) {
          logger.error("Dual AI autosave failed", { error: saveError });
        }
      })();
    }
  }));

  app.post('/api/ai/review', isAuthenticated, aiRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    // Check if OpenRouter is configured
    if (!isOpenRouterConfigured()) {
      return res.status(503).json({
        message: getOpenRouterConfigError()
      });
    }

    const { content, prdId } = req.body;
    const userId = req.user.claims.sub;

    if (!content) {
      return res.status(400).json({ message: "Content is required for review" });
    }

    const service = getDualAiService();
    const review = await service.reviewOnly(content, userId);

    // Log AI usage for reviewer
    await logAiUsage(
      userId,
      'reviewer',
      review.model,
      review.tier as any,
      review.usage,
      prdId
    );

    res.json(review);
  }));

  app.post('/api/ai/generate-iterative', isAuthenticated, aiRateLimiter, async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest;
    let useSSE = false;
    let sseClosed = false;
    let cleanupSseListeners = () => {};
    const isRequestClosed = () =>
      sseClosed || req.aborted || req.destroyed || res.writableEnded || res.destroyed;
    const safeEndSse = () => {
      if (useSSE && !res.writableEnded && !res.destroyed) {
        try { res.end(); } catch {}
      }
    };

    try {
      // Check if OpenRouter is configured
      if (!isOpenRouterConfigured()) {
        return res.status(503).json({ 
          message: getOpenRouterConfigError()
        });
      }
      
      // Support both old format (initialContent) and new format (existingContent + additionalRequirements + mode)
      const { initialContent, existingContent, additionalRequirements, mode, iterationCount, useFinalReview, prdId } = req.body;
      const userId = authReq.user.claims.sub;
      const editablePrdId = await requireEditablePrdId(storage, authReq, res, prdId, {
        invalidMessage: "PRD ID must be a non-empty string",
      });
      if (prdId !== undefined && prdId !== null && !editablePrdId) {
        return;
      }

      logger.debug("Iterative request received", {
        hasPrdId: !!editablePrdId,
        mode: mode || "legacy",
      });
      
      // Detect which format is being used
      const hasExistingContent = existingContent && existingContent.trim().length > 0;
      const hasAdditionalReqs = additionalRequirements && additionalRequirements.trim().length > 0;
      const hasLegacyContent = initialContent && initialContent.trim().length > 0;
      const isNewFormat = mode !== undefined || hasExistingContent || hasAdditionalReqs;
      
      // Need at least some content to work with
      if (!hasExistingContent && !hasAdditionalReqs && !hasLegacyContent) {
        return res.status(400).json({ message: "Content is required - provide either existing content, additional requirements, or initial content" });
      }
      
      // Validate iteration count (2-5)
      const iterations = iterationCount || 3;
      if (iterations < 2 || iterations > 5) {
        return res.status(400).json({ message: "Iteration count must be between 2 and 5" });
      }
      
      // Determine content and mode:
      // NEW FORMAT: explicit mode + existingContent + additionalRequirements
      // LEGACY FORMAT: initialContent treated as existing content for improvement
      let finalExistingContent: string;
      let finalAdditionalReqs: string | undefined;
      let finalMode: 'improve' | 'generate';
      
      if (isNewFormat) {
        // New format: use explicit mode and separated fields
        finalExistingContent = existingContent || '';
        finalAdditionalReqs = hasAdditionalReqs ? additionalRequirements : undefined;
        // Use explicit mode if provided, otherwise infer from content presence
        if (mode) {
          finalMode = mode === 'improve' ? 'improve' : 'generate';
        } else {
          // No explicit mode but has new format fields - infer from content
          finalMode = hasExistingContent ? 'improve' : 'generate';
        }
      } else {
        // Legacy format: treat initialContent as existing PRD content
        // Legacy clients sending initialContent expect it to be used as the base
        finalExistingContent = initialContent;
        finalAdditionalReqs = undefined;
        // Legacy: if content looks substantial, treat as improvement
        finalMode = initialContent.trim().length > 50 ? 'improve' : 'generate';
      }
      
      const service = getDualAiService();
      useSSE = req.headers.accept?.includes('text/event-stream') ?? false;

      const handleSseDisconnect = () => {
        if (sseClosed) return;
        sseClosed = true;
        cleanupSseListeners();
        safeEndSse();
      };

      // SSE progress callback — sends events to the client during long-running iterative runs
      const sendSSE = useSSE
        ? (event: { type: string; [key: string]: any }) => {
            if (isRequestClosed()) return;
            try {
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            } catch {
              handleSseDisconnect();
            }
          }
        : undefined;

      if (useSSE) {
        req.on('close', handleSseDisconnect);
        req.on('aborted', handleSseDisconnect);
        cleanupSseListeners = () => {
          req.off('close', handleSseDisconnect);
          req.off('aborted', handleSseDisconnect);
        };

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
      }

      const result = await service.generateIterative(
        finalExistingContent,
        finalAdditionalReqs,
        finalMode,
        iterations,
        useFinalReview || false,
        userId,
        sendSSE,
        isRequestClosed
      );

      if (isRequestClosed()) {
        logger.debug("Iterative request closed before response", { hasPrdId: !!editablePrdId });
        return;
      }
      logger.debug("Iterative service completed", {
        hasPrdId: !!editablePrdId,
        finalContentLength: (result.finalContent || "").length,
        iterationCount: result.iterations?.length || 0,
      });

      const includeVerboseIterations = process.env.DEBUG_ITERATIVE_VERBOSE === "true";
      const slimResult: any = {
        finalContent: result.finalContent || (result as any).mergedPRD || '',
        iterationLog: result.iterationLog,
        totalTokens: result.totalTokens,
        modelsUsed: result.modelsUsed,
        diagnostics: result.diagnostics,
        finalReview: result.finalReview
          ? {
              model: result.finalReview.model,
              usage: result.finalReview.usage,
              tier: result.finalReview.tier,
            }
          : undefined,
        iterations: includeVerboseIterations
          ? result.iterations
          : result.iterations.map((it: any) => ({
              iterationNumber: it.iterationNumber,
              tokensUsed: it.tokensUsed,
              questions: Array.isArray(it.questions) ? it.questions : [],
              answererOutputTruncated: !!it.answererOutputTruncated,
            })),
      };
      logger.debug("Iterative response payload prepared", {
        hasPrdId: !!editablePrdId,
        finalContentLength: (slimResult.finalContent || "").length,
        verboseIterations: includeVerboseIterations,
      });

      const contentToPersist = slimResult.finalContent;
      const saveRequested = !!(editablePrdId && contentToPersist && contentToPersist.trim().length > 0);
      slimResult.autoSaveRequested = saveRequested;
      logger.debug("Iterative autosave decision", {
        hasPrdId: !!editablePrdId,
        saveRequested,
      });

      // Respond first to avoid blocking UI on DB writes for large runs.
      if (useSSE) {
        // Send final result as named SSE event, then close the stream
        if (!isRequestClosed()) {
          res.write(`event: result\ndata: ${JSON.stringify(slimResult)}\n\n`);
        }
        safeEndSse();
      } else {
        res.json(slimResult);
      }
      logger.debug("Iterative response sent", { hasPrdId: !!editablePrdId });

      // Persist iterative results server-side in background so long-running
      // workflows are not lost even if the client disconnects.
      if (saveRequested && editablePrdId) {
        (async () => {
          try {
            const existingPrd = await storage.getPrd(editablePrdId);
            if (!existingPrd) {
              logger.warn("Iterative autosave skipped because PRD was not found", { prdId: editablePrdId });
              return;
            }

            await storage.updatePrd(editablePrdId, {
              content: contentToPersist,
              iterationLog: result.iterationLog || null,
              structuredContent: result.structuredContent || null,
              structuredAt: result.structuredContent ? new Date() : undefined,
            } as any);
            logger.debug("Iterative autosave completed", {
              prdId: editablePrdId,
              contentLength: contentToPersist.length,
              hasStructure: !!result.structuredContent,
            });
          } catch (saveError) {
            logger.error("Iterative autosave failed", { error: saveError });
          }
        })();
      }

      // AI usage logging is best-effort and must never block response completion.
      (async () => {
        try {
          for (const iteration of result.iterations) {
            await logAiUsage(
              userId,
              'generator',
              result.modelsUsed[0] || 'unknown',
              'development',
              {
                prompt_tokens: 0,
                completion_tokens: iteration.tokensUsed / 2,
                total_tokens: iteration.tokensUsed / 2
              },
              editablePrdId || undefined
            );

            await logAiUsage(
              userId,
              'reviewer',
              result.modelsUsed[1] || result.modelsUsed[0] || 'unknown',
              'development',
              {
                prompt_tokens: 0,
                completion_tokens: iteration.tokensUsed / 2,
                total_tokens: iteration.tokensUsed / 2
              },
              editablePrdId || undefined
            );
          }

          if (result.finalReview) {
            await logAiUsage(
              userId,
              'reviewer',
              result.finalReview.model,
              result.finalReview.tier as any,
              result.finalReview.usage,
              editablePrdId || undefined
            );
          }
        } catch (usageError) {
          logger.error("Iterative async usage logging failed", { error: usageError });
        }
      })();

      return;
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.code === 'ERR_CLIENT_DISCONNECT' || isRequestClosed()) {
        logger.debug("Iterative request aborted by client");
        return;
      }

      logger.error("Iterative AI generation failed", { error });

      // Pass through the detailed error message from AI services
      const errorMessage = error.message || "Failed to generate PRD with iterative AI workflow. Please try again or check your API settings.";
      if (useSSE && res.headersSent && !res.writableEnded && !res.destroyed) {
        // SSE mode: send error as event and close stream
        res.write(`event: error\ndata: ${JSON.stringify({ message: errorMessage })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ message: errorMessage });
      }
    } finally {
      cleanupSseListeners();
    }
  });

  // Guided AI Workflow routes (User-involved PRD generation)
  const { getGuidedAiService } = await import('./guidedAiService');
  
  // Start guided workflow - returns initial analysis + questions
  app.post('/api/ai/guided-start', isAuthenticated, aiRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!isOpenRouterConfigured()) {
      return res.status(503).json({
        message: getOpenRouterConfigError()
      });
    }

    const { projectIdea } = req.body;
    const userId = req.user.claims.sub;

    if (!projectIdea || projectIdea.trim().length < 10) {
      return res.status(400).json({ message: "Please provide a project idea (at least 10 characters)" });
    }

    const service = getGuidedAiService();
    const result = await service.startGuidedWorkflow(projectIdea, userId);

    res.json(result);
  }));
  
  // Process user answers - returns refined plan + optional follow-up questions
  app.post('/api/ai/guided-answer', isAuthenticated, aiRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!isOpenRouterConfigured()) {
      return res.status(503).json({
        message: getOpenRouterConfigError()
      });
    }

    const { sessionId, answers, questions } = req.body;
    const userId = req.user.claims.sub;

    if (!sessionId) {
      return res.status(400).json({ message: "Session ID is required" });
    }

    if (!answers || !Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ message: "At least one answer is required" });
    }

    if (!questions || !Array.isArray(questions)) {
      return res.status(400).json({ message: "Questions array is required for context" });
    }

    const service = getGuidedAiService();
    const result = await service.processAnswers(sessionId, answers, questions, userId);

    res.json(result);
  }));
  
  // Finalize PRD generation after guided workflow
  app.post('/api/ai/guided-finalize', isAuthenticated, aiRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!isOpenRouterConfigured()) {
      return res.status(503).json({
        message: getOpenRouterConfigError()
      });
    }

    const { sessionId, prdId } = req.body;
    const userId = req.user.claims.sub;

    if (!sessionId) {
      return res.status(400).json({ message: "Session ID is required" });
    }

    const service = getGuidedAiService();
    const result = await service.finalizePRD(sessionId, userId);

    // Log AI usage
    if (result.modelsUsed.length > 0) {
      await logAiUsage(
        userId,
        'generator',
        result.modelsUsed[0],
        'production',
        { prompt_tokens: 0, completion_tokens: result.tokensUsed, total_tokens: result.tokensUsed },
        prdId
      );
    }

    res.json(result);
  }));
  
  // Skip guided workflow and generate PRD directly
  app.post('/api/ai/guided-skip', isAuthenticated, aiRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!isOpenRouterConfigured()) {
      return res.status(503).json({
        message: getOpenRouterConfigError()
      });
    }

    const { projectIdea, prdId } = req.body;
    const userId = req.user.claims.sub;

    if (!projectIdea || projectIdea.trim().length < 10) {
      return res.status(400).json({ message: "Please provide a project idea (at least 10 characters)" });
    }

    const service = getGuidedAiService();
    const result = await service.skipToFinalize(projectIdea, userId);

    // Log AI usage
    if (result.modelsUsed.length > 0) {
      await logAiUsage(
        userId,
        'generator',
        result.modelsUsed[0],
        'production',
        { prompt_tokens: 0, completion_tokens: result.tokensUsed, total_tokens: result.tokensUsed },
        prdId
      );
    }

    res.json(result);
  }));

  // Export routes
  app.post('/api/prds/:id/export', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { format } = req.body;
    const { id } = req.params;
    const prd = await requirePrdAccess(storage, req, res, id, 'view');
    if (!prd) return;

    if (format === 'markdown') {
      const markdown = `# ${prd.title}\n\n${prd.description || ''}\n\n---\n\n${prd.content}`;
      res.json({ content: markdown });
    } else if (format === 'claudemd') {
      const claudemd = generateClaudeMD({
        title: prd.title,
        description: prd.description || undefined,
        content: prd.content,
      });
      res.json({ content: claudemd.content });
    } else if (format === 'pdf') {
      const pdfBuffer = await generatePDF({
        title: prd.title,
        description: prd.description || undefined,
        content: prd.content,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${prd.title.replace(/\s+/g, '-')}.pdf"`);
      res.send(pdfBuffer);
    } else if (format === 'word') {
      const wordBuffer = await generateWord({
        title: prd.title,
        description: prd.description || undefined,
        content: prd.content,
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${prd.title.replace(/\s+/g, '-')}.docx"`);
      res.send(wordBuffer);
    } else {
      res.status(400).json({ message: "Unsupported export format" });
    }
  }));

  // Version history endpoints
  // Restore PRD to specific version
  app.post('/api/prds/:id/restore/:versionId', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id: prdId, versionId } = req.params;

    // Restore requires edit permission (owner or shared editor).
    const prd = await requirePrdAccess(storage, req, res, prdId, 'edit');
    if (!prd) return;

    // Get the version
    const versions = await storage.getPrdVersions(prdId);
    const version = versions.find(v => v.id === versionId);

    if (!version) {
      return res.status(404).json({ message: "Version not found" });
    }

    // Use versions.length + 1 because the restore operation will create a new version snapshot
    const newVersionNumber = getNextPrdVersionNumber(versions.length);
    const status = version.status as 'draft' | 'in-progress' | 'review' | 'pending-approval' | 'approved' | 'completed';

    // Sync the header metadata in the restored content with the new version number
    const syncedContent = syncPrdHeaderMetadata(
      version.content,
      newVersionNumber,
      status
    );

    // Restore complete state from version (with synced header + structured content if available)
    const updatedPrd = await storage.updatePrd(prdId, {
      title: version.title,
      description: version.description,
      content: syncedContent,
      structuredContent: (version as any).structuredContent || null,
      structuredAt: (version as any).structuredContent ? new Date() : null,
      status: status,
    } as any);

    res.json(updatedPrd);
    broadcastPrdUpdate(prdId, 'prd:updated');
  }));

  // Structured content endpoints
  app.get('/api/prds/:id/structure', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const accessPrd = await requirePrdAccess(storage, req, res, id, 'view');
    if (!accessPrd) return;

    const { prd, structure } = await storage.getPrdWithStructure(id);

    if (!structure) {
      return res.status(404).json({ message: "No structured content available" });
    }

    const source = (prd as any).structuredContent ? 'stored' : 'parsed';
    res.json({
      structure,
      source,
      structuredAt: (prd as any).structuredAt,
      completeness: computeCompleteness(structure),
    });
  }));

  app.post('/api/prds/:id/reparse', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const prd = await requirePrdAccess(storage, req, res, id, 'edit');
    if (!prd) return;

    const structure = parsePRDToStructure(prd.content);
    await storage.updatePrdStructure(id, structure);

    res.json({
      featureCount: structure.features.length,
      completeness: computeCompleteness(structure),
    });
  }));

  app.get('/api/prds/:id/completeness', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const prd = await requirePrdAccess(storage, req, res, id, 'view');
    if (!prd) return;

    const { structure } = await storage.getPrdWithStructure(id);

    if (!structure) {
      return res.status(404).json({ message: "No structured content available for completeness check" });
    }

    res.json(computeCompleteness(structure));
  }));

  // Error logging endpoint — rate-limited, sanitized input
  app.post('/api/errors', errorRateLimiter, asyncHandler(async (req, res) => {
    const message = String(req.body.message || '').slice(0, 2000);
    const stack = String(req.body.stack || '').slice(0, 2000);
    const componentStack = String(req.body.componentStack || '').slice(0, 2000);
    const timestamp = String(req.body.timestamp || '').slice(0, 100);
    const userAgent = String(req.body.userAgent || '').slice(0, 500);

    logger.error('Frontend Error', {
      timestamp,
      message,
      stack,
      componentStack,
      userAgent,
      userId: (req as any).user?.claims?.sub || 'anonymous',
    });

    res.status(200).json({ message: 'Error logged' });
  }));

  // Linear integration routes
  app.post('/api/linear/export', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { prdId, title, description } = req.body;

    if (!title) {
      return res.status(400).json({ message: "Title and PRD ID are required" });
    }

    const editablePrdId = await requireEditablePrdId(storage, req, res, prdId, {
      required: true,
      requiredMessage: "Title and PRD ID are required",
      invalidMessage: "PRD ID must be a non-empty string",
    });
    if (!editablePrdId) {
      return;
    }

    const result = await exportToLinear(title, description || "");

    // Update PRD with Linear issue details
    await storage.updatePrd(editablePrdId, {
      linearIssueId: result.issueId,
      linearIssueUrl: result.url,
    });

    res.json(result);
  }));

  app.get('/api/linear/status', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const connected = await checkLinearConnection();
    res.json({ connected });
  }));

  // Dart AI integration routes
  app.get('/api/dart/dartboards', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const result = await getDartboards();
    res.json(result);
  }));

  app.post('/api/dart/export', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { prdId, title, content, folder } = req.body;

    if (!title) {
      return res.status(400).json({ message: "Title and PRD ID are required" });
    }

    const editablePrdId = await requireEditablePrdId(storage, req, res, prdId, {
      required: true,
      requiredMessage: "Title and PRD ID are required",
      invalidMessage: "PRD ID must be a non-empty string",
    });
    if (!editablePrdId) {
      return;
    }

    const result = await exportToDart(title, content || "", folder);

    // Update PRD with Dart AI doc details
    await storage.updatePrd(editablePrdId, {
      dartDocId: result.docId,
      dartDocUrl: result.url,
      dartFolder: result.folder,
    });

    res.json(result);
  }));

  app.get('/api/dart/status', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const connected = await checkDartConnection();
    res.json({ connected });
  }));

  // Dart AI update endpoint - sync existing doc with current PRD content
  app.put('/api/dart/update', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { prdId, docId, title, content } = req.body;
    const normalizedDocId = normalizeDartDocId(docId);

    if (!normalizedDocId) {
      return res.status(400).json({ message: "Document ID and PRD ID are required" });
    }

    const editablePrdId = await requireEditablePrdId(storage, req, res, prdId, {
      required: true,
      requiredMessage: "Document ID and PRD ID are required",
      invalidMessage: "PRD ID must be a non-empty string",
    });
    if (!editablePrdId) {
      return;
    }

    const prd = await storage.getPrd(editablePrdId);
    if (!prd) {
      return res.status(404).json({ message: "PRD not found" });
    }

    if (!isDartDocUpdateConsistent(prd.dartDocId, normalizedDocId)) {
      return res.status(409).json({ message: "Dart document ID does not match the PRD's linked document" });
    }

    const result = await updateDartDoc(normalizedDocId, title || "Untitled", content || "");

    // Update PRD with latest Dart AI doc URL (might have changed)
    await storage.updatePrd(editablePrdId, {
      dartDocId: normalizedDocId,
      dartDocUrl: result.url,
    });

    res.json(result);
  }));

  const httpServer = createServer(app);
  setupWebSocket(httpServer);
  return httpServer;
}
