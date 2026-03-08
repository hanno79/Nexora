/**
 * PRD Text Utilities — Shared helpers for text normalization, tokenization,
 * similarity, and structure cloning used across the PRD compiler pipeline.
 */

import type { PRDStructure } from './prdStructure';

// ---------------------------------------------------------------------------
// Text presence check
// ---------------------------------------------------------------------------

export function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Text normalization
// ---------------------------------------------------------------------------

export function normalizeForMatch(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[`*_>#-]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isCompilerFilledSection(
  sectionKey: string,
  knownFallbackSections: Set<string>
): boolean {
  const normalizedSectionKey = String(sectionKey || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!normalizedSectionKey) return false;

  for (const section of knownFallbackSections || new Set<string>()) {
    const normalizedFallbackSection = String(section || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!normalizedFallbackSection) continue;
    if (
      normalizedFallbackSection.includes(normalizedSectionKey)
      || normalizedSectionKey.includes(normalizedFallbackSection)
    ) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

/** Tokenize text into a Set of lowercased words (min length 3) for Jaccard similarity. */
export function tokenizeToSet(text: string): Set<string> {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3)
  );
}

// ---------------------------------------------------------------------------
// Jaccard similarity
// ---------------------------------------------------------------------------

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// ---------------------------------------------------------------------------
// Structure cloning
// ---------------------------------------------------------------------------

export function cloneStructure(structure: PRDStructure): PRDStructure {
  return {
    ...structure,
    features: [...(structure.features || [])].map(feature => ({ ...feature })),
    otherSections: { ...(structure.otherSections || {}) },
  };
}
