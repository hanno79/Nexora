/**
 * PRD Feature Parser
 * Author: rahn
 * Datum: 04.03.2026
 * Version: 1.1
 * Beschreibung: Feature-spezifisches Parsing für PRD Dokumente
 *
 * ÄNDERUNG 04.03.2026: lastIndex Reset für alle Regex-Patterns
 * hinzugefuegt um konsistentes Matching zu gewaehrleisten
 */

import type { FeatureSpec } from './prdStructure';
import { normalizeFeatureId, dedupeFeatures, splitNumberedItems } from './prdParserUtils';

const SUBSECTION_ORDER = [
  { num: '1', field: 'purpose' as const, labels: ['Purpose', 'Zweck', 'Ziel', 'Nutzen'] },
  { num: '2', field: 'actors' as const, labels: ['Actors', 'Akteure', 'Beteiligte', 'Rollen'] },
  { num: '3', field: 'trigger' as const, labels: ['Trigger', 'Ausloeser', 'Ausloser'] },
  { num: '4', field: 'preconditions' as const, labels: ['Preconditions', 'Vorbedingungen', 'Voraussetzungen'] },
  { num: '5', field: 'mainFlow' as const, labels: ['Main Flow', 'Hauptablauf', 'Hauptfluss', 'Ablauf'] },
  { num: '6', field: 'alternateFlows' as const, labels: ['Alternate Flows', 'Alternative Ablaeufe', 'Alternativablaeufe', 'Alternative Flows', 'Ausnahmefaelle'] },
  { num: '7', field: 'postconditions' as const, labels: ['Postconditions', 'Nachbedingungen', 'Ergebniszustand'] },
  { num: '8', field: 'dataImpact' as const, labels: ['Data Impact', 'Datenauswirkungen', 'Datenwirkungen', 'Datenwirkung'] },
  { num: '9', field: 'uiImpact' as const, labels: ['UI Impact', 'UI-Auswirkungen', 'Benutzeroberflaechen-Auswirkungen', 'Oberflaechen-Auswirkungen'] },
  { num: '10', field: 'acceptanceCriteria' as const, labels: ['Acceptance Criteria', 'Akzeptanzkriterien', 'Abnahmekriterien'] },
];

export function parseFeatureSubsections(rawContent: string): Partial<Pick<FeatureSpec, 'purpose' | 'actors' | 'trigger' | 'preconditions' | 'mainFlow' | 'alternateFlows' | 'postconditions' | 'dataImpact' | 'uiImpact' | 'acceptanceCriteria'>> {
  const result: any = {};

  try {
    const subsectionBoundaries: { field: string; matchStart: number; contentStart: number; isArray: boolean }[] = [];

    for (const sub of SUBSECTION_ORDER) {
      const labelsPattern = sub.labels
        .map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
        .join('|');
      const pattern = new RegExp(
        `(?:^|\\n)\\s*` +
        `(?:#{1,6}\\s*)?` +
        `(?:\\*\\*)?` +
        `(?:${sub.num}\\s*[\.\)\-:]\\s*)?` +
        `(?:${labelsPattern})` +
        `\\s*(?:\\*\\*)?\\s*[:\\-\\s]*(?:\\*\\*)?`,
        'i'
      );
      const match = pattern.exec(rawContent);
      if (match && match.index !== undefined) {
        const isArray = sub.field === 'mainFlow' || sub.field === 'alternateFlows' || sub.field === 'acceptanceCriteria';
        subsectionBoundaries.push({
          field: sub.field,
          matchStart: match.index,
          contentStart: match.index + match[0].length,
          isArray,
        });
      }
    }

    subsectionBoundaries.sort((a, b) => a.matchStart - b.matchStart);

    for (let i = 0; i < subsectionBoundaries.length; i++) {
      const boundary = subsectionBoundaries[i];
      const endIndex = i + 1 < subsectionBoundaries.length
        ? subsectionBoundaries[i + 1].matchStart
        : rawContent.length;

      const content = rawContent.substring(boundary.contentStart, endIndex).trim();
      if (!content) continue;

      if (boundary.isArray) {
        const items = splitNumberedItems(content);
        if (items.length > 0) {
          result[boundary.field] = items;
        }
      } else {
        result[boundary.field] = content;
      }
    }
  } catch (e) {
    console.error('[parseFeatureSubsections] Failed to parse feature subsections:', e);
  }

  return result;
}

export function parseFeatureMetadata(rawContent: string): Partial<Pick<FeatureSpec, 'parentTaskName' | 'parentTaskDescription'>> {
  const parentTaskName = rawContent.match(/(?:^|\n)\s*(?:Parent Task|Main Task|Haupttask)\s*:\s*(.+?)(?:\n|$)/i)?.[1]?.trim();
  const parentTaskDescription = rawContent.match(/(?:^|\n)\s*(?:Parent Task Description|Parent Task Summary|Main Task Summary|Task Summary|Beschreibung|Description)\s*:\s*(.+?)(?:\n|$)/i)?.[1]?.trim();

  return {
    ...(parentTaskName ? { parentTaskName } : {}),
    ...(parentTaskDescription ? { parentTaskDescription } : {}),
  };
}

interface SplitPoint {
  index: number;
  id: string;
  name: string;
}

// ÄNDERUNG 07.03.2026: Entfernt das Modell-/Fallback-Präfix "Feature Name:" zentral,
// damit alle Parser-Pfade konsistente, saubere Feature-Namen liefern.
function normalizeFeatureDisplayName(name: string, fallbackId: string): string {
  const normalizedName = String(name || '')
    .trim()
    .replace(/\*+/g, '')
    .trim()
    .replace(/^Feature\s+Name\s*:?\s*/i, '')
    .trim();

  return normalizedName || fallbackId;
}

function isFallbackFeatureName(name: string, featureId: string): boolean {
  const normalizedName = normalizeFeatureId(String(name || '').trim());
  const normalizedId = normalizeFeatureId(String(featureId || '').trim());
  return !!normalizedId && normalizedName === normalizedId;
}

export function parseFeatureBlocks(body: string): { features: FeatureSpec[]; introText: string } {
  const features: FeatureSpec[] = [];
  const bodyWithNewline = '\n' + body;
  const featureIdCapture = '(F[- ]?\\d+)';

  const splitPoints: SplitPoint[] = [];
  const addSplitPoint = (index: number, id: string, name: string) => {
    const normalizedId = normalizeFeatureId(id);
    if (!normalizedId) return;
    splitPoints.push({
      index,
      id: normalizedId,
      name: normalizeFeatureDisplayName(name, normalizedId),
    });
  };

  // Pattern 1: Inline Feature ID with optional name
  // Verwendet \b um Feature-IDs in URLs nicht fälschlicherweise zu matchen
  const inlinePattern = new RegExp(
    String.raw`(?:^|\n)(?:#{2,4}\s+)?(?:\*{0,2})(?:Feature\s+(?:ID:\s*)?|Feature\s+ID:\s*)\b${featureIdCapture}\b(?:\*{0,2})[: —–-]+(?!\n)(?:\*{0,2})([^\n]+?)(?:\*{0,2})(?:\n|$)`,
    'gi',
  );
  let match: RegExpExecArray | null;

  // lastIndex zuruecksetzen um sicherzustellen dass die Suche von vorne beginnt
  inlinePattern.lastIndex = 0;
  while ((match = inlinePattern.exec(bodyWithNewline)) !== null) {
    const name = match[2].trim().replace(/\*+/g, '').trim();
    if (name && !name.toLowerCase().startsWith('feature name')) {
      addSplitPoint(match.index, match[1], name);
    }
  }

  // Pattern 2: Two-line format with Feature ID and Feature Name
  const twoLinePattern = new RegExp(
    String.raw`(?:^|\n)\s*(?:#{1,6}\s+)?(?:\*{0,2})Feature\s+ID(?:\*{0,2})?\s*:?\s*(?:\*{0,2})\s*${featureIdCapture}\b[^\n]*\n\s*(?:\*{0,2})Feature\s+Name(?:\*{0,2})?\s*:?\s*(?:\*{0,2})\s*(.+?)\s*(?:\n|$)`,
    'gi',
  );
  let twoLineMatch: RegExpExecArray | null;
  twoLinePattern.lastIndex = 0;
  while ((twoLineMatch = twoLinePattern.exec(bodyWithNewline)) !== null) {
    const rawName = twoLineMatch[2].trim().replace(/\*+/g, '').trim();
    addSplitPoint(twoLineMatch.index, twoLineMatch[1], rawName || twoLineMatch[1]);
  }

  // Pattern 3: Bold Feature ID
  // Verwendet \b um Feature-IDs in URLs nicht fälschlicherweise zu matchen
  const boldIdPattern = new RegExp(
    String.raw`(?:^|\n)\s*\*{2}Feature\s+ID\s*:?\s*\b${featureIdCapture}\b\*{2}\s*\n`,
    'gi',
  );
  const featureNamePattern = /\*{0,2}Feature\s+Name:?\*{0,2}\s*(.+?)(?:\*{0,2})\s*$/im;

  let boldMatch: RegExpExecArray | null;
  boldIdPattern.lastIndex = 0;
  while ((boldMatch = boldIdPattern.exec(bodyWithNewline)) !== null) {
    const featureId = normalizeFeatureId(boldMatch[1]);
    const afterIndex = boldMatch.index + boldMatch[0].length;
    const nextChunk = bodyWithNewline.substring(afterIndex, afterIndex + 200);
    const nameMatch = nextChunk.match(featureNamePattern);
    const rawName = nameMatch
      ? nameMatch[1].trim().replace(/\*+/g, '').trim()
      : featureId;
    const featureName = normalizeFeatureDisplayName(rawName, featureId);

    addSplitPoint(boldMatch.index, featureId, featureName);
  }

  // Pattern 4: Common output format - Feature ID line
  const featureIdLinePattern = new RegExp(
    String.raw`(?:^|\n)\s*(?:\*{0,2})Feature\s+ID(?:\*{0,2})?\s*:?\s*(?:\*{0,2})\s*${featureIdCapture}\b[^\n]*(?:\n|$)`,
    'gi',
  );
  let featureIdLineMatch: RegExpExecArray | null;
  featureIdLinePattern.lastIndex = 0;
  while ((featureIdLineMatch = featureIdLinePattern.exec(bodyWithNewline)) !== null) {
    const featureId = normalizeFeatureId(featureIdLineMatch[1]);
    const afterIndex = featureIdLineMatch.index + featureIdLineMatch[0].length;
    const preview = bodyWithNewline.substring(afterIndex, afterIndex + 320);
    const nameMatch = preview.match(/(?:^|\n)\s*(?:\*{0,2})Feature\s+Name(?:\*{0,2})?\s*:?\s*(?:\*{0,2})\s*(.+?)\s*(?:\n|$)/i);
    let featureName = nameMatch
      ? nameMatch[1].trim().replace(/\*+/g, '').trim()
      : featureId;
    if (!nameMatch) {
      // Fallback: detect nearby "Feature Specification: <Name>" heading.
      const prefix = bodyWithNewline.substring(Math.max(0, featureIdLineMatch.index - 220), featureIdLineMatch.index);
      const specHeadingMatch = prefix.match(/Feature\s+Specification\s*:\s*([^\n#]+)/i);
      if (specHeadingMatch) {
        featureName = specHeadingMatch[1].trim();
      }
    }
    addSplitPoint(featureIdLineMatch.index, featureId, featureName || featureId);
  }

  // Pattern 5: Heading format (### F-01: Name, ### Feature F-01: Name, ### Feature ID: F-01: Name)
  // Abdeckung: Markdown-Headings mit Feature-ID in verschiedenen Formaten
  // Verwendet \b um Feature-IDs in URLs nicht fälschlicherweise zu matchen
  const headingPattern = new RegExp(
    String.raw`(?:^|\n)(#{2,4})\s+(?:\*{0,2})(?:Feature\s+)?(?:ID:\s*)?\b${featureIdCapture}\b(?:\*{0,2})[:\s—–-]+(?:\*{0,2})(.*?)(?:\*{0,2})\s*(?:\n|$)`,
    'gi',
  );
  let headingMatch: RegExpExecArray | null;
  headingPattern.lastIndex = 0;
  while ((headingMatch = headingPattern.exec(bodyWithNewline)) !== null) {
    addSplitPoint(
      headingMatch.index,
      headingMatch[2],
      headingMatch[3].trim().replace(/\*+/g, '').trim() || headingMatch[2]
    );
  }

  splitPoints.sort((a, b) => a.index - b.index);
  const uniqueSplitPoints: typeof splitPoints = [];
  const seenAt = new Map<string, number>();
  for (const point of splitPoints) {
    const key = `${point.index}:${point.id}`;
    const existingIndex = seenAt.get(key);
    if (existingIndex !== undefined) {
      const existingPoint = uniqueSplitPoints[existingIndex];
      const existingIsFallback = isFallbackFeatureName(existingPoint.name, existingPoint.id);
      const candidateIsFallback = isFallbackFeatureName(point.name, point.id);
      if (existingIsFallback && !candidateIsFallback) {
        uniqueSplitPoints[existingIndex] = point;
      }
      continue;
    }
    seenAt.set(key, uniqueSplitPoints.length);
    uniqueSplitPoints.push(point);
  }

  const firstFeatureIndex = uniqueSplitPoints.length > 0 ? uniqueSplitPoints[0].index : bodyWithNewline.length;
  const introText = bodyWithNewline.substring(0, firstFeatureIndex).trim();

  for (let i = 0; i < uniqueSplitPoints.length; i++) {
    const start = uniqueSplitPoints[i].index;
    const end = i + 1 < uniqueSplitPoints.length ? uniqueSplitPoints[i + 1].index : bodyWithNewline.length;
    const rawContent = bodyWithNewline.substring(start, end).trim();

    features.push({
      id: uniqueSplitPoints[i].id,
      name: uniqueSplitPoints[i].name,
      rawContent,
      ...parseFeatureMetadata(rawContent),
      ...parseFeatureSubsections(rawContent),
    });
  }

  return { features, introText };
}
