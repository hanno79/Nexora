/**
 * PRD Parser Utilities
 * Author: rahn
 * Datum: 04.03.2026
 * Version: 1.0
 * Beschreibung: Hilfsfunktionen für PRD Parsing (Feature Normalisierung, Deduplizierung)
 */

import type { FeatureSpec } from './prdStructure';

export function normalizeFeatureId(value: string): string {
  const match = String(value || '').toUpperCase().match(/\bF[- ]?(\d+)\b/);
  if (!match) return '';
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return '';
  return `F-${String(parsed).padStart(2, '0')}`;
}

function isFallbackFeatureName(name: string, featureId: string): boolean {
  const normalizedName = normalizeFeatureId(String(name || '').trim());
  const normalizedId = normalizeFeatureId(String(featureId || '').trim());
  return !!normalizedId && normalizedName === normalizedId;
}

export function extractFeatureHeadingSamples(markdown: string, limit = 5): string[] {
  const lines = String(markdown || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const samples: string[] = [];
  for (const line of lines) {
    const isFeatureHeading = /^#{2,4}\s+.*\bF[- ]?\d+\b/i.test(line);
    const isFeatureIdLine = /^\*{0,2}Feature\s+ID\*{0,2}\s*:?\s*F[- ]?\d+\b/i.test(line);
    if (!isFeatureHeading && !isFeatureIdLine) continue;
    samples.push(line);
    if (samples.length >= limit) break;
  }

  return samples;
}

export function normalizeFeatureCatalogueSyntax(markdown: string): {
  content: string;
  applied: boolean;
  rawFeatureHeadingSamples: string[];
} {
  const rawFeatureHeadingSamples: string[] = [];
  const seenSamples = new Set<string>();
  let applied = false;

  const lines = String(markdown || '').split(/\r?\n/);
  const normalizedLines = lines.map((line) => {
    const trimmed = line.trim();
    let nextLine = line;

    const headingMatch = line.match(
      /^(\s*#{2,4})\s+(?:\*{0,2})(?:Feature\s+)?(?:ID:\s*)?(F[- ]?\d+)(?:\*{0,2})\s*(?:[:—–-]\s*|\s+)(.+?)\s*$/i
    );
    if (headingMatch) {
      const canonicalId = normalizeFeatureId(headingMatch[2]);
      const normalizedName = String(headingMatch[3] || '')
        .trim()
        .replace(/\*+/g, '')
        .replace(/^Feature\s+Name\s*:?\s*/i, '')
        .trim();
      if (canonicalId && normalizedName) {
        nextLine = `${headingMatch[1]} ${canonicalId}: ${normalizedName}`;
      }
    }

    const featureIdMatch = nextLine.match(
      /^(\s*)(?:\*{0,2})Feature\s+ID(?:\*{0,2})?\s*:?\s*(?:\*{0,2})(F[- ]?\d+)(?:\*{0,2})(.*)$/i
    );
    if (featureIdMatch) {
      const canonicalId = normalizeFeatureId(featureIdMatch[2]);
      if (canonicalId) {
        const suffix = String(featureIdMatch[3] || '').trimEnd();
        nextLine = `${featureIdMatch[1]}Feature ID: ${canonicalId}${suffix ? suffix : ''}`;
      }
    }

    if (nextLine !== line) {
      applied = true;
      if (trimmed && !seenSamples.has(trimmed)) {
        seenSamples.add(trimmed);
        rawFeatureHeadingSamples.push(trimmed);
      }
    }

    return nextLine;
  });

  return {
    content: normalizedLines.join('\n'),
    applied,
    rawFeatureHeadingSamples,
  };
}

export function dedupeFeatures(features: FeatureSpec[]): FeatureSpec[] {
  const byId = new Map<string, FeatureSpec>();
  for (const feature of features) {
    const id = normalizeFeatureId(feature.id);
    if (!id) continue;

    const normalized: FeatureSpec = { ...feature, id };
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, normalized);
      continue;
    }

    // Prefer richer content when duplicate IDs appear.
    const currentLen = (normalized.rawContent || '').length;
    const existingLen = (existing.rawContent || '').length;
    const preferred = currentLen > existingLen ? normalized : existing;
    const fallback = preferred === normalized ? existing : normalized;
    const preferredNameIsFallback = isFallbackFeatureName(preferred.name, id);
    const fallbackNameIsFallback = isFallbackFeatureName(fallback.name, id);

    byId.set(id, {
      ...preferred,
      name:
        preferredNameIsFallback && !fallbackNameIsFallback
          ? fallback.name
          : preferred.name,
    });
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true })
  );
}

export function normalizeBrokenHeadingBoundaries(markdown: string): string {
  // Some model outputs place "## Heading" inline after a sentence.
  // Normalize these cases so section splitting remains deterministic.
  return markdown.replace(/([^\n])[ \t]+(#{1,2}\s+[^\n#]+)/g, '$1\n\n$2');
}

export function normalizeHeadingForAliasMatching(value: string): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface RawSection {
  heading: string;
  level: number;
  body: string;
}

export function splitIntoSections(markdown: string): RawSection[] {
  const sections: RawSection[] = [];
  const normalizedMarkdown = normalizeBrokenHeadingBoundaries(markdown);
  const lines = normalizedMarkdown.split('\n');

  let currentHeading = '';
  let currentLevel = 0;
  let currentBody: string[] = [];

  for (const line of lines) {
    // Treat only H1/H2 as top-level section boundaries.
    // H3+ is commonly used inside feature specs and must stay in-section.
    const headingMatch = line.match(/^(#{1,2})\s+(.+)$/);

    if (headingMatch) {
      if (currentHeading || currentBody.length > 0) {
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          body: currentBody.join('\n').trim(),
        });
      }
      currentLevel = headingMatch[1].length;
      currentHeading = headingMatch[2].trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }

  if (currentHeading || currentBody.length > 0) {
    sections.push({
      heading: currentHeading,
      level: currentLevel,
      body: currentBody.join('\n').trim(),
    });
  }

  return sections;
}

export function mergeSectionContent(currentValue: string, incomingValue: string): string {
  const current = String(currentValue || '').trim();
  const incoming = String(incomingValue || '').trim();
  if (!current) return incoming;
  if (!incoming) return current;

  const currentNormalized = current.toLowerCase().replace(/\s+/g, ' ').trim();
  const incomingNormalized = incoming.toLowerCase().replace(/\s+/g, ' ').trim();
  if (currentNormalized.includes(incomingNormalized)) return current;
  if (incomingNormalized.includes(currentNormalized)) return incoming;
  return `${current}\n\n${incoming}`.trim();
}

export function splitNumberedItems(text: string): string[] {
  const items: string[] = [];
  const lines = text.split('\n');
  let currentItem = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isNumbered = /^\d+[\.\)]\s+/.test(trimmed);
    const isChecklist = /^[-*+]\s+\[[ xX]\]\s+/.test(trimmed);
    const isBullet = /^[-*+]\s+/.test(trimmed);

    if (isNumbered || isChecklist || isBullet) {
      if (currentItem.trim()) {
        items.push(currentItem.trim());
      }
      currentItem = trimmed
        .replace(/^\d+[\.\)]\s+/, '')
        .replace(/^[-*+]\s+\[[ xX]\]\s+/, '')
        .replace(/^[-*+]\s+/, '');
    } else {
      currentItem += ' ' + trimmed;
    }
  }
  if (currentItem.trim()) {
    items.push(currentItem.trim());
  }

  return items;
}
