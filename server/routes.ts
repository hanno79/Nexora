import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertPrdSchema, users } from "@shared/schema";
import { generatePRDContent } from "./anthropic";
import { exportToLinear, checkLinearConnection } from "./linearHelper";
import { generatePDF, generateWord } from "./exportUtils";
import { generateClaudeMD } from "./claudemdGenerator";
import { initializeTemplates } from "./initTemplates";
import { db } from "./db";

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
      
      const updated = await storage.updatePrd(id, req.body);
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

  // Dual-AI generation routes (HRP-17)
  const { getDualAiService } = await import('./dualAiService');
  
  app.post('/api/ai/generate-dual', isAuthenticated, async (req: any, res) => {
    try {
      const { userInput, existingContent, mode } = req.body;
      
      if (!userInput && !existingContent) {
        return res.status(400).json({ message: "User input or existing content is required" });
      }
      
      const service = getDualAiService();
      const result = await service.generatePRD({
        userInput: userInput || '',
        existingContent,
        mode: mode || 'improve'
      });
      
      res.json(result);
    } catch (error: any) {
      console.error("Error in Dual-AI generation:", error);
      res.status(500).json({ message: error.message || "Failed to generate with Dual-AI" });
    }
  });

  app.post('/api/ai/review', isAuthenticated, async (req: any, res) => {
    try {
      const { content } = req.body;
      
      if (!content) {
        return res.status(400).json({ message: "Content is required for review" });
      }
      
      const service = getDualAiService();
      const review = await service.reviewOnly(content);
      
      res.json(review);
    } catch (error: any) {
      console.error("Error in AI review:", error);
      res.status(500).json({ message: error.message || "Failed to review content" });
    }
  });

  // Export routes
  app.post('/api/prds/:id/export', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { format } = req.body;
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
    } catch (error) {
      console.error("Error exporting PRD:", error);
      res.status(500).json({ message: "Failed to export PRD" });
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
      
      if (prd.userId !== req.user.id) {
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
      
      if (prd.userId !== req.user.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // Get the version
      const versions = await storage.getPrdVersions(prdId);
      const version = versions.find(v => v.id === versionId);
      
      if (!version) {
        return res.status(404).json({ message: "Version not found" });
      }
      
      // Restore complete state from version
      const updatedPrd = await storage.updatePrd(prdId, {
        title: version.title,
        description: version.description,
        content: version.content,
        status: version.status as 'draft' | 'in-progress' | 'review' | 'pending-approval' | 'approved' | 'completed',
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

  const httpServer = createServer(app);
  return httpServer;
}
