export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== "string") {
    return null;
  }

  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Keeps undefined as-is for partial updates/upserts so existing DB values are not overwritten.
 */
export function normalizeOptionalEmail(email: unknown): string | null | undefined {
  if (email === undefined) {
    return undefined;
  }
  if (email === null) {
    return null;
  }
  return normalizeEmail(email);
}
