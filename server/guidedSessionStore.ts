import { db } from './db';
import { guidedSessions } from '@shared/schema';
import { eq, and, lte, sql } from 'drizzle-orm';

export const DEFAULT_GUIDED_SESSION_TTL_MS = 30 * 60 * 1000;

export type GuidedSessionAccessStatus = "ok" | "not_found" | "forbidden" | "expired";

export interface GuidedSessionAccessResult<TContext> {
  status: GuidedSessionAccessStatus;
  context?: TContext;
}

/**
 * Port interface for guided session stores.
 * All methods are async to support both in-memory and DB-backed implementations.
 */
export interface GuidedSessionStorePort<TContext> {
  create(sessionId: string, ownerUserId: string, context: TContext): Promise<void>;
  get(sessionId: string, requestingUserId: string): Promise<GuidedSessionAccessResult<TContext>>;
  consume(sessionId: string, requestingUserId: string): Promise<GuidedSessionAccessResult<TContext>>;
  update(sessionId: string, requestingUserId: string, context: TContext): Promise<void>;
  delete(sessionId: string): Promise<void>;
  cleanupExpired(): Promise<number>;
}

// ── In-Memory Implementation (for unit tests) ──────────────────────────────

interface GuidedSessionRecord<TContext> {
  ownerUserId: string;
  expiresAt: number;
  context: TContext;
}

type TimeSource = () => number;

/**
 * In-memory session store with owner binding and expiration.
 * Used for unit tests via dependency injection.
 */
export class InMemoryGuidedSessionStore<TContext> implements GuidedSessionStorePort<TContext> {
  private readonly sessions = new Map<string, GuidedSessionRecord<TContext>>();

  constructor(
    private readonly ttlMs: number = DEFAULT_GUIDED_SESSION_TTL_MS,
    private readonly now: TimeSource = () => Date.now(),
  ) {}

  async create(sessionId: string, ownerUserId: string, context: TContext): Promise<void> {
    this.doCleanupExpired();
    this.sessions.set(sessionId, {
      ownerUserId,
      expiresAt: this.now() + this.ttlMs,
      context,
    });
  }

  async get(sessionId: string, requestingUserId: string): Promise<GuidedSessionAccessResult<TContext>> {
    return this.access(sessionId, requestingUserId, false);
  }

  async consume(sessionId: string, requestingUserId: string): Promise<GuidedSessionAccessResult<TContext>> {
    return this.access(sessionId, requestingUserId, true);
  }

  async update(sessionId: string, requestingUserId: string, context: TContext): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (!record || record.ownerUserId !== requestingUserId) return;
    record.context = context;
    record.expiresAt = this.now() + this.ttlMs;
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async cleanupExpired(): Promise<number> {
    return this.doCleanupExpired();
  }

  private doCleanupExpired(): number {
    const now = this.now();
    let removed = 0;
    for (const [sessionId, record] of this.sessions) {
      if (record.expiresAt <= now) {
        this.sessions.delete(sessionId);
        removed++;
      }
    }
    return removed;
  }

  private access(
    sessionId: string,
    requestingUserId: string,
    consume: boolean,
  ): GuidedSessionAccessResult<TContext> {
    const record = this.sessions.get(sessionId);
    if (!record) {
      this.doCleanupExpired();
      return { status: "not_found" };
    }

    if (record.ownerUserId !== requestingUserId) {
      return { status: "forbidden" };
    }

    const now = this.now();
    if (record.expiresAt <= now) {
      this.sessions.delete(sessionId);
      this.doCleanupExpired();
      return { status: "expired" };
    }

    this.doCleanupExpired();

    if (consume) {
      this.sessions.delete(sessionId);
    } else {
      record.expiresAt = now + this.ttlMs;
    }

    return {
      status: "ok",
      context: record.context,
    };
  }
}

// ── Database-backed Implementation ──────────────────────────────────────────

/**
 * PostgreSQL-backed session store via Drizzle ORM.
 * Survives server restarts and supports sliding expiration.
 */
export class DbGuidedSessionStore<TContext> implements GuidedSessionStorePort<TContext> {
  constructor(
    private readonly ttlMs: number = DEFAULT_GUIDED_SESSION_TTL_MS,
  ) {}

  async create(sessionId: string, ownerUserId: string, context: TContext): Promise<void> {
    const expiresAt = new Date(Date.now() + this.ttlMs);
    await db.insert(guidedSessions).values({
      id: sessionId,
      ownerUserId,
      context: context as any,
      status: 'active',
      expiresAt,
    }).onConflictDoUpdate({
      target: guidedSessions.id,
      set: {
        context: context as any,
        status: 'active',
        expiresAt,
        updatedAt: new Date(),
      },
    });
  }

  async get(sessionId: string, requestingUserId: string): Promise<GuidedSessionAccessResult<TContext>> {
    return this.access(sessionId, requestingUserId, false);
  }

  async consume(sessionId: string, requestingUserId: string): Promise<GuidedSessionAccessResult<TContext>> {
    return this.access(sessionId, requestingUserId, true);
  }

  async update(sessionId: string, requestingUserId: string, context: TContext): Promise<void> {
    const newExpiry = new Date(Date.now() + this.ttlMs);
    await db.update(guidedSessions)
      .set({
        context: context as any,
        expiresAt: newExpiry,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(guidedSessions.id, sessionId),
          eq(guidedSessions.ownerUserId, requestingUserId),
          eq(guidedSessions.status, 'active'),
        )
      );
  }

  async delete(sessionId: string): Promise<void> {
    await db.delete(guidedSessions).where(eq(guidedSessions.id, sessionId));
  }

  async cleanupExpired(): Promise<number> {
    const result = await db.delete(guidedSessions)
      .where(
        and(
          eq(guidedSessions.status, 'active'),
          lte(guidedSessions.expiresAt, new Date()),
        )
      );
    return (result as any).rowCount ?? 0;
  }

  private async access(
    sessionId: string,
    requestingUserId: string,
    consume: boolean,
  ): Promise<GuidedSessionAccessResult<TContext>> {
    const rows = await db.select()
      .from(guidedSessions)
      .where(eq(guidedSessions.id, sessionId))
      .limit(1);

    const record = rows[0];
    if (!record || record.status !== 'active') {
      return { status: 'not_found' };
    }

    if (record.ownerUserId !== requestingUserId) {
      return { status: 'forbidden' };
    }

    const now = new Date();
    if (record.expiresAt <= now) {
      await db.update(guidedSessions)
        .set({ status: 'expired', updatedAt: now })
        .where(eq(guidedSessions.id, sessionId));
      return { status: 'expired' };
    }

    if (consume) {
      await db.update(guidedSessions)
        .set({ status: 'consumed', updatedAt: now })
        .where(eq(guidedSessions.id, sessionId));
    } else {
      // Sliding expiration
      const newExpiry = new Date(now.getTime() + this.ttlMs);
      await db.update(guidedSessions)
        .set({ expiresAt: newExpiry, updatedAt: now })
        .where(eq(guidedSessions.id, sessionId));
    }

    return {
      status: 'ok',
      context: record.context as TContext,
    };
  }
}

// ── Default export: DB-backed store for production ──────────────────────────

/** Backwards-compatible alias — production code uses DB-backed store. */
export const GuidedSessionStore = DbGuidedSessionStore;
