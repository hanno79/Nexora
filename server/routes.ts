import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertPrdSchema } from "@shared/schema";
import { generatePRDContent } from "./anthropic";
import { exportToLinear, checkLinearConnection } from "./linearHelper";
import { initializeTemplates } from "./initTemplates";

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
      const templates = await storage.getTemplates();
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

  // AI generation route
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
      } else {
        res.status(400).json({ message: "Unsupported export format" });
      }
    } catch (error) {
      console.error("Error exporting PRD:", error);
      res.status(500).json({ message: "Failed to export PRD" });
    }
  });

  // Linear integration routes
  app.post('/api/linear/export', isAuthenticated, async (req: any, res) => {
    try {
      const { prdId, title, description } = req.body;
      
      if (!title) {
        return res.status(400).json({ message: "Title is required" });
      }
      
      const result = await exportToLinear(title, description || "");
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
