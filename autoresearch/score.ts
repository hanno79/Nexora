/**
 * AutoPRD Score Function
 *
 * Berechnet einen einzelnen numerischen Composite-Score aus den
 * Compiler-Qualitätsmetriken. Niedrigerer Score = besser.
 * Ziel: score → 0
 */

import type { PrdQualityReport } from '../server/prdCompilerValidation';

export interface ScoreWeights {
  error: number;
  warning: number;
  blockingIssue: number;
  fallbackSection: number;
  missingSections: number;
  truncation: number;
  invalidStructure: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  error: 10,
  warning: 1,
  blockingIssue: 20,
  fallbackSection: 5,
  missingSections: 8,
  truncation: 50,
  invalidStructure: 30,
};

export interface ScoreBreakdown {
  total: number;
  errors: number;
  warnings: number;
  blockingIssues: number;
  fallbackSections: number;
  missingSections: number;
  truncationPenalty: number;
  invalidPenalty: number;
  errorCount: number;
  warningCount: number;
  blockingIssueCount: number;
  fallbackSectionCount: number;
  missingSectionCount: number;
  featureCount: number;
}

export interface SemanticVerdict {
  verdict: 'pass' | 'fail';
  blockingIssueCount: number;
}

export function computeScore(
  quality: PrdQualityReport,
  semanticVerdict?: SemanticVerdict,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): ScoreBreakdown {
  const errorCount = quality.issues.filter(i => i.severity === 'error').length;
  const warningCount = quality.issues.filter(i => i.severity === 'warning').length;
  const blockingIssueCount = semanticVerdict?.verdict === 'fail'
    ? semanticVerdict.blockingIssueCount
    : 0;
  const fallbackSectionCount = quality.fallbackSections?.length ?? 0;
  const missingSectionCount = quality.missingSections.length;

  const errors = errorCount * weights.error;
  const warnings = warningCount * weights.warning;
  const blockingIssues = blockingIssueCount * weights.blockingIssue;
  const fallbackSections = fallbackSectionCount * weights.fallbackSection;
  const missingSections = missingSectionCount * weights.missingSections;
  const truncationPenalty = quality.truncatedLikely ? weights.truncation : 0;
  const invalidPenalty = quality.valid ? 0 : weights.invalidStructure;

  const total = errors + warnings + blockingIssues + fallbackSections
    + missingSections + truncationPenalty + invalidPenalty;

  return {
    total,
    errors,
    warnings,
    blockingIssues,
    fallbackSections,
    missingSections,
    truncationPenalty,
    invalidPenalty,
    errorCount,
    warningCount,
    blockingIssueCount,
    fallbackSectionCount,
    missingSectionCount,
    featureCount: quality.featureCount,
  };
}

export function formatScoreOneLiner(b: ScoreBreakdown): string {
  return `Score: ${b.total} (E:${b.errorCount}×10=${b.errors} W:${b.warningCount}×1=${b.warnings} B:${b.blockingIssueCount}×20=${b.blockingIssues} FB:${b.fallbackSectionCount}×5=${b.fallbackSections} MS:${b.missingSectionCount}×8=${b.missingSections} T:${b.truncationPenalty} I:${b.invalidPenalty}) Features:${b.featureCount}`;
}
