import type { PRDStructure } from './prdStructure';

export interface StructuralDiff {
  missingSections: string[];
  removedFeatures: string[];
  addedFeatures: string[];
  featureIdChanges: boolean;
}

const TRACKED_SECTIONS: (keyof PRDStructure)[] = [
  'systemVision',
  'systemBoundaries',
  'domainModel',
  'globalBusinessRules',
  'featureCatalogueIntro',
  'nonFunctional',
  'errorHandling',
  'deployment',
  'definitionOfDone',
];

export function compareStructures(
  previous: PRDStructure,
  current: PRDStructure
): StructuralDiff {
  const missingSections: string[] = [];

  for (const key of TRACKED_SECTIONS) {
    const hadSection = typeof previous[key] === 'string' && (previous[key] as string).trim().length > 0;
    const hasSection = typeof current[key] === 'string' && (current[key] as string).trim().length > 0;

    if (hadSection && !hasSection) {
      missingSections.push(key);
    }
  }

  const prevFeatureIds = previous.features.map(f => f.id);
  const currFeatureIds = current.features.map(f => f.id);

  const removedFeatures = prevFeatureIds.filter(id => !currFeatureIds.includes(id));
  const addedFeatures = currFeatureIds.filter(id => !prevFeatureIds.includes(id));

  const commonIds = prevFeatureIds.filter(id => currFeatureIds.includes(id));
  let featureIdChanges = false;
  if (commonIds.length > 0) {
    const prevOrder = commonIds.map(id => prevFeatureIds.indexOf(id));
    const currOrder = commonIds.map(id => currFeatureIds.indexOf(id));
    for (let i = 1; i < prevOrder.length; i++) {
      if (
        (prevOrder[i] > prevOrder[i - 1]) !== (currOrder[i] > currOrder[i - 1])
      ) {
        featureIdChanges = true;
        break;
      }
    }
  }

  return { missingSections, removedFeatures, addedFeatures, featureIdChanges };
}

export function logStructuralDrift(iteration: number, diff: StructuralDiff): string[] {
  const warnings: string[] = [];

  if (diff.removedFeatures.length > 0) {
    const msg = `⚠️ Iteration ${iteration}: Feature loss detected: ${diff.removedFeatures.join(', ')}`;
    console.warn(msg);
    warnings.push(msg);
  }

  if (diff.missingSections.length > 0) {
    const msg = `⚠️ Iteration ${iteration}: Section drift detected: ${diff.missingSections.join(', ')}`;
    console.warn(msg);
    warnings.push(msg);
  }

  if (diff.featureIdChanges) {
    const msg = `⚠️ Iteration ${iteration}: Feature ID ordering changed`;
    console.warn(msg);
    warnings.push(msg);
  }

  if (diff.addedFeatures.length > 0) {
    const msg = `📌 Iteration ${iteration}: New features added: ${diff.addedFeatures.join(', ')}`;
    console.log(msg);
    warnings.push(msg);
  }

  if (warnings.length === 0) {
    console.log(`✅ Iteration ${iteration}: No structural drift detected`);
  }

  return warnings;
}
