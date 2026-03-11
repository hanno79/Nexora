import type { PRDStructure, FeatureSpec, StructuredFieldName } from './prdStructure';
import { STRUCTURED_FIELD_NAMES } from './prdStructure';
import type { ExpandedFeature } from './services/llm/expandFeature';
import { parseFeatureSubsections } from './prdParser';

const GENERIC_FALLBACK_MARKERS = [
  'deterministische, testbare funktion',
  'primaer: endnutzer',
  'sekundaer: systemservice zur verarbeitung der anfrage',
  'zugehoerige aktion ueber die ui oder einen api-endpunkt',
  'das system empfaengt und validiert die anfrage',
  'das system fuehrt die kernlogik deterministisch aus und aktualisiert den zustand',
  'das system liefert eine erfolgsmeldung und aktualisiert die relevante ui-ansicht',
  'ohne mehrdeutiges verhalten ausgefuehrt werden',
  'validierungs- und fehlerpfade sind explizit und testbar umgesetzt',
  'resultierende zustand ist konsistent und in ui/api-antworten sichtbar',
  'deterministic, testable capability with clear boundaries',
  'primary: end user',
  'secondary: system service handling the request',
  'through the ui or api endpoint',
  'system receives and validates the request',
  'system executes the core logic deterministically and updates state',
  'system returns a success response and refreshes relevant ui state',
  'without ambiguous behavior',
  'validation and error paths are handled explicitly and testably',
  'resulting state is consistent and visible in ui/api responses',
];

const PLACEHOLDER_PATTERNS = [
  /^tbd$/i,
  /^todo$/i,
  /^placeholder$/i,
  /^n\/a$/i,
  /^na$/i,
  /^feature id$/i,
  /^feature id[:\s-]*f[- ]?\d+$/i,
  /^f[- ]?\d+$/i,
  /structure placeholder/i,
  /to be filled by section repair/i,
];

const MIN_WORD_LENGTH = 3;
const ECHO_OVERLAP_THRESHOLD = 0.8;
const SHORT_TEXT_MAX_LENGTH = 60;
const ECHO_PENALTY_SCORE = 120;

/**
 * Merge expanded feature specs into an existing PRDStructure.
 * For each expanded feature:
 * - If the feature ID already exists, overlay richer structured fields
 * - If the feature ID is new, append it
 */
export function mergeExpansionIntoStructure(
  base: PRDStructure,
  expandedFeatures: ExpandedFeature[]
): PRDStructure {
  const merged: PRDStructure = {
    ...base,
    features: [...base.features],
  };

  for (const expanded of expandedFeatures) {
    if (!expanded.valid && !expanded.compiled) continue;

    const parsed = parseFeatureSubsections(expanded.content);

    const featureSpec: FeatureSpec = {
      id: expanded.featureId,
      name: expanded.featureName,
      rawContent: expanded.content,
      ...(expanded.parentTaskName ? { parentTaskName: expanded.parentTaskName } : {}),
      ...(expanded.parentTaskDescription ? { parentTaskDescription: expanded.parentTaskDescription } : {}),
      ...parsed,
    };

    const existingIdx = merged.features.findIndex(
      f => f.id === expanded.featureId
    );

    if (existingIdx >= 0) {
      merged.features[existingIdx] = mergeFeatureSpecs(
        merged.features[existingIdx],
        featureSpec
      );
    } else {
      merged.features.push(featureSpec);
    }
  }

  return merged;
}

function contentLength(val: unknown): number {
  if (Array.isArray(val)) return val.join('').length;
  if (typeof val === 'string') return val.trim().length;
  return 0;
}

function normalizeMergeText(value: string): string {
  return String(value || '')
    .replace(/[*_`>#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isPlaceholderLikeText(value: string): boolean {
  const normalized = normalizeMergeText(value);
  if (!normalized) return true;
  return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(normalized));
}

function countGenericFallbackMarkers(value: string): number {
  const normalized = normalizeMergeText(value);
  if (!normalized) return 0;

  let hits = 0;
  for (const marker of GENERIC_FALLBACK_MARKERS) {
    if (normalized.includes(marker)) {
      hits++;
    }
  }
  return hits;
}

function calculateEchoPenalty(text: string, featureName: string): number {
  const featureNameWords = new Set(
    String(featureName || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length >= MIN_WORD_LENGTH)
  );

  if (featureNameWords.size === 0) {
    return 0;
  }

  const textWords = new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length >= MIN_WORD_LENGTH)
  );
  const overlap = [...featureNameWords].filter(word => textWords.has(word)).length;
  const echoRatio = overlap / featureNameWords.size;

  return echoRatio > ECHO_OVERLAP_THRESHOLD && text.length < SHORT_TEXT_MAX_LENGTH
    ? ECHO_PENALTY_SCORE
    : 0;
}

// ÄNDERUNG 09.03.2026: Merge bevorzugt jetzt inhaltliche Substanz statt
// bloßer Länge. Offensichtliche Placeholder und bekannte deterministische
// Fallback-Formulierungen erhalten bewusst keinen Merge-Vorrang.
function calculateFieldSubstanceScore(
  featureName: string,
  field: StructuredFieldName,
  value: FeatureSpec[StructuredFieldName]
): number {
  if (Array.isArray(value)) {
    const normalizedItems = value
      .map(entry => String(entry || '').trim())
      .filter(entry => entry.length > 0 && !isPlaceholderLikeText(entry));
    if (normalizedItems.length === 0) {
      return 0;
    }

    const joined = normalizedItems.join(' ');
    const markerCount = countGenericFallbackMarkers(joined);
    const fallbackPenalty = markerCount > 0 ? Math.min(0.8, markerCount * 0.3) : 0;

    const meaningfulItems = normalizedItems.filter(entry => entry.length >= 10);
    const minItems = field === 'mainFlow' ? 3 : field === 'acceptanceCriteria' ? 2 : 1;
    if (meaningfulItems.length < minItems) {
      return Math.round(meaningfulItems.length * 40 * (1 - fallbackPenalty));
    }

    const baseScore = meaningfulItems.length * 120 + Math.min(joined.length, 180);
    return Math.round(baseScore * (1 - fallbackPenalty));
  }

  const text = String(value || '').trim();
  if (!text || isPlaceholderLikeText(text)) {
    return 0;
  }

  const markerCount = countGenericFallbackMarkers(text);
  const fallbackPenalty = markerCount > 0 ? Math.min(0.8, markerCount * 0.3) : 0;

  const minLength = field === 'purpose' ? 30 : 20;
  const lengthScore = Math.min(text.length, 160);
  const thresholdBonus = text.length >= minLength ? 120 : 0;
  const echoPenalty = calculateEchoPenalty(text, featureName);

  const baseScore = Math.max(lengthScore + thresholdBonus - echoPenalty, 0);
  return Math.round(baseScore * (1 - fallbackPenalty));
}

function calculateFeatureSubstanceScore(feature: FeatureSpec): number {
  let score = 0;

  for (const field of STRUCTURED_FIELD_NAMES) {
    score += calculateFieldSubstanceScore(feature.name, field, feature[field]);
  }

  const rawContent = String(feature.rawContent || '').trim();
  if (rawContent && countGenericFallbackMarkers(rawContent) === 0) {
    score += Math.min(rawContent.length, 200);
  }

  return score;
}

/**
 * Merge two FeatureSpecs field-by-field.
 * For each of the 10 structured fields, the richer value wins.
 */
function mergeFeatureSpecs(existing: FeatureSpec, expanded: FeatureSpec): FeatureSpec {
  const merged: FeatureSpec = { ...existing };

  if (typeof expanded.parentTaskName === 'string' && expanded.parentTaskName.trim()) {
    merged.parentTaskName = expanded.parentTaskName.trim();
  }

  if (typeof expanded.parentTaskDescription === 'string' && expanded.parentTaskDescription.trim()) {
    if (!existing.parentTaskDescription || expanded.parentTaskDescription.trim().length >= existing.parentTaskDescription.trim().length) {
      merged.parentTaskDescription = expanded.parentTaskDescription.trim();
    }
  }

  for (const field of STRUCTURED_FIELD_NAMES) {
    const expandedLen = contentLength(expanded[field]);
    const existingLen = contentLength(existing[field]);
    const expandedScore = calculateFieldSubstanceScore(expanded.name, field, expanded[field]);
    const existingScore = calculateFieldSubstanceScore(existing.name, field, existing[field]);

    if (
      expandedScore > existingScore
      || (expandedScore > 0 && expandedScore === existingScore && expandedLen > existingLen)
    ) {
      (merged as any)[field] = expanded[field];
    }
  }

  const expandedFeatureScore = calculateFeatureSubstanceScore(expanded);
  const existingFeatureScore = calculateFeatureSubstanceScore(existing);
  const expandedLen = (expanded.rawContent ?? '').length;
  const existingLen = (existing.rawContent ?? '').length;

  if (
    expandedFeatureScore > existingFeatureScore
    || (
      expandedFeatureScore > 0
      && expandedFeatureScore === existingFeatureScore
      && expandedLen > existingLen
    )
  ) {
    const expandedRawContent = typeof expanded.rawContent === 'string' ? expanded.rawContent : undefined;
    if (expandedRawContent !== undefined) {
      merged.rawContent = expandedRawContent;
    }
  }

  return merged;
}
