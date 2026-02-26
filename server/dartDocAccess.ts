export function normalizeDartDocId(docId: unknown): string | null {
  if (typeof docId !== "string") {
    return null;
  }

  const normalized = docId.trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * A Dart update is consistent when:
 * - request docId is non-empty, and
 * - PRD has no stored doc id yet, OR it matches the stored one.
 */
export function isDartDocUpdateConsistent(existingDocId: unknown, requestedDocId: unknown): boolean {
  const normalizedRequested = normalizeDartDocId(requestedDocId);
  if (!normalizedRequested) {
    return false;
  }

  const normalizedExisting = normalizeDartDocId(existingDocId);
  if (!normalizedExisting) {
    return true;
  }

  return normalizedExisting === normalizedRequested;
}
