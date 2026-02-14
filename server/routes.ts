import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertPrdSchema, users, aiPreferencesSchema } from "@shared/schema";
import { generatePRDContent } from "./anthropic";
import { exportToLinear, checkLinearConnection } from "./linearHelper";
import { exportToDart, updateDartDoc, checkDartConnection, getDartboards } from "./dartHelper";
import { generatePDF, generateWord } from "./exportUtils";
import { generateClaudeMD } from "./claudemdGenerator";
import { initializeTemplates } from "./initTemplates";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { z } from "zod";

/**
 * Synchronizes PRD content header metadata with actual PRD data.
 * Updates Version and Status fields in the document if they exist.
 * Supports both English and German field names and values.
 */
function syncPrdHeaderMetadata(
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

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize templates
  await initializeTemplates();
  
  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.patch('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { firstName, lastName, company, role } = req.body;
      const user = await storage.updateUser(userId, {
        firstName,
        lastName,
        company,
        role,
      });
      res.json(user);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // User routes
  app.get('/api/users', isAuthenticated, async (req: any, res) => {
    try {
      const allUsers = await db.select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        profileImageUrl: users.profileImageUrl,
      }).from(users);
      res.json(allUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // AI Settings routes
  app.get('/api/settings/ai', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await db.select({
        aiPreferences: users.aiPreferences
      }).from(users).where(eq(users.id, userId)).limit(1);
      
      const preferences = user[0]?.aiPreferences || {
        generatorModel: 'google/gemini-2.5-flash',
        reviewerModel: 'anthropic/claude-sonnet-4',
        tier: 'production'
      };
      
      res.json(preferences);
    } catch (error) {
      console.error("Error fetching AI settings:", error);
      res.status(500).json({ message: "Failed to fetch AI settings" });
    }
  });

  app.patch('/api/settings/ai', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const preferences = aiPreferencesSchema.parse(req.body);
      
      await db.update(users)
        .set({ 
          aiPreferences: preferences as any,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));
      
      res.json(preferences);
    } catch (error) {
      console.error("Error updating AI settings:", error);
      res.status(500).json({ message: "Failed to update AI settings" });
    }
  });

  // Language Settings routes
  app.patch('/api/settings/language', isAuthenticated, async (req: any, res) => {
    try {
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
    } catch (error: any) {
      console.error("Error updating language settings:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid language settings. Supported values: 'auto', 'en', 'de'" });
      }
      res.status(500).json({ message: "Failed to update language settings" });
    }
  });

  // Dashboard routes
  app.get('/api/dashboard/stats', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const prds = await storage.getPrds(userId);
      
      const stats = {
        totalPrds: prds.length,
        inProgress: prds.filter(p => p.status === 'in-progress').length,
        completed: prds.filter(p => p.status === 'completed').length,
        exportedToLinear: prds.filter(p => p.linearIssueId).length,
        exportedToDart: prds.filter(p => p.dartDocId).length,
      };
      
      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  });

  // PRD routes
  app.get('/api/prds', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const prds = await storage.getPrds(userId);
      res.json(prds);
    } catch (error) {
      console.error("Error fetching PRDs:", error);
      res.status(500).json({ message: "Failed to fetch PRDs" });
    }
  });

  app.get('/api/prds/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const prd = await storage.getPrd(id);
      
      if (!prd) {
        return res.status(404).json({ message: "PRD not found" });
      }
      
      res.json(prd);
    } catch (error) {
      console.error("Error fetching PRD:", error);
      res.status(500).json({ message: "Failed to fetch PRD" });
    }
  });

  app.post('/api/prds', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const prdData = insertPrdSchema.parse({
        ...req.body,
        userId,
      });
      
      const prd = await storage.createPrd(prdData);
      res.json(prd);
    } catch (error: any) {
      console.error("Error creating PRD:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid PRD data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create PRD" });
    }
  });

  app.patch('/api/prds/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const prd = await storage.getPrd(id);
      
      if (!prd) {
        return res.status(404).json({ message: "PRD not found" });
      }
      
      // If content is being updated, synchronize header metadata
      let updateData = { ...req.body };
      if (updateData.content) {
        // Get current version count to determine version number
        const versions = await storage.getPrdVersions(id);
        const versionNumber = versions.length > 0 ? `v${versions.length}` : null;
        const status = updateData.status || prd.status;
        
        // Sync the header metadata in the content
        updateData.content = syncPrdHeaderMetadata(
          updateData.content,
          versionNumber,
          status
        );
      }
      
      const updated = await storage.updatePrd(id, updateData);
      res.json(updated);
    } catch (error) {
      console.error("Error updating PRD:", error);
      res.status(500).json({ message: "Failed to update PRD" });
    }
  });

  app.delete('/api/prds/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      await storage.deletePrd(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting PRD:", error);
      res.status(500).json({ message: "Failed to delete PRD" });
    }
  });

  // Template routes
  app.get('/api/templates', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const templates = await storage.getTemplates(userId);
      res.json(templates);
    } catch (error) {
      console.error("Error fetching templates:", error);
      res.status(500).json({ message: "Failed to fetch templates" });
    }
  });

  app.get('/api/templates/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const template = await storage.getTemplate(id);
      
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }
      
      res.json(template);
    } catch (error) {
      console.error("Error fetching template:", error);
      res.status(500).json({ message: "Failed to fetch template" });
    }
  });

  app.post('/api/templates', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { name, description, category, content } = req.body;
      
      if (!name || !content) {
        return res.status(400).json({ message: "Name and content are required" });
      }
      
      const template = await storage.createTemplate({
        name,
        description,
        category: category || 'custom',
        content,
        userId,
        isDefault: 'false',
      });
      
      res.json(template);
    } catch (error) {
      console.error("Error creating template:", error);
      res.status(500).json({ message: "Failed to create template" });
    }
  });

  // Version routes
  app.get('/api/prds/:id/versions', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const versions = await storage.getPrdVersions(id);
      res.json(versions);
    } catch (error) {
      console.error("Error fetching versions:", error);
      res.status(500).json({ message: "Failed to fetch versions" });
    }
  });

  app.post('/api/prds/:id/versions', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.claims.sub;
      const prd = await storage.getPrd(id);
      
      if (!prd) {
        return res.status(404).json({ message: "PRD not found" });
      }

      const versions = await storage.getPrdVersions(id);
      const versionNumber = `v${versions.length + 1}`;
      
      const version = await storage.createPrdVersion({
        prdId: id,
        versionNumber,
        title: prd.title,
        content: prd.content,
        createdBy: userId,
      });
      
      res.json(version);
    } catch (error) {
      console.error("Error creating version:", error);
      res.status(500).json({ message: "Failed to create version" });
    }
  });

  app.delete('/api/prds/:id/versions/:versionId', isAuthenticated, async (req: any, res) => {
    try {
      const { id, versionId } = req.params;
      const userId = req.user.claims.sub;
      
      const prd = await storage.getPrd(id);
      if (!prd) {
        return res.status(404).json({ message: "PRD not found" });
      }
      
      // Check if user owns the PRD or has edit permission
      if (prd.userId !== userId) {
        const shares = await storage.getPrdShares(id);
        const userShare = shares.find(s => s.sharedWith === userId && s.permission === 'edit');
        if (!userShare) {
          return res.status(403).json({ message: "You don't have permission to delete versions for this PRD" });
        }
      }
      
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
    } catch (error) {
      console.error("Error deleting version:", error);
      res.status(500).json({ message: "Failed to delete version" });
    }
  });

  // Share routes
  app.post('/api/prds/:id/share', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { email, permission } = req.body;
      
      // Find user by email
      const sharedUser = await storage.getUserByEmail(email);
      if (!sharedUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const shareData = {
        prdId: id,
        sharedWith: sharedUser.id,
        permission: permission || 'view',
      };
      
      const share = await storage.createSharedPrd(shareData);
      res.json(share);
    } catch (error) {
      console.error("Error sharing PRD:", error);
      res.status(500).json({ message: "Failed to share PRD" });
    }
  });

  app.get('/api/prds/:id/shares', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const shares = await storage.getPrdShares(id);
      res.json(shares);
    } catch (error) {
      console.error("Error fetching shares:", error);
      res.status(500).json({ message: "Failed to fetch shares" });
    }
  });

  // Comment routes
  app.get('/api/prds/:id/comments', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const commentsData = await storage.getComments(id);
      
      // Enrich comments with user information
      const commentsWithUsers = await Promise.all(
        commentsData.map(async (comment) => {
          const user = await storage.getUser(comment.userId);
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
        })
      );
      
      res.json(commentsWithUsers);
    } catch (error) {
      console.error("Error fetching comments:", error);
      res.status(500).json({ message: "Failed to fetch comments" });
    }
  });

  app.post('/api/prds/:id/comments', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
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
    } catch (error) {
      console.error("Error creating comment:", error);
      res.status(500).json({ message: "Failed to create comment" });
    }
  });

  // Approval routes
  app.get('/api/prds/:id/approval', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const approval = await storage.getApproval(id);
      
      if (!approval) {
        return res.json(null);
      }
      
      // Enrich with requester info
      const requester = await storage.getUser(approval.requestedBy);
      const completer = approval.completedBy ? await storage.getUser(approval.completedBy) : null;
      
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
    } catch (error) {
      console.error("Error fetching approval:", error);
      res.status(500).json({ message: "Failed to fetch approval" });
    }
  });

  app.post('/api/prds/:id/approval/request', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.claims.sub;
      const { reviewers } = req.body;
      
      if (!reviewers || !Array.isArray(reviewers) || reviewers.length === 0) {
        return res.status(400).json({ message: "At least one reviewer is required" });
      }
      
      // Check if there's already a pending approval
      const existingApproval = await storage.getApproval(id);
      if (existingApproval && existingApproval.status === 'pending') {
        return res.status(400).json({ message: "There is already a pending approval request" });
      }
      
      const approval = await storage.createApproval({
        prdId: id,
        requestedBy: userId,
        reviewers,
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
    } catch (error) {
      console.error("Error requesting approval:", error);
      res.status(500).json({ message: "Failed to request approval" });
    }
  });

  app.post('/api/prds/:id/approval/respond', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.claims.sub;
      const { approved } = req.body;
      
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
    } catch (error) {
      console.error("Error responding to approval:", error);
      res.status(500).json({ message: "Failed to respond to approval" });
    }
  });

  // AI generation route (legacy - uses single Anthropic model)
  app.post('/api/ai/generate', isAuthenticated, async (req: any, res) => {
    try {
      const { prompt, currentContent } = req.body;
      
      if (!prompt) {
        return res.status(400).json({ message: "Prompt is required" });
      }
      
      const content = await generatePRDContent(prompt, currentContent || "");
      res.json({ content });
    } catch (error: any) {
      console.error("Error generating AI content:", error);
      res.status(500).json({ message: error.message || "Failed to generate AI content" });
    }
  });

  // OpenRouter models list endpoint
  const { isOpenRouterConfigured, getOpenRouterConfigError, fetchOpenRouterModels, MODEL_TIERS } = await import('./openrouter');
  
  app.get('/api/openrouter/models', isAuthenticated, async (req: any, res) => {
    try {
      if (!isOpenRouterConfigured()) {
        return res.status(503).json({ message: getOpenRouterConfigError() });
      }
      const models = await fetchOpenRouterModels();
      res.json({ models, tierDefaults: MODEL_TIERS });
    } catch (error: any) {
      console.error("Error fetching OpenRouter models:", error);
      res.status(500).json({ message: error.message || "Failed to fetch models" });
    }
  });

  // Dual-AI generation routes (HRP-17)
  const { getDualAiService } = await import('./dualAiService');
  const { logAiUsage } = await import('./aiUsageLogger');
  
  app.post('/api/ai/generate-dual', isAuthenticated, async (req: any, res) => {
    try {
      // Check if OpenRouter is configured
      if (!isOpenRouterConfigured()) {
        return res.status(503).json({ 
          message: getOpenRouterConfigError()
        });
      }
      
      const { userInput, existingContent, mode, prdId } = req.body;
      const userId = req.user.claims.sub;
      
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
        prdId
      );
      
      await logAiUsage(
        userId,
        'reviewer',
        result.reviewerResponse.model,
        result.reviewerResponse.tier as any,
        result.reviewerResponse.usage,
        prdId
      );
      
      res.json(result);
    } catch (error: any) {
      console.error("Error in Dual-AI generation:", error);
      
      // Pass through the detailed error message from OpenRouter/AI services
      const errorMessage = error.message || "Failed to generate PRD with AI. Please try again or check your API settings.";
      res.status(500).json({ message: errorMessage });
    }
  });

  app.post('/api/ai/review', isAuthenticated, async (req: any, res) => {
    try {
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
    } catch (error: any) {
      console.error("Error in AI review:", error);
      
      // Pass through the detailed error message from AI services
      const errorMessage = error.message || "Failed to review PRD content. Please try again or check your API settings.";
      res.status(500).json({ message: errorMessage });
    }
  });

  app.post('/api/ai/generate-iterative', isAuthenticated, async (req: any, res) => {
    try {
      // Check if OpenRouter is configured
      if (!isOpenRouterConfigured()) {
        return res.status(503).json({ 
          message: getOpenRouterConfigError()
        });
      }
      
      // Support both old format (initialContent) and new format (existingContent + additionalRequirements + mode)
      const { initialContent, existingContent, additionalRequirements, mode, iterationCount, useFinalReview, prdId } = req.body;
      const userId = req.user.claims.sub;
      
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
      const result = await service.generateIterative(
        finalExistingContent,
        finalAdditionalReqs,
        finalMode,
        iterations,
        useFinalReview || false,
        userId
      );
      
      // Log AI usage for iterative workflow
      // Log each iteration's generator and answerer usage
      for (const iteration of result.iterations) {
        // Generator usage
        await logAiUsage(
          userId,
          'generator',
          result.modelsUsed[0] || 'unknown',  // First model is typically generator
          'development',  // Using development tier for tests
          { 
            prompt_tokens: 0,  // Approximation - would need actual values
            completion_tokens: iteration.tokensUsed / 2,
            total_tokens: iteration.tokensUsed / 2
          },
          prdId
        );
        
        // Answerer usage
        await logAiUsage(
          userId,
          'reviewer',  // Answerer uses reviewer model
          result.modelsUsed[1] || result.modelsUsed[0] || 'unknown',
          'development',
          { 
            prompt_tokens: 0,
            completion_tokens: iteration.tokensUsed / 2,
            total_tokens: iteration.tokensUsed / 2
          },
          prdId
        );
      }
      
      // Log final review if used
      if (result.finalReview) {
        await logAiUsage(
          userId,
          'reviewer',
          result.finalReview.model,
          result.finalReview.tier as any,
          result.finalReview.usage,
          prdId
        );
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("Error in iterative AI generation:", error);
      
      // Pass through the detailed error message from AI services
      const errorMessage = error.message || "Failed to generate PRD with iterative AI workflow. Please try again or check your API settings.";
      res.status(500).json({ message: errorMessage });
    }
  });

  // Guided AI Workflow routes (User-involved PRD generation)
  const { getGuidedAiService } = await import('./guidedAiService');
  
  // Start guided workflow - returns initial analysis + questions
  app.post('/api/ai/guided-start', isAuthenticated, async (req: any, res) => {
    try {
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
    } catch (error: any) {
      console.error("Error starting guided workflow:", error);
      res.status(500).json({ message: error.message || "Failed to start guided workflow" });
    }
  });
  
  // Process user answers - returns refined plan + optional follow-up questions
  app.post('/api/ai/guided-answer', isAuthenticated, async (req: any, res) => {
    try {
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
    } catch (error: any) {
      console.error("Error processing guided answers:", error);
      res.status(500).json({ message: error.message || "Failed to process answers" });
    }
  });
  
  // Finalize PRD generation after guided workflow
  app.post('/api/ai/guided-finalize', isAuthenticated, async (req: any, res) => {
    try {
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
    } catch (error: any) {
      console.error("Error finalizing guided PRD:", error);
      res.status(500).json({ message: error.message || "Failed to finalize PRD" });
    }
  });
  
  // Skip guided workflow and generate PRD directly
  app.post('/api/ai/guided-skip', isAuthenticated, async (req: any, res) => {
    try {
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
    } catch (error: any) {
      console.error("Error in skip-to-finalize:", error);
      res.status(500).json({ message: error.message || "Failed to generate PRD" });
    }
  });

  // Export routes
  app.post('/api/prds/:id/export', isAuthenticated, async (req: any, res) => {
    const { format } = req.body;
    try {
      const { id } = req.params;
      const prd = await storage.getPrd(id);
      
      if (!prd) {
        return res.status(404).json({ message: "PRD not found" });
      }

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
    } catch (error: any) {
      console.error("Error exporting PRD:", error);
      
      // Provide specific error messages based on export format
      let errorMessage = "Failed to export PRD";
      
      if (format === 'pdf') {
        errorMessage = `Failed to generate PDF: ${error.message || 'Unknown error'}. The content might be too large or contain unsupported characters.`;
      } else if (format === 'word') {
        errorMessage = `Failed to generate Word document: ${error.message || 'Unknown error'}. The content might be too large or contain unsupported formatting.`;
      } else if (format === 'claudemd') {
        errorMessage = `Failed to generate CLAUDE.md: ${error.message || 'Unknown error'}. Please ensure the PRD contains valid technical content.`;
      } else if (format === 'markdown') {
        errorMessage = `Failed to generate Markdown: ${error.message || 'Unknown error'}.`;
      } else {
        errorMessage = error.message || "Failed to export PRD";
      }
      
      res.status(500).json({ message: errorMessage });
    }
  });

  // Version history endpoints
  app.get('/api/prds/:id/versions', isAuthenticated, async (req: any, res) => {
    try {
      const prdId = req.params.id;
      
      // Verify user has access to this PRD
      const prd = await storage.getPrd(prdId);
      if (!prd) {
        return res.status(404).json({ message: "PRD not found" });
      }
      
      if (prd.userId !== req.user.claims.sub) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const versions = await storage.getPrdVersions(prdId);
      res.json(versions);
    } catch (error) {
      console.error('Error fetching versions:', error);
      res.status(500).json({ message: "Failed to fetch versions" });
    }
  });
  
  // Restore PRD to specific version
  app.post('/api/prds/:id/restore/:versionId', isAuthenticated, async (req: any, res) => {
    try {
      const { id: prdId, versionId } = req.params;
      
      // Verify user has access to this PRD
      const prd = await storage.getPrd(prdId);
      if (!prd) {
        return res.status(404).json({ message: "PRD not found" });
      }
      
      if (prd.userId !== req.user.claims.sub) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // Get the version
      const versions = await storage.getPrdVersions(prdId);
      const version = versions.find(v => v.id === versionId);
      
      if (!version) {
        return res.status(404).json({ message: "Version not found" });
      }
      
      // Use versions.length + 1 because the restore operation will create a new version snapshot
      const newVersionNumber = `v${versions.length + 1}`;
      const status = version.status as 'draft' | 'in-progress' | 'review' | 'pending-approval' | 'approved' | 'completed';
      
      // Sync the header metadata in the restored content with the new version number
      const syncedContent = syncPrdHeaderMetadata(
        version.content,
        newVersionNumber,
        status
      );
      
      // Restore complete state from version (with synced header)
      const updatedPrd = await storage.updatePrd(prdId, {
        title: version.title,
        description: version.description,
        content: syncedContent,
        status: status,
      });
      
      res.json(updatedPrd);
    } catch (error) {
      console.error('Error restoring version:', error);
      res.status(500).json({ message: "Failed to restore version" });
    }
  });

  // Error logging endpoint
  app.post('/api/errors', async (req: any, res) => {
    try {
      const { message, stack, componentStack, timestamp, userAgent } = req.body;
      
      // Log error to console (in production, this would go to monitoring service)
      console.error('[Frontend Error]', {
        timestamp,
        message,
        stack,
        componentStack,
        userAgent,
        userId: req.user?.id || 'anonymous',
      });
      
      // In production, you would send this to error tracking service:
      // - Sentry
      // - LogRocket
      // - Datadog
      // - CloudWatch
      
      res.status(200).json({ message: 'Error logged' });
    } catch (error) {
      console.error('Error logging error:', error);
      res.status(500).json({ message: 'Failed to log error' });
    }
  });

  // Linear integration routes
  app.post('/api/linear/export', isAuthenticated, async (req: any, res) => {
    try {
      const { prdId, title, description } = req.body;
      
      if (!title || !prdId) {
        return res.status(400).json({ message: "Title and PRD ID are required" });
      }
      
      const result = await exportToLinear(title, description || "");
      
      // Update PRD with Linear issue details
      await storage.updatePrd(prdId, {
        linearIssueId: result.issueId,
        linearIssueUrl: result.url,
      });
      
      res.json(result);
    } catch (error: any) {
      console.error("Error exporting to Linear:", error);
      res.status(500).json({ message: error.message || "Failed to export to Linear" });
    }
  });

  app.get('/api/linear/status', isAuthenticated, async (req: any, res) => {
    try {
      const connected = await checkLinearConnection();
      res.json({ connected });
    } catch (error) {
      console.error("Error checking Linear status:", error);
      res.json({ connected: false });
    }
  });

  // Dart AI integration routes
  app.get('/api/dart/dartboards', isAuthenticated, async (req: any, res) => {
    try {
      const result = await getDartboards();
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching Dart AI dartboards:", error);
      res.status(500).json({ message: error.message || "Failed to fetch Dart AI dartboards" });
    }
  });

  app.post('/api/dart/export', isAuthenticated, async (req: any, res) => {
    try {
      const { prdId, title, content, folder } = req.body;
      
      if (!title || !prdId) {
        return res.status(400).json({ message: "Title and PRD ID are required" });
      }
      
      const result = await exportToDart(title, content || "", folder);
      
      // Update PRD with Dart AI doc details
      await storage.updatePrd(prdId, {
        dartDocId: result.docId,
        dartDocUrl: result.url,
        dartFolder: result.folder,
      });
      
      res.json(result);
    } catch (error: any) {
      console.error("Error exporting to Dart AI:", error);
      res.status(500).json({ message: error.message || "Failed to export to Dart AI" });
    }
  });

  app.get('/api/dart/status', isAuthenticated, async (req: any, res) => {
    try {
      const connected = await checkDartConnection();
      res.json({ connected });
    } catch (error) {
      console.error("Error checking Dart AI status:", error);
      res.json({ connected: false });
    }
  });

  // Dart AI update endpoint - sync existing doc with current PRD content
  app.put('/api/dart/update', isAuthenticated, async (req: any, res) => {
    try {
      const { prdId, docId, title, content } = req.body;
      
      if (!docId || !prdId) {
        return res.status(400).json({ message: "Document ID and PRD ID are required" });
      }
      
      const result = await updateDartDoc(docId, title || "Untitled", content || "");
      
      // Update PRD with latest Dart AI doc URL (might have changed)
      await storage.updatePrd(prdId, {
        dartDocUrl: result.url,
      });
      
      res.json(result);
    } catch (error: any) {
      console.error("Error updating Dart AI doc:", error);
      res.status(500).json({ message: error.message || "Failed to update Dart AI doc" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
