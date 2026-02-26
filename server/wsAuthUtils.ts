import crypto from "crypto";

export function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  for (const segment of cookieHeader.split(";")) {
    const idx = segment.indexOf("=");
    if (idx <= 0) continue;
    const key = segment.slice(0, idx).trim();
    const value = segment.slice(idx + 1).trim();
    if (key) {
      cookies[key] = value;
    }
  }

  return cookies;
}

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Validates and unsigns an express-session cookie value.
 * Expected format after decoding: s:<sessionId>.<signature>
 */
export function unsignSessionId(rawCookieValue: string | undefined, sessionSecret: string | undefined): string | null {
  if (!rawCookieValue || !sessionSecret) return null;

  let decoded = rawCookieValue;
  try {
    decoded = decodeURIComponent(rawCookieValue);
  } catch {
    // Keep raw value if decoding fails.
  }

  if (!decoded.startsWith("s:")) return null;

  const signedValue = decoded.slice(2);
  const lastDot = signedValue.lastIndexOf(".");
  if (lastDot <= 0) return null;

  const sessionId = signedValue.slice(0, lastDot);
  const signature = signedValue.slice(lastDot + 1);
  if (!sessionId || !signature) return null;

  const expected = crypto
    .createHmac("sha256", sessionSecret)
    .update(sessionId)
    .digest("base64")
    .replace(/=+$/g, "");

  return safeEquals(signature, expected) ? sessionId : null;
}

/**
 * Extracts user ID from a passport session object.
 * Handles both string user IDs and serialized user objects with claims.
 */
export function extractUserIdFromSessionData(sessionData: unknown): string | null {
  if (!sessionData || typeof sessionData !== "object") return null;

  const sessionAny = sessionData as any;
  const passportUser = sessionAny?.passport?.user ?? sessionAny?.user;

  if (typeof passportUser === "string" && passportUser.trim()) {
    return passportUser.trim();
  }

  if (passportUser && typeof passportUser === "object") {
    const claimsSub = passportUser?.claims?.sub;
    if (typeof claimsSub === "string" && claimsSub.trim()) {
      return claimsSub.trim();
    }

    const id = passportUser?.id;
    if (typeof id === "string" && id.trim()) {
      return id.trim();
    }
  }

  return null;
}

