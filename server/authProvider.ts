export type AuthProvider = "clerk" | "replit";

/**
 * Provider selection order:
 * 1. Explicit AUTH_PROVIDER (clerk|replit)
 * 2. Auto-detect by Clerk server key presence
 * 3. Fallback to legacy Replit/demo auth
 */
export function resolveAuthProvider(
  env: Record<string, string | undefined>,
): AuthProvider {
  const forced = env.AUTH_PROVIDER?.trim().toLowerCase();
  if (forced === "clerk") return "clerk";
  if (forced === "replit") return "replit";
  return env.CLERK_SECRET_KEY ? "clerk" : "replit";
}

export function parseClerkAuthorizedParties(
  value: string | undefined,
): string[] | undefined {
  if (!value) return undefined;
  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parsed.length > 0 ? parsed : undefined;
}
