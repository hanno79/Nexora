/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Merge- und Improve-Helfer fuer den PRD-Compiler.
*/

// ÄNDERUNG 08.03.2026: Merge-/Improve-Helfer aus `server/prdCompiler.ts` als vierter risikoarmer Phase-2-Minimalsplit extrahiert.

import { FEATURE_STRUCTURED_FIELDS } from './prdFeatureDepth';
import type { PRDStructure, FeatureSpec } from './prdStructure';
import { hasText, normalizeForMatch } from './prdTextUtils';

export interface RequiredSectionDefinition {
  key: keyof PRDStructure;
  label: string;
  fallbackEn: string;
  fallbackDe: string;
}

function isLikelyFeatureIntroNoise(value: string): boolean {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^#{1,6}\s+/m.test(text)) return true;
  if (/\b(?:user\s+stories|must[- ]have|nice[- ]to[- ]have|part\s+[a-z])\b/i.test(text)) return true;
  return false;
}

function mergeFeatureCatalogueIntro(baseValue?: string, candidateValue?: string): string | undefined {
  const baseText = String(baseValue || '').trim();
  const candidateText = String(candidateValue || '').trim();

  if (!baseText && !candidateText) return undefined;
  if (baseText && !candidateText) return baseText;
  if (!baseText && candidateText) {
    if (isLikelyFeatureIntroNoise(candidateText)) return undefined;
    if (candidateText.length > 600) return undefined;
    return candidateText;
  }

  return mergeSectionWithPreservation(baseText, candidateText);
}

function buildAnchor(value: string): string {
  const source = String(value || '').trim();
  if (!source) return '';

  const firstMeaningfulChunk = source
    .split(/\n|[.!?]/)
    .map(part => part.trim())
    .find(part => part.length >= 24) || source;

  const normalized = normalizeForMatch(firstMeaningfulChunk);
  if (normalized.length < 16) return '';
  return normalized.slice(0, 140);
}

export function looksLikeTruncatedOutput(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (trimmed.length < 80) return false;
  if (/\[truncated\]\s*$/i.test(trimmed)) return true;

  const lines = trimmed.split('\n').map(line => line.trim()).filter(Boolean);
  const lastLine = lines.length > 0 ? lines[lines.length - 1] : '';
  if (!lastLine) return false;

  if (/[.!?)]$/.test(lastLine)) return false;
  if (/^[-*]\s*$/.test(lastLine)) return true;
  if (/^\d+[.)]\s*$/.test(lastLine)) return true;
  if (/[*_`#:,(\-]$/.test(lastLine)) return true;

  const bulletOrNumbered = /^[-*]\s+/.test(lastLine) || /^\d+[.)]\s+/.test(lastLine);
  const lineText = lastLine
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim();
  const words = lineText.split(/\s+/).filter(Boolean);
  const startsWithIndefinite = /^(eine|ein|einer|einem|the|a|an)\b/i.test(lineText);
  const endsWithConnector = /\b(and|or|to|with|mit|und|oder|sowie|inklusive|von|for|in)\b$/i.test(lineText);

  if (bulletOrNumbered) {
    if (!lineText) return true;
    if (lineText.length < 10) return true;
    if (/[,:;(]$/.test(lineText)) return true;
    if (endsWithConnector) return true;
    if (startsWithIndefinite && words.length <= 5) return true;
    return false;
  }

  if (lineText.length < 12) return true;
  if (endsWithConnector) return true;
  return false;
}

function mergeFeatureSpecs(base: FeatureSpec, candidate: FeatureSpec): FeatureSpec {
  const merged: FeatureSpec = {
    ...base,
    ...candidate,
  };

  for (const field of FEATURE_STRUCTURED_FIELDS) {
    const baseValue = (base as any)[field];
    const candidateValue = (candidate as any)[field];
    const candidateHasValue = Array.isArray(candidateValue)
      ? candidateValue.length > 0
      : hasText(candidateValue);

    if (!candidateHasValue && baseValue !== undefined) {
      (merged as any)[field] = baseValue;
    }
  }

  const baseRaw = String(base.rawContent || '').trim();
  const candidateRaw = String(candidate.rawContent || '').trim();
  const candidateLooksTruncated = looksLikeTruncatedOutput(candidateRaw);

  if (!candidateRaw || candidateLooksTruncated) {
    merged.rawContent = baseRaw || candidateRaw;
    return merged;
  }

  if (!baseRaw) {
    merged.rawContent = candidateRaw;
    return merged;
  }

  const baseAnchor = buildAnchor(baseRaw);
  const candidateNormalized = normalizeForMatch(candidateRaw);
  if (baseAnchor && !candidateNormalized.includes(baseAnchor)) {
    merged.rawContent = `${baseRaw}\n\n${candidateRaw}`.trim();
    return merged;
  }

  merged.rawContent = candidateRaw;
  return merged;
}

function mergeFeatureMaps(
  base: FeatureSpec[],
  candidate: FeatureSpec[]
): { features: FeatureSpec[] } {
  const byId = new Map<string, FeatureSpec>();
  for (const feature of base) {
    byId.set(feature.id, { ...feature });
  }

  const sortedCandidate = [...candidate].sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true })
  );

  for (const feature of sortedCandidate) {
    const existing = byId.get(feature.id);
    if (!existing) {
      byId.set(feature.id, { ...feature });
      continue;
    }
    byId.set(feature.id, mergeFeatureSpecs(existing, feature));
  }

  return {
    features: Array.from(byId.values()).sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { numeric: true })
    ),
  };
}

export function mergeSectionWithPreservation(baseValue: string, candidateValue: string): string {
  const baseText = String(baseValue || '').trim();
  const candidateText = String(candidateValue || '').trim();
  if (!baseText) return candidateText;
  if (!candidateText) return baseText;

  const anchor = buildAnchor(baseText);
  if (!anchor) return candidateText;
  const candidateNormalized = normalizeForMatch(candidateText);
  if (candidateNormalized.includes(anchor)) {
    return candidateText;
  }

  return `${baseText}\n\n${candidateText}`.trim();
}

export function mergeStructuresForImproveWithDiagnostics(
  base: PRDStructure,
  candidate: PRDStructure,
  requiredSectionDefs: RequiredSectionDefinition[]
): { structure: PRDStructure } {
  const mergedFeatures = mergeFeatureMaps(
    base.features || [],
    candidate.features || []
  );

  const merged: PRDStructure = {
    ...base,
    ...candidate,
    features: mergedFeatures.features,
    featureCatalogueIntro: mergeFeatureCatalogueIntro(
      base.featureCatalogueIntro,
      candidate.featureCatalogueIntro
    ),
    otherSections: {
      ...(base.otherSections || {}),
    },
  };

  for (const def of requiredSectionDefs) {
    const baseValue = base[def.key];
    const candidateValue = candidate[def.key];
    if (hasText(candidateValue) && hasText(baseValue)) {
      (merged as any)[def.key] = mergeSectionWithPreservation(
        String(baseValue || ''),
        String(candidateValue || '')
      );
      continue;
    }
    if (!hasText(candidateValue) && hasText(baseValue)) {
      (merged as any)[def.key] = baseValue;
    }
  }

  return {
    structure: merged,
  };
}

export function mergeStructuresForImprove(
  base: PRDStructure,
  candidate: PRDStructure,
  requiredSectionDefs: RequiredSectionDefinition[]
): PRDStructure {
  return mergeStructuresForImproveWithDiagnostics(base, candidate, requiredSectionDefs).structure;
}