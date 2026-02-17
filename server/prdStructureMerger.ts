import type { PRDStructure, FeatureSpec } from './prdStructure';
import { STRUCTURED_FIELD_NAMES } from './prdStructure';
import type { ExpandedFeature } from './services/llm/expandFeature';
import { parseFeatureSubsections } from './prdParser';

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

/**
 * Merge two FeatureSpecs field-by-field.
 * For each of the 10 structured fields, the richer value wins.
 */
function mergeFeatureSpecs(existing: FeatureSpec, expanded: FeatureSpec): FeatureSpec {
  const merged: FeatureSpec = { ...existing };

  for (const field of STRUCTURED_FIELD_NAMES) {
    const expandedLen = contentLength(expanded[field]);
    const existingLen = contentLength(existing[field]);

    // Expanded wins if it has content and existing doesn't, or if it's richer
    if (expandedLen > 0 && (existingLen === 0 || expandedLen > existingLen)) {
      (merged as any)[field] = expanded[field];
    }
  }

  // Update rawContent to the richer version
  if (expanded.rawContent.length > existing.rawContent.length) {
    merged.rawContent = expanded.rawContent;
  }

  return merged;
}
