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
// Legacy Anthropic import removed – legacy endpoint disabled (see below)
import { generatePDF, generateWord } from "./exportUtils";
import { generateClaudeMD } from "./claudemdGenerator";
import { repairSingleIssue } from "./issueRepairService";
import { initializeTemplates } from "./initTemplates";
import { db, pool } from "./db";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { parsePRDToStructure } from "./prdParser";

// ÄNDERUNG 02.03.2025: Timeout-Konstante für Guided Finalisierung exportiert
// Gemäß Review-Feedback: Eine Quelle der Wahrheit für Server und Client
export const GUIDED_FINALIZE_TIMEOUT_MS = 30 * 60 * 1000; // 30 Minuten
import { computeCompleteness } from "./prdCompleteness";
import { setupWebSocket, broadcastPrdUpdate } from "./wsServer";
import { requirePrdAccess, requireEditablePrdId } from "./prdAccess";
import { buildPrdVersionSnapshot, getNextPrdVersionNumber } from "./prdVersioningUtils";
import { canUserAccessTemplate } from "./templateAccess";
import { collectCollaboratorIds, mapCollaboratorUsers } from "./collaborators";
import {
  assessCompilerOutcome,
  persistCompilerRunArtifactBestEffort,
  resolveTemplateCategoryForPrd,
} from "./aiRouteCompilerSupport";
import {
  resolveAiPreferenceUserId,
  qualityStatusHttpCode,
  withArtifactMetrics,
} from "./aiRouteSupport";
import { registerGuidedRoutes } from "./guidedRoutes";
import { logger } from "./logger";
import { isIterativeClientDisconnected } from "./iterativeRequestGuard";
import { registerIntegrationRoutes } from "./integrationRoutes";
import { registerModelProviderRoutes } from "./modelProviderRoutes";
import { registerPrdApprovalRoutes } from "./prdApprovalRoutes";
import { registerPrdCommentRoutes } from "./prdCommentRoutes";
import { registerPrdMaintenanceRoutes } from "./prdMaintenanceRoutes";
import { registerPrdShareRoutes } from "./prdShareRoutes";
import { registerPrdVersionRoutes } from "./prdVersionRoutes";
import { splitTokenCount } from "./tokenMath";
import {
  MODEL_TIERS,
  getDefaultFallbackModelForTier,
  sanitizeConfiguredModel,
  resolveModelTier,
  DEFAULT_FREE_FALLBACK_CHAIN,
  isOpenRouterConfigured,
  getOpenRouterConfigError,
  createClientWithUserPreferences,
} from "./openrouter";
import { initializeModelRegistry } from "./modelRegistry";
import { resolvePrdWorkflowMode } from "./prdWorkflowMode";
import {
  classifyRunFailure,
  mergeDiagnosticsIntoIterationLog,
  type PrdQualityStatus,
} from "./prdRunQuality";
import { getCompilerRunMetrics } from "./compilerRunMetrics";
import type { ModelCallAttemptUpdate } from "./openrouterFallback";
import {
  updateUserSchema,
  createTemplateSchema,
  updatePrdSchema,
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
  // Initialize model-provider registry (must run before routes use provider detection)
  await initializeModelRegistry();

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
    
    // DEBUG: Log raw stored data (sanitized – no PII)
    logger.debug('AI Settings GET - Raw stored data', {
      hasTier: !!stored.tier,
      tierModelCount: Object.keys(stored.tierModels || {}).length,
      hasDevGenerator: !!stored.tierModels?.development?.generatorModel,
      hasProdGenerator: !!stored.tierModels?.production?.generatorModel,
      hasPremiumGenerator: !!stored.tierModels?.premium?.generatorModel,
      hasDevVerifier: !!stored.tierModels?.development?.verifierModel,
    });
    
    const tier = resolveModelTier(stored.tier);
    const tierKey = tier;
    const tierDefaults = MODEL_TIERS[tierKey] || MODEL_TIERS.development;
    const rawTierModels = (stored.tierModels || {}) as Record<string, {
      generatorModel?: string;
      reviewerModel?: string;
      verifierModel?: string;
      fallbackModel?: string;
      fallbackChain?: string[];
    }>;
    const tierModels = Object.fromEntries(
      Object.entries(rawTierModels).map(([tierName, modelSet]) => {
        const typedTier = resolveModelTier(tierName);
        const defaults = MODEL_TIERS[typedTier] || MODEL_TIERS.development;
        const sanitizedGenerator = sanitizeConfiguredModel(modelSet?.generatorModel);
        const sanitizedReviewer = sanitizeConfiguredModel(modelSet?.reviewerModel);
        const sanitizedVerifier = sanitizeConfiguredModel(modelSet?.verifierModel);
        const sanitizedFallback = sanitizeConfiguredModel(modelSet?.fallbackModel);
        
        // DEBUG: Log sanitization results (sanitized – no PII)
        logger.debug('AI Settings GET - Sanitizing tier model', {
          tierName,
          hasOriginalGenerator: !!modelSet?.generatorModel,
          hasSanitizedGenerator: !!sanitizedGenerator,
          hasOriginalReviewer: !!modelSet?.reviewerModel,
          hasSanitizedReviewer: !!sanitizedReviewer,
          hasOriginalVerifier: !!modelSet?.verifierModel,
          hasSanitizedVerifier: !!sanitizedVerifier,
        });
        
        return [
          tierName,
          {
            ...(modelSet || {}),
            generatorModel: sanitizedGenerator || defaults.generator,
            reviewerModel: sanitizedReviewer || defaults.reviewer,
            verifierModel: sanitizedVerifier || defaults.verifier || defaults.reviewer,
            fallbackModel: sanitizedFallback || getDefaultFallbackModelForTier(typedTier),
            fallbackChain: Array.isArray(modelSet?.fallbackChain) ? modelSet.fallbackChain : undefined,
          },
        ];
      })
    );
    const activeTierModels = tierModels[tier] || {};

    const resolvedGeneratorModel =
      sanitizeConfiguredModel(activeTierModels.generatorModel || stored.generatorModel) ||
      tierDefaults.generator;
    const resolvedReviewerModel =
      sanitizeConfiguredModel(activeTierModels.reviewerModel || stored.reviewerModel) ||
      tierDefaults.reviewer;
    const resolvedVerifierModel =
      sanitizeConfiguredModel(activeTierModels.verifierModel || stored.verifierModel) ||
      resolvedReviewerModel ||
      tierDefaults.verifier;
    const resolvedFallbackModel =
      sanitizeConfiguredModel(activeTierModels.fallbackModel || stored.fallbackModel) ||
      getDefaultFallbackModelForTier(tierKey);
    const resolvedFallbackChain: string[] =
      (activeTierModels.fallbackChain?.length ? activeTierModels.fallbackChain : undefined) ??
      (stored.fallbackChain?.length ? stored.fallbackChain as string[] : undefined) ??
      [...DEFAULT_FREE_FALLBACK_CHAIN];

    const preferences = {
      ...stored,
      tier,
      tierModels,
      generatorModel: resolvedGeneratorModel,
      reviewerModel: resolvedReviewerModel,
      verifierModel: resolvedVerifierModel,
      fallbackModel: resolvedFallbackModel,
      fallbackChain: resolvedFallbackChain,
      iterativeTimeoutMinutes: stored.iterativeTimeoutMinutes || 30,
    };
    
    // DEBUG: Log response (sanitized – no PII)
    logger.debug('AI Settings GET - Response', {
      responseTier: preferences.tier,
      tierModelCount: Object.keys(preferences.tierModels || {}).length,
      hasDevGenerator: !!preferences.tierModels?.development?.generatorModel,
      hasProdGenerator: !!preferences.tierModels?.production?.generatorModel,
      hasPremiumGenerator: !!preferences.tierModels?.premium?.generatorModel,
      hasDevVerifier: !!preferences.tierModels?.development?.verifierModel,
    });

    res.json(preferences);
  }));

  // AI Model Health Check endpoint
  app.get('/api/settings/ai/health', isAuthenticated, aiRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = req.user.claims.sub;
    let resolvedGeneratorModel = 'unknown';

    try {
      const { client } = await createClientWithUserPreferences(userId);
      resolvedGeneratorModel = client.getPreferredModel('generator') || 'unknown';

      // 15-second timeout via AbortController
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 15_000);

      try {
        const result = await client.callModel(
          'generator',
          'You are a test.',
          'Reply OK.',
          5,
          0.0,
          undefined,
          { abortSignal: abortController.signal, phase: 'health-check' },
        );
        clearTimeout(timeout);
        res.json({ healthy: true, model: result.model });
      } catch (innerErr: any) {
        clearTimeout(timeout);
        const errorMessage = innerErr?.message || String(innerErr);
        logger.warn('AI health check failed', { model: resolvedGeneratorModel, error: errorMessage });
        res.json({ healthy: false, model: resolvedGeneratorModel, error: errorMessage });
      }
    } catch (outerErr: any) {
      const errorMessage = outerErr?.message || String(outerErr);
      logger.warn('AI health check setup failed', { error: errorMessage });
      res.json({ healthy: false, model: resolvedGeneratorModel, error: errorMessage });
    }
  }));

  // Handler für AI-Settings Update (PATCH + POST)
  // POST wird für navigator.sendBeacon() benötigt (beforeunload/unmount flush)
  const handleAiSettingsUpdate = asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = req.user.claims.sub;
    const preferences = aiPreferencesSchema.parse(req.body);

    // DEBUG: Log incoming request (sanitized – no PII)
    logger.debug('AI Settings PATCH - Request received', {
      hasTier: !!preferences.tier,
      hasGenerator: !!preferences.generatorModel,
      hasReviewer: !!preferences.reviewerModel,
      hasVerifier: !!preferences.verifierModel,
      tierModelCount: Object.keys(preferences.tierModels || {}).length,
    });

    const existing = await db.select({
      aiPreferences: users.aiPreferences
    }).from(users).where(eq(users.id, userId)).limit(1);
    const existingPrefs = (existing[0]?.aiPreferences as any) || {};
    const existingTierModels = existingPrefs.tierModels || {};

    // DEBUG: Log existing data (sanitized – no PII)
    logger.debug('AI Settings PATCH - Existing data', {
      hasTier: !!existingPrefs.tier,
      tierModelCount: Object.keys(existingTierModels).length,
      hasDevGenerator: !!existingTierModels.development?.generatorModel,
      hasProdGenerator: !!existingTierModels.production?.generatorModel,
      hasPremiumGenerator: !!existingTierModels.premium?.generatorModel,
      hasDevVerifier: !!existingTierModels.development?.verifierModel,
    });

    const activeTier = resolveModelTier(preferences.tier || existingPrefs.tier);
    const activeTierKey = activeTier;
    const activeTierDefaults = MODEL_TIERS[activeTierKey] || MODEL_TIERS.development;

    const normalizeIncomingModel = (value: string | undefined, replacement: string): string | undefined => {
      if (!value) return undefined;
      return sanitizeConfiguredModel(value) || replacement;
    };

    const incomingTierModels = (preferences.tierModels || {}) as Record<string, {
      generatorModel?: string;
      reviewerModel?: string;
      verifierModel?: string;
      fallbackModel?: string;
      semanticRepairModel?: string;
      fallbackChain?: string[];
    } | undefined>;
    
    // DEBUG: Log incoming tier models detail (sanitized – no PII)
    logger.debug('AI Settings PATCH - Incoming tier models detail', {
      incomingTierCount: Object.keys(incomingTierModels).length,
      incomingTierNames: Object.keys(incomingTierModels),
    });
    
    const sanitizedIncomingTierModels = Object.fromEntries(
      Object.entries(incomingTierModels).map(([tierName, modelSet]) => {
        const typedTier = resolveModelTier(tierName);
        const tierDefaults = MODEL_TIERS[typedTier] || MODEL_TIERS.development;
        return [
          tierName,
          {
            ...(modelSet || {}),
            generatorModel: normalizeIncomingModel(modelSet?.generatorModel, tierDefaults.generator) ?? modelSet?.generatorModel,
            reviewerModel: normalizeIncomingModel(modelSet?.reviewerModel, tierDefaults.reviewer) ?? modelSet?.reviewerModel,
            verifierModel: normalizeIncomingModel(modelSet?.verifierModel, tierDefaults.verifier || tierDefaults.reviewer) ?? modelSet?.verifierModel,
            semanticRepairModel: normalizeIncomingModel(modelSet?.semanticRepairModel, tierDefaults.semanticRepair || tierDefaults.reviewer) ?? modelSet?.semanticRepairModel,
            fallbackModel: normalizeIncomingModel(modelSet?.fallbackModel, getDefaultFallbackModelForTier(typedTier)) ?? modelSet?.fallbackModel,
            ...(Array.isArray(modelSet?.fallbackChain)
              ? { fallbackChain: modelSet!.fallbackChain.map(m => sanitizeConfiguredModel(m)).filter(Boolean) as string[] }
              : {}),
          },
        ];
      })
    );

    // Only override the active tier's models when fields are explicitly provided.
    // Without this guard, a PATCH with just {"tier":"development"} would overwrite
    // the development tier models with undefined → {}, losing the configuration.
    const tierUpdate: Record<string, any> = {};
    if (preferences.generatorModel) {
      tierUpdate.generatorModel = normalizeIncomingModel(preferences.generatorModel, activeTierDefaults.generator)!;
    }
    if (preferences.reviewerModel) {
      tierUpdate.reviewerModel = normalizeIncomingModel(preferences.reviewerModel, activeTierDefaults.reviewer)!;
    }
    if (preferences.verifierModel) {
      tierUpdate.verifierModel = normalizeIncomingModel(preferences.verifierModel, activeTierDefaults.verifier || activeTierDefaults.reviewer)!;
    }
    if (preferences.semanticRepairModel) {
      tierUpdate.semanticRepairModel = normalizeIncomingModel(preferences.semanticRepairModel, activeTierDefaults.semanticRepair || activeTierDefaults.reviewer)!;
    }
    if (preferences.fallbackModel) {
      tierUpdate.fallbackModel = normalizeIncomingModel(preferences.fallbackModel, getDefaultFallbackModelForTier(activeTierKey))!;
    }
    if (Array.isArray(preferences.fallbackChain)) {
      tierUpdate.fallbackChain = preferences.fallbackChain
        .map(m => sanitizeConfiguredModel(m))
        .filter(Boolean) as string[];
    }

    const updatedTierModels = {
      ...existingTierModels,
      [activeTier]: {
        ...(existingTierModels[activeTier] || {}),
        ...tierUpdate,
      },
    };
    
    // DEBUG: Log updated tier models (sanitized – no PII)
    logger.debug('AI Settings PATCH - Updated tier models', {
      activeTier,
      tierModelCount: Object.keys(updatedTierModels).length,
      hasDevGenerator: !!updatedTierModels.development?.generatorModel,
      hasProdGenerator: !!updatedTierModels.production?.generatorModel,
      hasPremiumGenerator: !!updatedTierModels.premium?.generatorModel,
      hasDevVerifier: !!updatedTierModels.development?.verifierModel,
    });

    // ÄNDERUNG 02.03.2025: Kritischer Bugfix - Reihenfolge der Merge-Operationen korrigiert
    // Problem 1: ...preferences enthält preferences.tierModels und überschreibt existingPrefs.tierModels
    // Problem 2: Die Merge-Logik für tierModels war falsch - sie hat incoming Daten priorisiert statt existing
    // Lösung:
    // 1. tierModels aus preferences extrahieren (um zu verhindern, dass es existingPrefs überschreibt)
    // 2. Korrekte Merge-Reihenfolge: existing → updated (mit active tier update) → sanitized incoming
    const { tierModels: _, ...preferencesWithoutTierModels } = preferences;
    
    // Merge-Strategie für tierModels:
    // - Start: existingTierModels (aus DB)
    // - Dann: updatedTierModels (existing + active tier update)
    // - Zuletzt: sanitizedIncomingTierModels (nur wenn vorhanden und explizit gesendet)
    const finalTierModels = Object.keys(sanitizedIncomingTierModels).length > 0
      ? { ...existingTierModels, ...updatedTierModels, ...sanitizedIncomingTierModels }
      : updatedTierModels;

    const merged = {
      ...existingPrefs,
      ...preferencesWithoutTierModels,
      ...(preferences.generatorModel ? { generatorModel: tierUpdate.generatorModel } : {}),
      ...(preferences.reviewerModel ? { reviewerModel: tierUpdate.reviewerModel } : {}),
      ...(preferences.verifierModel ? { verifierModel: tierUpdate.verifierModel } : {}),
      ...(preferences.semanticRepairModel ? { semanticRepairModel: tierUpdate.semanticRepairModel } : {}),
      ...(preferences.fallbackModel ? { fallbackModel: tierUpdate.fallbackModel } : {}),
      ...(Array.isArray(preferences.fallbackChain) ? { fallbackChain: tierUpdate.fallbackChain } : {}),
      // WICHTIG: Die finalen tierModels setzen - das überschreibt ggf. preferences.tierModels
      tierModels: finalTierModels,
    };

    // DEBUG: Log merged result (sanitized – no PII)
    logger.debug('AI Settings PATCH - Merged result', {
      tierModelCount: Object.keys(merged.tierModels || {}).length,
      hasDevGenerator: !!merged.tierModels?.development?.generatorModel,
      hasProdGenerator: !!merged.tierModels?.production?.generatorModel,
      hasPremiumGenerator: !!merged.tierModels?.premium?.generatorModel,
      hasDevVerifier: !!merged.tierModels?.development?.verifierModel,
    });

    await db.update(users)
      .set({
        aiPreferences: merged as any,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    res.json(merged);
  });

  app.patch('/api/settings/ai', isAuthenticated, handleAiSettingsUpdate);
  app.post('/api/settings/ai', isAuthenticated, handleAiSettingsUpdate);

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

  // ÄNDERUNG 08.03.2026: Versionsrouten in eigenes kleines Registrierungsmodul ausgelagert.
  registerPrdVersionRoutes(app, isAuthenticated, {
    storage,
    requirePrdAccess,
    getNextPrdVersionNumber,
    buildPrdVersionSnapshot,
  });

  // ÄNDERUNG 08.03.2026: Share-Routen in eigenes kleines Registrierungsmodul ausgelagert.
  registerPrdShareRoutes(app, isAuthenticated, {
    storage,
    requirePrdAccess,
  });

  // ÄNDERUNG 08.03.2026: Kommentar-Routen in eigenes kleines Registrierungsmodul ausgelagert.
  registerPrdCommentRoutes(app, isAuthenticated, {
    storage,
    requirePrdAccess,
    loadUsersByIds: async (userIds) => {
      if (userIds.length === 0) {
        return [];
      }

      return await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          profileImageUrl: users.profileImageUrl,
        })
        .from(users)
        .where(inArray(users.id, userIds));
    },
    broadcastPrdUpdate,
  });

  // ÄNDERUNG 08.03.2026: Approval-Routen in eigenes kleines Registrierungsmodul ausgelagert.
  registerPrdApprovalRoutes(app, isAuthenticated, {
    storage,
    requirePrdAccess,
    loadUsersByIds: async (userIds) => {
      if (userIds.length === 0) {
        return [];
      }

      return await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        })
        .from(users)
        .where(inArray(users.id, userIds));
    },
    broadcastPrdUpdate,
  });

  // AI generation route (legacy - DISABLED: bypassed tier system, always used paid Anthropic model)
  app.post('/api/ai/generate', isAuthenticated, aiRateLimiter, asyncHandler(async (_req: AuthenticatedRequest, res) => {
    return res.status(410).json({
      message: "Legacy single-model generation is disabled. Please use the Dual-AI or Guided workflow."
    });
  }));

  // ÄNDERUNG 08.03.2026: Provider-/Modell-Routen in eigenes kleines Registrierungsmodul ausgelagert.
  await registerModelProviderRoutes(app, isAuthenticated);

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

  app.get('/api/ai/compiler-run-metrics', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const workflow = typeof req.query.workflow === 'string' ? req.query.workflow.trim() : undefined;
    const routeKey = typeof req.query.routeKey === 'string' ? req.query.routeKey.trim() : undefined;
    const days = typeof req.query.days === 'string' ? Number(req.query.days) : undefined;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const includeLatest = String(req.query.includeLatest || '').trim().toLowerCase() === 'true';

    if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 365)) {
      return res.status(400).json({ message: 'days must be an integer between 1 and 365' });
    }

    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 5000)) {
      return res.status(400).json({ message: 'limit must be an integer between 1 and 5000' });
    }

    const metrics = await getCompilerRunMetrics({
      baseDir: process.cwd(),
      workflow: workflow || undefined,
      routeKey: routeKey || undefined,
      days,
      limit,
      includeLatest,
    });

    res.json(metrics);
  }));

  app.post('/api/ai/generate-dual', isAuthenticated, aiRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    // Check if OpenRouter is configured
    if (!isOpenRouterConfigured()) {
      return res.status(503).json({
        message: getOpenRouterConfigError()
      });
    }

    const requestStartedAt = Date.now();

    const { userInput, existingContent, mode, prdId } = req.body;
    const userId = req.user.claims.sub;
	  const aiPreferenceUserId = resolveAiPreferenceUserId(req, userId);
    const editablePrdId = await requireEditablePrdId(storage, req, res, prdId, {
      invalidMessage: "PRD ID must be a non-empty string",
    });
    if (prdId !== undefined && prdId !== null && !editablePrdId) {
      return;
    }
    const templateCategory = await resolveTemplateCategoryForPrd(editablePrdId);

    if (!userInput && !existingContent) {
      return res.status(400).json({ message: "User input or existing content is required" });
    }

    const service = getDualAiService();
    try {
      const result = await service.generatePRD({
        userInput: userInput || '',
        existingContent,
        mode: mode || 'improve',
        templateCategory,
	    }, aiPreferenceUserId);

      const modeResolution = resolvePrdWorkflowMode({
        requestedMode: mode === 'improve' ? 'improve' : 'generate',
        existingContent: existingContent || '',
      });
      const effectiveMode: 'generate' | 'improve' = modeResolution.mode;
      const assessed = assessCompilerOutcome({
        content: result.finalContent,
        mode: effectiveMode,
        existingContent,
        templateCategory,
        baseDiagnostics: result.diagnostics,
      });

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

      const saveRequested = !!(editablePrdId && assessed.qualityStatus === 'passed');
      const {
        compilerArtifact,
        diagnostics: _dualInternalDiagnostics,
        ...publicDualResult
      } = result;
      const responsePayload: any = {
        ...publicDualResult,
        qualityStatus: assessed.qualityStatus,
        compilerDiagnostics: assessed.compilerDiagnostics,
        finalizationStage: assessed.finalizationStage,
        autoSaveRequested: saveRequested,
        effectiveMode: effectiveMode,
        baselineFeatureCount: modeResolution?.assessment.featureCount ?? 0,
        baselinePartial: modeResolution?.assessment.baselinePartial ?? false,
      };

      // Always return 200 when generatePRD() succeeded (no throw).
      // qualityStatus and compilerDiagnostics are included for client-side tracking.
      // The catch block below handles genuine failures (PrdCompilerQualityError etc.).
      res.json(responsePayload);

      void persistCompilerRunArtifactBestEffort({
        workflow: 'dual',
        routeKey: 'dual-generate',
        qualityStatus: assessed.qualityStatus,
        finalizationStage: assessed.finalizationStage,
        finalContent: result.finalContent,
        compiledContent: assessed.compiled.content,
        compiledStructure: assessed.compiled.structure,
        quality: assessed.compiled.quality,
        compilerDiagnostics: assessed.compilerDiagnostics,
        modelsUsed: result.modelsUsed,
        requestContext: {
          effectiveMode,
          templateCategory: templateCategory || null,
          hasExistingContent: !!existingContent,
          prdId: editablePrdId || null,
        },
        stageData: withArtifactMetrics({
          requestStartedAt,
          timings: result.timings || null,
          totalTokens: result.totalTokens,
          stageData: {
          generatorResponse: result.generatorResponse,
          reviewerResponse: result.reviewerResponse,
          improvedVersion: result.improvedVersion,
          compilerArtifact: compilerArtifact || null,
          },
        }),
      });

      if (editablePrdId) {
        (async () => {
          try {
            const existingPrd = await storage.getPrd(editablePrdId);
            if (!existingPrd) return;
            const iterationLog = mergeDiagnosticsIntoIterationLog(existingPrd.iterationLog, assessed.qualityStatus, assessed.compilerDiagnostics);
            await storage.persistPrdRunFinalization({
              prdId: editablePrdId,
              userId,
              qualityStatus: assessed.qualityStatus,
              finalizationStage: 'final',
              content: assessed.compiled.content,
              structuredContent: result.structuredContent || assessed.compiled.structure,
              iterationLog,
              compilerDiagnostics: assessed.compilerDiagnostics,
            });
            logger.debug("Dual AI finalization persisted", {
              prdId: editablePrdId,
              qualityStatus: assessed.qualityStatus,
            });
          } catch (saveError) {
            logger.error("Dual AI finalization persistence failed", { error: saveError });
          }
        })();
      }
    } catch (error: any) {
      const failure = classifyRunFailure(error);
      // ÄNDERUNG 11.03.2026: Failure-Artefakte muessen degradierte Compiler-Struktur
      // und Quality mitpersistieren, damit Feature-/Task-Metadaten erhalten bleiben.
      void persistCompilerRunArtifactBestEffort({
        workflow: 'dual',
        routeKey: 'dual-generate',
        qualityStatus: failure.qualityStatus,
        finalizationStage: 'final',
        finalContent: failure.finalContent || undefined,
        compiledContent: failure.compiledContent || undefined,
        compiledStructure: failure.compiledStructure || undefined,
        quality: failure.quality || undefined,
        compilerDiagnostics: failure.diagnostics,
        modelsUsed: [],
        requestContext: {
          templateCategory: templateCategory || null,
          hasExistingContent: !!existingContent,
          prdId: editablePrdId || null,
        },
        stageData: withArtifactMetrics({
          requestStartedAt,
          stageData: {
          errorMessage: failure.message,
          qualityError: error instanceof Error ? error.message : String(error || ''),
          },
        }),
      });
      if (editablePrdId) {
        try {
          const existingPrd = await storage.getPrd(editablePrdId);
          if (existingPrd) {
            await storage.persistPrdRunFinalization({
              prdId: editablePrdId,
              userId,
              qualityStatus: failure.qualityStatus,
              finalizationStage: 'final',
              content: failure.finalContent || failure.compiledContent || undefined,
              structuredContent: failure.compiledStructure || undefined,
              iterationLog: mergeDiagnosticsIntoIterationLog(existingPrd.iterationLog, failure.qualityStatus, failure.diagnostics),
              compilerDiagnostics: failure.diagnostics,
            });
          }
        } catch (persistFailureError) {
          logger.error("Dual AI failure diagnostics persistence failed", { error: persistFailureError });
        }
      }
      res.status(qualityStatusHttpCode(failure.qualityStatus)).json({
        message: failure.message,
        finalContent: failure.finalContent || undefined,
        qualityStatus: failure.qualityStatus,
        compilerDiagnostics: failure.diagnostics,
        finalizationStage: 'final',
        autoSaveRequested: false,
      });
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
	  const aiPreferenceUserId = resolveAiPreferenceUserId(req, userId);

    if (!content) {
      return res.status(400).json({ message: "Content is required for review" });
    }

    const service = getDualAiService();
	  const review = await service.reviewOnly(content, aiPreferenceUserId);

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

  // -------------------------------------------------------------------------
  // POST /api/ai/repair-issue — targeted single-issue repair
  // -------------------------------------------------------------------------
  app.post('/api/ai/repair-issue', isAuthenticated, aiRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!isOpenRouterConfigured()) {
      return res.status(503).json({ message: getOpenRouterConfigError() });
    }

    const { prdContent, issue, language, templateCategory, originalRequest, prdId } = req.body;
    const userId = req.user.claims.sub;
    const aiPreferenceUserId = resolveAiPreferenceUserId(req, userId);

    if (!prdContent || typeof prdContent !== 'string') {
      return res.status(400).json({ message: 'prdContent is required' });
    }
    if (!issue || typeof issue.code !== 'string' || typeof issue.sectionKey !== 'string' || typeof issue.message !== 'string') {
      return res.status(400).json({ message: 'issue with code, sectionKey, and message is required' });
    }

    const validActions = ['rewrite', 'enrich'] as const;
    const suggestedAction = validActions.includes(issue.suggestedAction)
      ? issue.suggestedAction as 'rewrite' | 'enrich'
      : 'rewrite';

    const { logAiUsage } = await import('./aiUsageLogger');

    const result = await repairSingleIssue({
      prdContent,
      issue: {
        code: issue.code,
        sectionKey: issue.sectionKey,
        message: issue.message,
        suggestedAction,
        targetFields: issue.targetFields,
        suggestedFix: issue.suggestedFix,
      },
      language: language === 'de' ? 'de' : 'en',
      templateCategory,
      originalRequest,
      userId: aiPreferenceUserId,
      maxAttempts: 3,
    });

    // Log usage
    await logAiUsage(userId, 'semantic_repair', result.model, 'unknown', result.tokenUsage, prdId).catch(() => {});

    res.json(result);
  }));

  app.post('/api/ai/generate-iterative', isAuthenticated, aiRateLimiter, async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest;
    const requestStartedAt = Date.now();
    let editablePrdId: string | null = null;
    let userId = '';
    let useSSE = false;
    let sseClosed = false;
    let sseCompleted = false;
    let cleanupSseListeners = () => {};
    const requestAbortController = new AbortController();
    let activePhase = 'idle';
    let lastProgressEvent: string | undefined;
    let lastModelAttempt: ModelCallAttemptUpdate | undefined;
    const isRequestClosed = () =>
      isIterativeClientDisconnected({
        sseClosed,
        reqAborted: req.aborted,
        reqDestroyed: req.destroyed,
        resWritableEnded: res.writableEnded,
        resDestroyed: res.destroyed,
      });
    const updateActivePhaseFromEvent = (eventType: string) => {
      switch (eventType) {
        case 'iteration_start':
          activePhase = 'iteration_generator';
          break;
        case 'generator_done':
          activePhase = 'iteration_review';
          break;
        case 'features_expanded':
          activePhase = 'feature_expansion';
          break;
        case 'answerer_done':
          activePhase = 'iteration_answerer';
          break;
        case 'final_review_start':
        case 'final_review_done':
          activePhase = 'final_review';
          break;
        case 'compiler_finalization_start':
          activePhase = 'compiler_finalization';
          break;
        case 'content_review_start':
          activePhase = 'content_review';
          break;
        case 'semantic_repair_start':
        case 'semantic_repair_done':
          activePhase = 'semantic_repair';
          break;
        case 'early_drift_detected':
        case 'early_drift_repair_start':
        case 'early_drift_repair_done':
          activePhase = 'early_drift';
          break;
        case 'semantic_verification_start':
          activePhase = 'semantic_verification';
          break;
        case 'final_persist_start':
          activePhase = 'final_persist';
          break;
        case 'complete':
          activePhase = 'complete';
          break;
        default:
          break;
      }
    };
    const buildIterativeDiagnosticBase = (base?: object) => ({
      ...(base || {}),
      activePhase,
      lastProgressEvent,
      ...(lastModelAttempt ? { lastModelAttempt } : {}),
    });
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
      userId = authReq.user.claims.sub;
	      const aiPreferenceUserId = resolveAiPreferenceUserId(authReq, userId);
      editablePrdId = await requireEditablePrdId(storage, authReq, res, prdId, {
        invalidMessage: "PRD ID must be a non-empty string",
      });
      if (prdId !== undefined && prdId !== null && !editablePrdId) {
        return;
      }
      const templateCategory = await resolveTemplateCategoryForPrd(editablePrdId);

      logger.info("Iterative request received", {
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
      logger.info("Iterative execution started", {
        hasPrdId: !!editablePrdId,
        mode: finalMode,
        iterationCount: iterations,
        useFinalReview: !!useFinalReview,
        hasExistingContent: hasExistingContent || hasLegacyContent,
        hasAdditionalRequirements: !!hasAdditionalReqs,
        useSSE,
      });

      const handleSseDisconnect = () => {
        if (sseClosed) return;
        sseClosed = true;
        if (!requestAbortController.signal.aborted) {
          requestAbortController.abort(new Error('Iterative SSE client disconnected'));
        }
        if (!sseCompleted) {
          logger.warn("Iterative SSE client disconnected", {
            hasPrdId: !!editablePrdId,
            activePhase,
            lastProgressEvent: lastProgressEvent || null,
            lastModelAttempt: lastModelAttempt || null,
          });
        }
        cleanupSseListeners();
        safeEndSse();
      };

      // SSE progress callback — sends events to the client during long-running iterative runs
      const sendSSE = useSSE
        ? (event: { type: string; [key: string]: any }) => {
            if (isRequestClosed()) return;
            lastProgressEvent = event.type;
            updateActivePhaseFromEvent(event.type);
            try {
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            } catch {
              handleSseDisconnect();
            }
          }
        : undefined;

      if (useSSE) {
        // Important: req 'close' can fire once request body is fully read.
        // Use response close + request aborted as real client-disconnect signals.
        res.on('close', handleSseDisconnect);
        req.on('aborted', handleSseDisconnect);
        cleanupSseListeners = () => {
          res.off('close', handleSseDisconnect);
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
	        aiPreferenceUserId,
        sendSSE,
        isRequestClosed,
        requestAbortController.signal,
        (attempt) => {
          lastModelAttempt = attempt;
          if (attempt.phase) {
            activePhase = attempt.phase;
          }
        },
        templateCategory
      );

      if (isRequestClosed()) {
        logger.debug("Iterative request closed before response", {
          hasPrdId: !!editablePrdId,
          activePhase,
          lastProgressEvent: lastProgressEvent || null,
          lastModelAttempt: lastModelAttempt || null,
        });
        const disconnectFailure = classifyRunFailure(
          new Error(`Iterative generation cancelled during ${activePhase || 'unknown phase'}`),
          buildIterativeDiagnosticBase(result.diagnostics || {}),
        );
        void persistCompilerRunArtifactBestEffort({
          workflow: 'iterative',
          routeKey: useSSE ? 'iterative-stream' : 'iterative-generate',
          qualityStatus: disconnectFailure.qualityStatus,
          finalizationStage: 'final',
          finalContent: disconnectFailure.finalContent || undefined,
          compilerDiagnostics: disconnectFailure.diagnostics,
          requestContext: {
            prdId: editablePrdId || null,
            useSSE,
            effectiveMode: finalMode,
            templateCategory: templateCategory || null,
          },
          stageData: withArtifactMetrics({
            requestStartedAt,
            timings: result.timings || null,
            totalTokens: result.totalTokens,
            stageData: {
              errorMessage: 'Client disconnected before iterative response was sent.',
              activePhase,
              lastProgressEvent: lastProgressEvent || null,
              lastModelAttempt: lastModelAttempt || null,
              finalReview: result.finalReview || null,
              compilerArtifact: result.compilerArtifact || null,
            },
          }),
        });
        if (editablePrdId && userId) {
          try {
            const existingPrd = await storage.getPrd(editablePrdId);
            if (existingPrd) {
              await storage.persistPrdRunFinalization({
                prdId: editablePrdId,
                userId,
                qualityStatus: disconnectFailure.qualityStatus,
                finalizationStage: 'final',
                iterationLog: mergeDiagnosticsIntoIterationLog(result.iterationLog || existingPrd.iterationLog, disconnectFailure.qualityStatus, disconnectFailure.diagnostics),
                compilerDiagnostics: disconnectFailure.diagnostics,
              });
            }
          } catch (persistFailureError) {
            logger.error("Iterative disconnect diagnostics persistence failed", { error: persistFailureError });
          }
        }
        return;
      }
      logger.info("Iterative service completed", {
        hasPrdId: !!editablePrdId,
        finalContentLength: (result.finalContent || "").length,
        iterationCount: result.iterations?.length || 0,
      });

      const iterativeModeResolution = resolvePrdWorkflowMode({
        requestedMode: finalMode,
        existingContent: finalExistingContent || '',
      });

      const assessed = assessCompilerOutcome({
        content: result.finalContent || (result as any).mergedPRD || '',
        mode: finalMode,
        existingContent: finalMode === 'improve' ? finalExistingContent : undefined,
        templateCategory,
        baseDiagnostics: buildIterativeDiagnosticBase(result.diagnostics || {}),
      });

      const includeVerboseIterations = process.env.DEBUG_ITERATIVE_VERBOSE === "true";
      const slimResult: any = {
        finalContent: result.finalContent || (result as any).mergedPRD || '',
        iterationLog: result.iterationLog,
        totalTokens: result.totalTokens,
        modelsUsed: result.modelsUsed,
        diagnostics: result.diagnostics,
        qualityStatus: assessed.qualityStatus,
        compilerDiagnostics: assessed.compilerDiagnostics,
        finalizationStage: assessed.finalizationStage,
        effectiveMode: finalMode,
        baselineFeatureCount: iterativeModeResolution.assessment.featureCount,
        baselinePartial: iterativeModeResolution.assessment.baselinePartial,
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

      const contentToPersist = assessed.compiled.content;
      const saveRequested = !!(editablePrdId && assessed.qualityStatus === 'passed' && contentToPersist && contentToPersist.trim().length > 0);
      slimResult.autoSaveRequested = saveRequested;
      logger.debug("Iterative autosave decision", {
        hasPrdId: !!editablePrdId,
        saveRequested,
        qualityStatus: assessed.qualityStatus,
      });

      // Respond first to avoid blocking UI on DB writes for large runs.
      if (useSSE) {
        sendSSE?.({ type: 'final_persist_start', autoSaveRequested: saveRequested });
        if (!isRequestClosed()) {
          if (assessed.qualityStatus === 'passed') {
            res.write(`event: result\ndata: ${JSON.stringify(slimResult)}\n\n`);
          } else {
            res.write(`event: error\ndata: ${JSON.stringify({
              message: 'Compiler quality gate failed after final verification.',
              ...slimResult,
            })}\n\n`);
          }
        }
        sseCompleted = true;
        safeEndSse();
      } else if (assessed.qualityStatus === 'passed') {
        res.json(slimResult);
      } else {
        res.status(qualityStatusHttpCode(assessed.qualityStatus)).json({
          message: 'Compiler quality gate failed after final verification.',
          ...slimResult,
        });
      }
      logger.info("Iterative response sent", {
        hasPrdId: !!editablePrdId,
        qualityStatus: assessed.qualityStatus,
      });

      void persistCompilerRunArtifactBestEffort({
        workflow: 'iterative',
        routeKey: useSSE ? 'iterative-stream' : 'iterative-generate',
        qualityStatus: assessed.qualityStatus,
        finalizationStage: assessed.finalizationStage,
        finalContent: slimResult.finalContent,
        compiledContent: assessed.compiled.content,
        compiledStructure: assessed.compiled.structure,
        quality: assessed.compiled.quality,
        compilerDiagnostics: assessed.compilerDiagnostics,
        iterationLog: result.iterationLog,
        modelsUsed: result.modelsUsed,
        requestContext: {
          effectiveMode: finalMode,
          templateCategory: templateCategory || null,
          baselineFeatureCount: iterativeModeResolution.assessment.featureCount,
          baselinePartial: iterativeModeResolution.assessment.baselinePartial,
          prdId: editablePrdId || null,
          useSSE,
        },
        stageData: withArtifactMetrics({
          requestStartedAt,
          timings: result.timings || null,
          totalTokens: result.totalTokens,
          stageData: {
          activePhase,
          lastProgressEvent: lastProgressEvent || null,
          lastModelAttempt: lastModelAttempt || null,
          iterations: result.iterations,
          finalReview: result.finalReview || null,
          compilerArtifact: result.compilerArtifact || null,
          },
        }),
      });

      if (editablePrdId) {
        (async () => {
          try {
            const existingPrd = await storage.getPrd(editablePrdId!);
            if (!existingPrd) {
              logger.warn("Iterative finalization persistence skipped because PRD was not found", { prdId: editablePrdId });
              return;
            }

            const iterationLog = mergeDiagnosticsIntoIterationLog(
              result.iterationLog || existingPrd.iterationLog,
              assessed.qualityStatus,
              assessed.compilerDiagnostics
            );

            await storage.persistPrdRunFinalization({
              prdId: editablePrdId!,
              userId,
              qualityStatus: assessed.qualityStatus,
              finalizationStage: 'final',
              content: contentToPersist,
              iterationLog,
              structuredContent: result.structuredContent || assessed.compiled.structure,
              compilerDiagnostics: assessed.compilerDiagnostics,
            });
            logger.info("Iterative finalization persisted", {
              prdId: editablePrdId,
              qualityStatus: assessed.qualityStatus,
              contentLength: (contentToPersist || '').length,
              finalContentLength: (result.finalContent || '').length,
            });
          } catch (saveError) {
            logger.error("Iterative finalization persistence failed", { error: saveError });
          }
        })();
      }

      // AI usage logging is best-effort and must never block response completion.
      (async () => {
        try {
          // Tier aus User-Preferences auflösen statt hardcodiert 'development'
          const [userRow] = await db
            .select({ aiPreferences: users.aiPreferences })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
          const userTier = resolveModelTier((userRow?.aiPreferences as any)?.tier);

          for (const iteration of result.iterations) {
            const splitTokens = splitTokenCount(iteration.tokensUsed);
            await logAiUsage(
              userId,
              'generator',
              result.modelsUsed[0] || 'unknown',
              userTier,
              {
                prompt_tokens: 0,
                completion_tokens: splitTokens.first,
                total_tokens: splitTokens.first
              },
              editablePrdId || undefined
            );

            await logAiUsage(
              userId,
              'reviewer',
              result.modelsUsed[1] || result.modelsUsed[0] || 'unknown',
              userTier,
              {
                prompt_tokens: 0,
                completion_tokens: splitTokens.second,
                total_tokens: splitTokens.second
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
      const cancelledOrClosed = error?.name === 'AbortError' || error?.code === 'ERR_CLIENT_DISCONNECT' || isRequestClosed();
      const failure = classifyRunFailure(error, buildIterativeDiagnosticBase());
      if (cancelledOrClosed) {
        logger.warn("Iterative request aborted by client", {
          activePhase,
          lastProgressEvent: lastProgressEvent || null,
          lastModelAttempt: lastModelAttempt || null,
        });
      } else {
        logger.error("Iterative AI generation failed", { error, activePhase, lastProgressEvent, lastModelAttempt });
      }
      void persistCompilerRunArtifactBestEffort({
        workflow: 'iterative',
        routeKey: useSSE ? 'iterative-stream' : 'iterative-generate',
        qualityStatus: failure.qualityStatus,
        finalizationStage: 'final',
        finalContent: failure.finalContent || undefined,
        compiledContent: failure.compiledContent || undefined,
        compiledStructure: failure.compiledStructure || undefined,
        quality: failure.quality || undefined,
        compilerDiagnostics: failure.diagnostics,
        requestContext: {
          prdId: editablePrdId || null,
          useSSE,
        },
        stageData: withArtifactMetrics({
          requestStartedAt,
          stageData: {
          errorMessage: failure.message,
          qualityError: error instanceof Error ? error.message : String(error || ''),
          activePhase,
          lastProgressEvent: lastProgressEvent || null,
          lastModelAttempt: lastModelAttempt || null,
          },
        }),
      });
      if (!cancelledOrClosed && useSSE && res.headersSent && !res.writableEnded && !res.destroyed) {
        res.write(`event: error\ndata: ${JSON.stringify({
          message: failure.message,
          finalContent: failure.finalContent || undefined,
          qualityStatus: failure.qualityStatus,
          compilerDiagnostics: failure.diagnostics,
          finalizationStage: 'final',
          autoSaveRequested: false,
        })}\n\n`);
        res.end();
      } else if (!cancelledOrClosed) {
        res.status(qualityStatusHttpCode(failure.qualityStatus)).json({
          message: failure.message,
          finalContent: failure.finalContent || undefined,
          qualityStatus: failure.qualityStatus,
          compilerDiagnostics: failure.diagnostics,
          finalizationStage: 'final',
          autoSaveRequested: false,
        });
      }

      if (editablePrdId && userId) {
        try {
          const existingPrd = await storage.getPrd(editablePrdId);
          if (existingPrd) {
            await storage.persistPrdRunFinalization({
              prdId: editablePrdId,
              userId,
              qualityStatus: failure.qualityStatus,
              finalizationStage: 'final',
              content: failure.finalContent || failure.compiledContent || undefined,
              structuredContent: failure.compiledStructure || undefined,
              iterationLog: mergeDiagnosticsIntoIterationLog(existingPrd.iterationLog, failure.qualityStatus, failure.diagnostics),
              compilerDiagnostics: failure.diagnostics,
            });
          }
        } catch (persistFailureError) {
          logger.error("Iterative failure diagnostics persistence failed", { error: persistFailureError });
        }
      }
      if (cancelledOrClosed) {
        return;
      }
    } finally {
      cleanupSseListeners();
    }
  });

  await registerGuidedRoutes(app, isAuthenticated, aiRateLimiter, GUIDED_FINALIZE_TIMEOUT_MS);

  // ÄNDERUNG 08.03.2026: PRD-Export-/Restore-/Structure-Routen in eigenes kleines Registrierungsmodul ausgelagert.
  registerPrdMaintenanceRoutes(app, isAuthenticated, {
    storage,
    generateClaudeMD,
    generatePDF,
    generateWord,
    requirePrdAccess,
    getNextPrdVersionNumber,
    syncPrdHeaderMetadata,
    parsePRDToStructure,
    computeCompleteness,
    broadcastPrdUpdate,
  });

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

  // ÄNDERUNG 08.03.2026: Linear-/Dart-Integrationsrouten in eigenes kleines Registrierungsmodul ausgelagert.
  registerIntegrationRoutes(app, isAuthenticated);

  const httpServer = createServer(app);
  setupWebSocket(httpServer);
  return httpServer;
}
