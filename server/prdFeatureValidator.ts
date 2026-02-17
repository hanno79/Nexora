import type { FeatureSpec, PRDStructure } from './prdStructure';

const REQUIRED_SUBSECTIONS = [
  '1. Purpose',
  '2. Actors',
  '3. Trigger',
  '4. Preconditions',
  '5. Main Flow',
  '6. Alternate Flows',
  '7. Postconditions',
  '8. Data Impact',
  '9. UI Impact',
  '10. Acceptance Criteria',
];
const STRUCTURED_FIELDS: (keyof FeatureSpec)[] = [
  'purpose',
  'actors',
  'trigger',
  'preconditions',
  'mainFlow',
  'alternateFlows',
  'postconditions',
  'dataImpact',
  'uiImpact',
  'acceptanceCriteria',
];

const SHRINKAGE_THRESHOLD = 0.7;
const MIN_SECTION_CONTENT_LENGTH = 10;
const MIN_FEATURE_COMPLETENESS = 8;
const MAX_COMPLETENESS_DROP = 2;

export interface FeatureValidationResult {
  isValid: boolean;
  missingSections: string[];
  severeShrinkage: boolean;
  missingMainFlowNumbering: boolean;
  missingAcceptanceCriteriaContent: boolean;
  previousCompleteness: number;
  currentCompleteness: number;
  completenessRegression: boolean;
  belowMinimumCompleteness: boolean;
}

export interface IntegrityRestoration {
  featureId: string;
  reasons: string[];
  qualityRegression?: boolean;
  previousCompleteness?: number;
  currentCompleteness?: number;
}

function hasFieldValue(feature: FeatureSpec, field: keyof FeatureSpec): boolean {
  const value = feature[field];
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return typeof value === 'string' && value.trim().length > 0;
}

export function countFeatureCompleteness(feature: FeatureSpec): number {
  let count = 0;
  for (const field of STRUCTURED_FIELDS) {
    if (hasFieldValue(feature, field)) {
      count += 1;
    }
  }
  return count;
}

function buildSectionPattern(section: string): RegExp[] {
  const escaped = section.replace(/\./g, '\\.');
  return [
    new RegExp(`(^|\\n)\\s*#+\\s*${escaped}`, 'i'),
    new RegExp(`(^|\\n)\\s*\\*\\*${escaped}`, 'i'),
  ];
}

function findSectionBlock(content: string, sectionNum: string, nextSectionNum: string | null): string | null {
  const headingPattern = new RegExp(`(^|\\n)\\s*(?:#+\\s*|\\*\\*)${sectionNum}\\.`, 'i');
  const match = content.match(headingPattern);
  if (!match) return null;

  const start = content.indexOf(match[0]) + match[0].length;

  if (nextSectionNum) {
    const nextPattern = new RegExp(`(^|\\n)\\s*(?:#+\\s*|\\*\\*)${nextSectionNum}\\.`, 'i');
    const nextMatch = content.slice(start).match(nextPattern);
    if (nextMatch && nextMatch.index !== undefined) {
      return content.slice(start, start + nextMatch.index);
    }
  }

  return content.slice(start);
}

export function validateFeatureIntegrity(
  previousFeature: FeatureSpec,
  currentFeature: FeatureSpec
): FeatureValidationResult {
  const content = currentFeature.rawContent;
  const missingSections: string[] = [];

  for (const section of REQUIRED_SUBSECTIONS) {
    const patterns = buildSectionPattern(section);
    const found = patterns.some(p => p.test(content));
    if (!found) {
      missingSections.push(section);
    }
  }

  const severeShrinkage = currentFeature.rawContent.length < previousFeature.rawContent.length * SHRINKAGE_THRESHOLD;
  const previousCompleteness = countFeatureCompleteness(previousFeature);
  const currentCompleteness = countFeatureCompleteness(currentFeature);
  const completenessDrop = previousCompleteness - currentCompleteness;
  const completenessRegression = completenessDrop > MAX_COMPLETENESS_DROP;
  const belowMinimumCompleteness =
    currentCompleteness < MIN_FEATURE_COMPLETENESS && previousCompleteness >= MIN_FEATURE_COMPLETENESS;

  let missingMainFlowNumbering = false;
  const mainFlowBlock = findSectionBlock(content, '5', '6');
  if (mainFlowBlock !== null) {
    const hasNumbering = /(?:^|\n)\s*1\.\s/.test(mainFlowBlock);
    if (!hasNumbering) {
      missingMainFlowNumbering = true;
    }
  }

  let missingAcceptanceCriteriaContent = false;
  const acBlock = findSectionBlock(content, '10', null);
  if (acBlock !== null) {
    const trimmed = acBlock.trim();
    if (trimmed.length < MIN_SECTION_CONTENT_LENGTH) {
      missingAcceptanceCriteriaContent = true;
    }
  }

  const isValid = missingSections.length === 0
    && !severeShrinkage
    && !missingMainFlowNumbering
    && !missingAcceptanceCriteriaContent
    && !completenessRegression
    && !belowMinimumCompleteness;

  return {
    isValid,
    missingSections,
    severeShrinkage,
    missingMainFlowNumbering,
    missingAcceptanceCriteriaContent,
    previousCompleteness,
    currentCompleteness,
    completenessRegression,
    belowMinimumCompleteness,
  };
}

export function enforceFeatureIntegrity(
  previous: PRDStructure,
  current: PRDStructure
): { structure: PRDStructure; restorations: IntegrityRestoration[] } {
  const restorations: IntegrityRestoration[] = [];

  for (const prevFeature of previous.features) {
    const currIdx = current.features.findIndex(f => f.id === prevFeature.id);
    if (currIdx === -1) continue;

    const currFeature = current.features[currIdx];
    const result = validateFeatureIntegrity(prevFeature, currFeature);

    if (!result.isValid) {
      const reasons: string[] = [];
      if (result.missingSections.length > 0) {
        reasons.push(`missing sections: ${result.missingSections.join(', ')}`);
      }
      if (result.severeShrinkage) {
        reasons.push('severe content shrinkage (>30% loss)');
      }
      if (result.missingMainFlowNumbering) {
        reasons.push('missing Main Flow numbering');
      }
      if (result.missingAcceptanceCriteriaContent) {
        reasons.push('missing Acceptance Criteria content');
      }
      if (result.completenessRegression) {
        reasons.push(`feature completeness regressed (${result.previousCompleteness}/10 -> ${result.currentCompleteness}/10)`);
      }
      if (result.belowMinimumCompleteness) {
        reasons.push(`feature completeness below minimum (${result.currentCompleteness}/10 < ${MIN_FEATURE_COMPLETENESS}/10)`);
      }

      current.features[currIdx] = { ...prevFeature };
      restorations.push({
        featureId: prevFeature.id,
        reasons,
        qualityRegression: result.completenessRegression || result.belowMinimumCompleteness,
        previousCompleteness: result.previousCompleteness,
        currentCompleteness: result.currentCompleteness,
      });
      console.warn(`🛡️ Feature integrity restored: ${prevFeature.id} (${reasons.join('; ')})`);
    }
  }

  return { structure: current, restorations };
}
