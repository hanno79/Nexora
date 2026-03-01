// Shared post-compiler feature preservation: restores lost features
// and enforces field-level integrity against a baseline structure.
// Used by Simple, Iterative, and Guided flows after finalizeWithCompilerGates().
import type { PRDStructure } from './prdStructure';
import { compareStructures } from './prdStructureDiff';
import { restoreRemovedFeatures } from './prdStructureDiff';
import { enforceFeatureIntegrity } from './prdFeatureValidator';
import { assembleStructureToMarkdown } from './prdAssembler';

export interface PreservationResult {
  content: string;
  structure: PRDStructure;
  changed: boolean;
  restoredFeatureCount: number;
  integrityRestorationCount: number;
}

export function runPostCompilerPreservation(
  baseline: PRDStructure,
  compilerOutput: { content: string; structure: PRDStructure },
  log?: (msg: string) => void,
  warn?: (msg: string) => void,
): PreservationResult {
  const logFn = log ?? (() => {});
  const warnFn = warn ?? (() => {});

  let { content, structure } = compilerOutput;
  let changed = false;
  let restoredFeatureCount = 0;
  let integrityRestorationCount = 0;

  // 1. Restore features that were completely lost during compilation
  const diff = compareStructures(baseline, structure);
  if (diff.removedFeatures.length > 0) {
    logFn(`🔄 Restoring ${diff.removedFeatures.length} features lost during compilation: ${diff.removedFeatures.join(', ')}`);
    structure = restoreRemovedFeatures(baseline, structure, diff.removedFeatures);
    restoredFeatureCount = diff.removedFeatures.length;
    changed = true;
  }

  // 2. Enforce field-level integrity against the baseline
  const integrityResult = enforceFeatureIntegrity(baseline, structure);
  if (integrityResult.restorations.length > 0) {
    logFn(`🛡️ Feature integrity enforced: ${integrityResult.restorations.length} features restored to baseline quality`);
    structure = integrityResult.structure;
    integrityRestorationCount = integrityResult.restorations.length;
    changed = true;
  }

  // 3. Re-assemble markdown from the protected structure
  if (changed) {
    content = assembleStructureToMarkdown(structure);
    logFn(`📝 Content re-assembled with ${structure.features.length} protected features`);
  }

  // 4. Log degradation summary
  const expandedCount = baseline.features.length;
  const finalCount = structure.features.length;
  if (finalCount < Math.ceil(expandedCount / 2)) {
    warnFn(`⚠️ Feature degradation persists after restoration: ${expandedCount} expanded → ${finalCount} final.`);
  }

  return { content, structure, changed, restoredFeatureCount, integrityRestorationCount };
}
