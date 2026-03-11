// Database storage implementation - from javascript_database and javascript_log_in_with_replit blueprints
import {
  users,
  prds,
  templates,
  prdVersions,
  sharedPrds,
  comments,
  approvals,
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
  type Approval,
  type InsertApproval,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";
import type { PRDStructure } from "./prdStructure";
import { assembleStructureToMarkdown } from "./prdAssembler";
import { parsePRDToStructure } from "./prdParser";
import { shouldCreatePrdVersionSnapshot } from "./prdVersioning";
import { buildPrdVersionSnapshot, getNextPrdVersionNumber } from "./prdVersioningUtils";
import { normalizeEmail, normalizeOptionalEmail } from "./emailUtils";
import { mergeDiagnosticsIntoIterationLog, type CompilerRunDiagnostics, type PrdFinalizationStage, type PrdQualityStatus } from "./prdRunQuality";

export interface PersistPrdRunFinalizationInput {
  prdId: string;
  userId: string;
  qualityStatus: PrdQualityStatus;
  finalizationStage: PrdFinalizationStage;
  content?: string;
  structuredContent?: PRDStructure | null;
  iterationLog?: string | null;
  compilerDiagnostics?: CompilerRunDiagnostics | null;
}

export interface IStorage {
  // User operations (required for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUser(id: string, data: Partial<UpsertUser>): Promise<User>;
  
  // PRD operations
  getPrds(userId: string, limit?: number, offset?: number): Promise<{ data: Prd[]; total: number }>;
  getDashboardStats(userId: string): Promise<{ totalPrds: number; inProgress: number; completed: number; exportedToLinear: number; exportedToDart: number }>;
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
  getPrdVersion(id: string): Promise<PrdVersion | undefined>;
  createPrdVersion(version: InsertPrdVersion): Promise<PrdVersion>;
  deletePrdVersion(id: string): Promise<void>;
  
  // Sharing operations
  getSharedPrds(userId: string): Promise<SharedPrd[]>;
  getPrdShares(prdId: string): Promise<SharedPrd[]>;
  createSharedPrd(share: InsertSharedPrd): Promise<SharedPrd>;
  updateSharedPrdPermission(id: string, permission: string): Promise<SharedPrd>;
  
  // Comment operations
  getComments(prdId: string, limit?: number, offset?: number): Promise<Comment[]>;
  createComment(comment: InsertComment): Promise<Comment>;
  
  // Approval operations
  getApproval(prdId: string): Promise<Approval | undefined>;
  createApproval(approval: InsertApproval): Promise<Approval>;
  updateApproval(id: string, data: { status: string; completedBy: string; completedAt: Date }): Promise<Approval>;

  // Structured content operations
  updatePrdStructure(id: string, structure: PRDStructure): Promise<Prd>;
  getPrdWithStructure(id: string): Promise<{ prd: Prd; structure: PRDStructure | null }>;
  persistPrdRunFinalization(input: PersistPrdRunFinalizationInput): Promise<Prd>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return undefined;
    }

    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${normalizedEmail}`);
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const normalizedEmail = normalizeOptionalEmail(userData.email);
    const normalizedUserData: UpsertUser = {
      ...userData,
      ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
    };

    const [user] = await db
      .insert(users)
      .values(normalizedUserData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...normalizedUserData,
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
  async getPrds(userId: string, limit = 50, offset = 0): Promise<{ data: Prd[]; total: number }> {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(prds)
      .where(eq(prds.userId, userId));

    const data = await db
      .select()
      .from(prds)
      .where(eq(prds.userId, userId))
      .orderBy(desc(prds.updatedAt))
      .limit(limit)
      .offset(offset);

    return { data, total: Number(count) };
  }

  async getDashboardStats(userId: string) {
    const [result] = await db
      .select({
        totalPrds: sql<number>`count(*)`,
        inProgress: sql<number>`count(*) filter (where ${prds.status} = 'in-progress')`,
        completed: sql<number>`count(*) filter (where ${prds.status} = 'completed')`,
        exportedToLinear: sql<number>`count(*) filter (where ${prds.linearIssueId} is not null)`,
        exportedToDart: sql<number>`count(*) filter (where ${prds.dartDocId} is not null)`,
      })
      .from(prds)
      .where(eq(prds.userId, userId));

    return {
      totalPrds: Number(result.totalPrds),
      inProgress: Number(result.inProgress),
      completed: Number(result.completed),
      exportedToLinear: Number(result.exportedToLinear),
      exportedToDart: Number(result.exportedToDart),
    };
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
    return await db.transaction(async (tx: any) => {
      // Get current PRD before update to create version snapshot
      const [currentPrd] = await tx.select().from(prds).where(eq(prds.id, id));
      const shouldCreateSnapshot = currentPrd
        ? shouldCreatePrdVersionSnapshot(currentPrd as Prd, data)
        : false;

      // Update the PRD
      const [prd] = await tx
        .update(prds)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(prds.id, id))
        .returning();

      // Auto-create version snapshot only for content-relevant changes (atomic with the update)
      if (currentPrd && shouldCreateSnapshot) {
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(prdVersions)
          .where(eq(prdVersions.prdId, id));

        const versionNumber = getNextPrdVersionNumber(Number(count) || 0);
        const snapshot = buildPrdVersionSnapshot(currentPrd as any, versionNumber, currentPrd.userId);
        await tx.insert(prdVersions).values(snapshot);
      }

      return prd;
    });
  }

  async deletePrd(id: string): Promise<void> {
    await db.transaction(async (tx: any) => {
      // Delete all related data first, then PRD — atomic
      await tx.delete(prdVersions).where(eq(prdVersions.prdId, id));
      await tx.delete(comments).where(eq(comments.prdId, id));
      await tx.delete(approvals).where(eq(approvals.prdId, id));
      await tx.delete(sharedPrds).where(eq(sharedPrds.prdId, id));
      await tx.delete(prds).where(eq(prds.id, id));
    });
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

  async getPrdVersion(id: string): Promise<PrdVersion | undefined> {
    const [version] = await db.select().from(prdVersions).where(eq(prdVersions.id, id));
    return version;
  }

  async createPrdVersion(versionData: InsertPrdVersion): Promise<PrdVersion> {
    const [version] = await db.insert(prdVersions).values(versionData).returning();
    return version;
  }

  async deletePrdVersion(id: string): Promise<void> {
    await db.delete(prdVersions).where(eq(prdVersions.id, id));
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

  async updateSharedPrdPermission(id: string, permission: string): Promise<SharedPrd> {
    const [share] = await db
      .update(sharedPrds)
      .set({ permission })
      .where(eq(sharedPrds.id, id))
      .returning();
    return share;
  }

  // Comment operations
  async getComments(prdId: string, limit = 200, offset = 0): Promise<Comment[]> {
    return await db
      .select()
      .from(comments)
      .where(eq(comments.prdId, prdId))
      .orderBy(comments.createdAt)
      .limit(limit)
      .offset(offset);
  }

  async createComment(commentData: InsertComment): Promise<Comment> {
    const [comment] = await db.insert(comments).values(commentData).returning();
    return comment;
  }

  // Approval operations
  async getApproval(prdId: string): Promise<Approval | undefined> {
    const [approval] = await db
      .select()
      .from(approvals)
      .where(eq(approvals.prdId, prdId))
      .orderBy(desc(approvals.requestedAt))
      .limit(1);
    return approval;
  }

  async createApproval(approvalData: InsertApproval): Promise<Approval> {
    const [approval] = await db.insert(approvals).values(approvalData).returning();
    return approval;
  }

  async updateApproval(
    id: string,
    data: { status: string; completedBy: string; completedAt: Date }
  ): Promise<Approval> {
    const [approval] = await db
      .update(approvals)
      .set(data)
      .where(eq(approvals.id, id))
      .returning();
    return approval;
  }
  // Structured content operations
  async updatePrdStructure(id: string, structure: PRDStructure): Promise<Prd> {
    const markdown = assembleStructureToMarkdown(structure);
    return this.updatePrd(id, {
      content: markdown,
      structuredContent: structure as any,
      structuredAt: new Date(),
    } as any);
  }

  async getPrdWithStructure(id: string): Promise<{ prd: Prd; structure: PRDStructure | null }> {
    const prd = await this.getPrd(id);
    if (!prd) throw new Error('PRD not found');

    // If persisted structured content exists, use it
    if ((prd as any).structuredContent) {
      return { prd, structure: (prd as any).structuredContent as PRDStructure };
    }

    // Fallback: parse from markdown (backward compatibility)
    try {
      const structure = parsePRDToStructure(prd.content);
      return { prd, structure };
    } catch {
      return { prd, structure: null };
    }
  }

  async persistPrdRunFinalization(input: PersistPrdRunFinalizationInput): Promise<Prd> {
    return await db.transaction(async (tx: any) => {
      const [currentPrd] = await tx.select().from(prds).where(eq(prds.id, input.prdId));
      if (!currentPrd) {
        throw new Error('PRD not found');
      }

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      const hasPersistableFinalContent = input.finalizationStage === 'final' &&
        input.qualityStatus !== 'cancelled' &&
        typeof input.content === 'string' &&
        input.content.trim().length > 0;

      const isFinalPassed = input.qualityStatus === 'passed' && hasPersistableFinalContent;

      if (typeof input.iterationLog === 'string') {
        updateData.iterationLog = input.iterationLog;
      } else if (input.iterationLog === null) {
        updateData.iterationLog = null;
      } else if (input.compilerDiagnostics && input.qualityStatus !== 'passed') {
        updateData.iterationLog = mergeDiagnosticsIntoIterationLog(
          currentPrd.iterationLog,
          input.qualityStatus,
          input.compilerDiagnostics
        );
      }

      if (hasPersistableFinalContent) {
        updateData.content = input.content!.trim();
        if (Object.prototype.hasOwnProperty.call(input, 'structuredContent')) {
          updateData.structuredContent = input.structuredContent as any;
          updateData.structuredAt = input.structuredContent ? new Date() : null;
        }
      }

      const [updatedPrd] = await tx
        .update(prds)
        .set(updateData)
        .where(eq(prds.id, input.prdId))
        .returning();

      if (isFinalPassed) {
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(prdVersions)
          .where(eq(prdVersions.prdId, input.prdId));

        const versionNumber = getNextPrdVersionNumber(Number(count) || 0);
        const snapshot = buildPrdVersionSnapshot({
          id: updatedPrd.id,
          title: updatedPrd.title,
          description: updatedPrd.description,
          content: updatedPrd.content,
          status: updatedPrd.status,
          structuredContent: (updatedPrd as any).structuredContent ?? null,
        }, versionNumber, input.userId);
        await tx.insert(prdVersions).values(snapshot);
      }

      return updatedPrd;
    });
  }
}

export const storage = new DatabaseStorage();
