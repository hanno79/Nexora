import type { Express, Request, RequestHandler } from "express";
import { clerkClient, clerkMiddleware, getAuth } from "@clerk/express";
import { verifyToken } from "@clerk/backend";
import { storage } from "./storage";
import {
  getDemoUserId as getReplitDemoUserId,
  isDemoAuthEnabled as isReplitDemoAuthEnabled,
  isAuthenticated as isReplitAuthenticated,
  setupAuth as setupReplitAuth,
} from "./replitAuth";
import {
  parseClerkAuthorizedParties,
  resolveAuthProvider,
} from "./authProvider";

const authProvider = resolveAuthProvider(process.env);
const CLERK_AUTH_ENABLED = authProvider === "clerk";
const CLERK_AUTHORIZED_PARTIES = parseClerkAuthorizedParties(
  process.env.CLERK_AUTHORIZED_PARTIES,
);

function toStringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function resolveClerkProfile(userId: string, claims: Record<string, unknown>) {
  let email = toStringValue(claims.email);
  let firstName = toStringValue(claims.first_name);
  let lastName = toStringValue(claims.last_name);
  let profileImageUrl = toStringValue(claims.image_url);

  if (!email || !firstName || !lastName || !profileImageUrl) {
    try {
      const user = await clerkClient.users.getUser(userId);
      email = email || user.primaryEmailAddress?.emailAddress || user.emailAddresses[0]?.emailAddress || null;
      firstName = firstName || user.firstName || null;
      lastName = lastName || user.lastName || null;
      profileImageUrl = profileImageUrl || user.imageUrl || null;
    } catch {
      // Continue with whatever is already available in token claims.
    }
  }

  return { email, firstName, lastName, profileImageUrl };
}

async function ensureLocalUser(userId: string, profile: {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}) {
  const existing = await storage.getUser(userId);
  if (!existing) {
    await storage.upsertUser({
      id: userId,
      email: profile.email || undefined,
      firstName: profile.firstName || undefined,
      lastName: profile.lastName || undefined,
      profileImageUrl: profile.profileImageUrl || undefined,
    });
    return;
  }

  const shouldUpdate =
    (profile.email && profile.email !== existing.email) ||
    profile.firstName !== (existing.firstName ?? null) ||
    profile.lastName !== (existing.lastName ?? null) ||
    profile.profileImageUrl !== (existing.profileImageUrl ?? null);

  if (!shouldUpdate) {
    return;
  }

  await storage.updateUser(userId, {
    ...(profile.email ? { email: profile.email } : {}),
    firstName: profile.firstName,
    lastName: profile.lastName,
    profileImageUrl: profile.profileImageUrl,
  });
}

export async function setupAuth(app: Express) {
  if (!CLERK_AUTH_ENABLED) {
    return setupReplitAuth(app);
  }

  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error(
      "CLERK_SECRET_KEY must be set when AUTH_PROVIDER=clerk or Clerk auth is auto-selected.",
    );
  }
  if (!process.env.VITE_CLERK_PUBLISHABLE_KEY) {
    throw new Error(
      "VITE_CLERK_PUBLISHABLE_KEY must be set when using Clerk auth.",
    );
  }

  app.use(
    clerkMiddleware({
      secretKey: process.env.CLERK_SECRET_KEY,
      publishableKey: process.env.VITE_CLERK_PUBLISHABLE_KEY,
      ...(CLERK_AUTHORIZED_PARTIES
        ? { authorizedParties: CLERK_AUTHORIZED_PARTIES }
        : {}),
    }),
  );

  // Backwards-compatible endpoints so older frontend paths don't break hard.
  app.get("/api/login", (_req, res) => res.redirect("/sign-in"));
  app.get("/api/callback", (_req, res) => res.redirect("/"));
  app.get("/api/logout", async (req, res) => {
    try {
      const auth = getAuth(req as Request);
      const sessionId = toStringValue((auth as any)?.sessionId);
      if (sessionId) {
        await clerkClient.sessions.revokeSession(sessionId);
      }
    } catch {
      // Best-effort sign-out.
    }

    res.clearCookie("__session");
    res.redirect("/sign-in");
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (!CLERK_AUTH_ENABLED) {
    return isReplitAuthenticated(req, res, next);
  }

  try {
    const auth = getAuth(req as Request);
    const userId = toStringValue(auth?.userId);
    if (!auth?.isAuthenticated || !userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const claims = (auth.sessionClaims || {}) as Record<string, unknown>;
    const exp = toNumberValue(claims.exp) || Math.floor(Date.now() / 1000) + 60 * 60;
    const profile = await resolveClerkProfile(userId, claims);
    await ensureLocalUser(userId, profile);

    (req as any).user = {
      id: userId,
      claims: {
        sub: userId,
        email: profile.email || "",
        first_name: profile.firstName || "",
        last_name: profile.lastName || "",
        profile_image_url: profile.profileImageUrl || null,
        exp,
      },
      expires_at: exp,
    };

    return next();
  } catch {
    return res.status(401).json({ message: "Unauthorized" });
  }
};

export async function verifyClerkSessionToken(token: string): Promise<string | null> {
  if (!CLERK_AUTH_ENABLED) return null;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey || !token) return null;

  try {
    const payload = await verifyToken(token, {
      secretKey,
      ...(CLERK_AUTHORIZED_PARTIES
        ? { authorizedParties: CLERK_AUTHORIZED_PARTIES }
        : {}),
    });
    return toStringValue(payload.sub);
  } catch {
    return null;
  }
}

export function isClerkAuthEnabled() {
  return CLERK_AUTH_ENABLED;
}

export function isDemoAuthEnabled() {
  return !CLERK_AUTH_ENABLED && isReplitDemoAuthEnabled();
}

export function getDemoUserId() {
  return getReplitDemoUserId();
}
