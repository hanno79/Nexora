// Database storage implementation - from javascript_database and javascript_log_in_with_replit blueprints
import {
  users,
  prds,
  templates,
  prdVersions,
  sharedPrds,
  comments,
  type User,
  type UpsertUser,
  type Prd,
  type InsertPrd,
  type Template,
  type InsertTemplate,
  type PrdVersion,
  type InsertPrdVersion,
  type SharedPrd,
  type InsertSharedPrd,
  type Comment,
  type InsertComment,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";

export interface IStorage {
  // User operations (required for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUser(id: string, data: Partial<UpsertUser>): Promise<User>;
  
  // PRD operations
  getPrds(userId: string): Promise<Prd[]>;
  getPrd(id: string): Promise<Prd | undefined>;
  createPrd(prd: InsertPrd): Promise<Prd>;
  updatePrd(id: string, data: Partial<InsertPrd>): Promise<Prd>;
  deletePrd(id: string): Promise<void>;
  
  // Template operations
  getTemplates(userId?: string): Promise<Template[]>;
  getTemplate(id: string): Promise<Template | undefined>;
  createTemplate(template: InsertTemplate): Promise<Template>;
  
  // Version operations
  getPrdVersions(prdId: string): Promise<PrdVersion[]>;
  createPrdVersion(version: InsertPrdVersion): Promise<PrdVersion>;
  
  // Sharing operations
  getSharedPrds(userId: string): Promise<SharedPrd[]>;
  getPrdShares(prdId: string): Promise<SharedPrd[]>;
  createSharedPrd(share: InsertSharedPrd): Promise<SharedPrd>;
  
  // Comment operations
  getComments(prdId: string): Promise<Comment[]>;
  createComment(comment: InsertComment): Promise<Comment>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async updateUser(id: string, data: Partial<UpsertUser>): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  // PRD operations
  async getPrds(userId: string): Promise<Prd[]> {
    return await db
      .select()
      .from(prds)
      .where(eq(prds.userId, userId))
      .orderBy(desc(prds.updatedAt));
  }

  async getPrd(id: string): Promise<Prd | undefined> {
    const [prd] = await db.select().from(prds).where(eq(prds.id, id));
    return prd;
  }

  async createPrd(prdData: InsertPrd): Promise<Prd> {
    const [prd] = await db.insert(prds).values(prdData).returning();
    return prd;
  }

  async updatePrd(id: string, data: Partial<InsertPrd>): Promise<Prd> {
    const [prd] = await db
      .update(prds)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(prds.id, id))
      .returning();
    return prd;
  }

  async deletePrd(id: string): Promise<void> {
    await db.delete(prds).where(eq(prds.id, id));
  }

  // Template operations
  async getTemplates(userId?: string): Promise<Template[]> {
    // Return default templates + user's custom templates
    if (userId) {
      return await db
        .select()
        .from(templates)
        .where(
          sql`${templates.isDefault} = 'true' OR ${templates.userId} = ${userId}`
        )
        .orderBy(templates.name);
    }
    return await db.select().from(templates).orderBy(templates.name);
  }

  async getTemplate(id: string): Promise<Template | undefined> {
    const [template] = await db.select().from(templates).where(eq(templates.id, id));
    return template;
  }

  async createTemplate(templateData: InsertTemplate): Promise<Template> {
    const [template] = await db.insert(templates).values(templateData).returning();
    return template;
  }

  // Version operations
  async getPrdVersions(prdId: string): Promise<PrdVersion[]> {
    return await db
      .select()
      .from(prdVersions)
      .where(eq(prdVersions.prdId, prdId))
      .orderBy(desc(prdVersions.createdAt));
  }

  async createPrdVersion(versionData: InsertPrdVersion): Promise<PrdVersion> {
    const [version] = await db.insert(prdVersions).values(versionData).returning();
    return version;
  }

  // Sharing operations
  async getSharedPrds(userId: string): Promise<SharedPrd[]> {
    return await db
      .select()
      .from(sharedPrds)
      .where(eq(sharedPrds.sharedWith, userId));
  }

  async getPrdShares(prdId: string): Promise<SharedPrd[]> {
    return await db
      .select()
      .from(sharedPrds)
      .where(eq(sharedPrds.prdId, prdId));
  }

  async createSharedPrd(shareData: InsertSharedPrd): Promise<SharedPrd> {
    const [share] = await db.insert(sharedPrds).values(shareData).returning();
    return share;
  }

  // Comment operations
  async getComments(prdId: string): Promise<Comment[]> {
    return await db
      .select()
      .from(comments)
      .where(eq(comments.prdId, prdId))
      .orderBy(comments.createdAt);
  }

  async createComment(commentData: InsertComment): Promise<Comment> {
    const [comment] = await db.insert(comments).values(commentData).returning();
    return comment;
  }
}

export const storage = new DatabaseStorage();
