export const DEFAULT_GUIDED_SESSION_TTL_MS = 30 * 60 * 1000;

export type GuidedSessionAccessStatus = "ok" | "not_found" | "forbidden" | "expired";

export interface GuidedSessionAccessResult<TContext> {
  status: GuidedSessionAccessStatus;
  context?: TContext;
}

interface GuidedSessionRecord<TContext> {
  ownerUserId: string;
  expiresAt: number;
  context: TContext;
}

type TimeSource = () => number;

/**
 * In-memory session store with owner binding and expiration.
 * Every read refreshes TTL (sliding expiration) for active sessions.
 */
export class GuidedSessionStore<TContext> {
  private readonly sessions = new Map<string, GuidedSessionRecord<TContext>>();

  constructor(
    private readonly ttlMs: number = DEFAULT_GUIDED_SESSION_TTL_MS,
    private readonly now: TimeSource = () => Date.now(),
  ) {}

  create(sessionId: string, ownerUserId: string, context: TContext): void {
    this.cleanupExpired();
    this.sessions.set(sessionId, {
      ownerUserId,
      expiresAt: this.now() + this.ttlMs,
      context,
    });
  }

  get(sessionId: string, requestingUserId: string): GuidedSessionAccessResult<TContext> {
    return this.access(sessionId, requestingUserId, false);
  }

  consume(sessionId: string, requestingUserId: string): GuidedSessionAccessResult<TContext> {
    return this.access(sessionId, requestingUserId, true);
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  cleanupExpired(): number {
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

  size(): number {
    return this.sessions.size;
  }

  private access(
    sessionId: string,
    requestingUserId: string,
    consume: boolean,
  ): GuidedSessionAccessResult<TContext> {
    const record = this.sessions.get(sessionId);
    if (!record) {
      this.cleanupExpired();
      return { status: "not_found" };
    }

    if (record.ownerUserId !== requestingUserId) {
      return { status: "forbidden" };
    }

    const now = this.now();
    if (record.expiresAt <= now) {
      this.sessions.delete(sessionId);
      this.cleanupExpired();
      return { status: "expired" };
    }

    this.cleanupExpired();

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
