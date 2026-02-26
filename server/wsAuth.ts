import type { IncomingMessage } from "http";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { sessions } from "@shared/schema";
import {
  getDemoUserId,
  isClerkAuthEnabled,
  isDemoAuthEnabled,
  verifyClerkSessionToken,
} from "./auth";
import { extractUserIdFromSessionData, parseCookieHeader, unsignSessionId } from "./wsAuthUtils";

const SESSION_COOKIE_NAME = "connect.sid";
const CLERK_SESSION_COOKIE_NAME = "__session";

function parseBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function resolveUserIdFromSessionId(sessionId: string): Promise<string | null> {
  try {
    const [sessionRow] = await db
      .select({
        sess: sessions.sess,
        expire: sessions.expire,
      })
      .from(sessions)
      .where(eq(sessions.sid, sessionId))
      .limit(1);

    if (!sessionRow) return null;

    const expiresAt = new Date(sessionRow.expire).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return null;
    }

    return extractUserIdFromSessionData(sessionRow.sess);
  } catch {
    return null;
  }
}

export async function authenticateWebSocketRequest(req: IncomingMessage): Promise<string | null> {
  if (isDemoAuthEnabled()) {
    return getDemoUserId();
  }

  if (isClerkAuthEnabled()) {
    const cookies = parseCookieHeader(req.headers.cookie);
    const tokenFromCookie = cookies[CLERK_SESSION_COOKIE_NAME];
    const tokenFromHeader = parseBearerToken(req.headers.authorization);
    const token = tokenFromHeader || tokenFromCookie;
    if (!token) return null;
    return await verifyClerkSessionToken(token);
  }

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) return null;

  const cookies = parseCookieHeader(req.headers.cookie);
  const rawSessionCookie = cookies[SESSION_COOKIE_NAME];
  const sessionId = unsignSessionId(rawSessionCookie, sessionSecret);
  if (!sessionId) return null;

  return await resolveUserIdFromSessionId(sessionId);
}
