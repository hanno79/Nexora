import type { PRDStructure, PRDStructureMetadata, FeatureCompleteness, FeatureSpec, STRUCTURED_FIELD_NAMES } from './prdStructure';
import { STRUCTURED_FIELD_NAMES as FIELDS } from './prdStructure';

function hasValue(val: unknown): boolean {
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === 'string') return val.trim().length > 0;
  return false;
}

export function computeFeatureCompleteness(feature: FeatureSpec): FeatureCompleteness {
  const missing: string[] = [];
  let filled = 0;

  for (const field of FIELDS) {
    if (hasValue(feature[field])) {
      filled++;
    } else {
      missing.push(field);
    }
  }

  return {
    featureId: feature.id,
    featureName: feature.name,
    filledFields: filled,
    totalFields: 10,
    missingFields: missing,
    isComplete: filled === 10,
  };
}

export function computeCompleteness(structure: PRDStructure): PRDStructureMetadata {
  const details = structure.features.map(computeFeatureCompleteness);

  const completeFeatures = details.filter(d => d.isComplete).length;
  const avgCompleteness = details.length > 0
    ? Math.round(
        (details.reduce((sum, d) => sum + d.filledFields, 0) / (details.length * 10)) * 100
      ) / 100
    : 0;

  return {
    featureCount: structure.features.length,
    completeFeatures,
    averageCompleteness: avgCompleteness,
    featureDetails: details,
  };
}
