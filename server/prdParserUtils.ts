/**
 * PRD Parser Utilities
 * Author: rahn
 * Datum: 04.03.2026
 * Version: 1.0
 * Beschreibung: Hilfsfunktionen für PRD Parsing (Feature Normalisierung, Deduplizierung)
 */

import type { FeatureSpec } from './prdStructure';

export function normalizeFeatureId(value: string): string {
  const match = String(value || '').toUpperCase().match(/F-(\d+)/);
  if (!match) return '';
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return '';
  return `F-${String(parsed).padStart(2, '0')}`;
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
    if (currentLen > existingLen) {
      byId.set(id, normalized);
    }
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
