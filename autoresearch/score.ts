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

// ── Multi-Run Statistik ─────────────────────────────────────────────────────

export interface RunStatistics {
  median: number;
  mean: number;
  min: number;
  max: number;
  stddev: number;
  runs: number;
  consistencyRate: number; // Anteil der Runs die besser als Baseline sind (0-1)
}

export function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function computeRunStatistics(
  scores: number[],
  baseline: number | null,
): RunStatistics {
  const n = scores.length;
  if (n === 0) {
    return { median: 0, mean: 0, min: 0, max: 0, stddev: 0, runs: 0, consistencyRate: 0 };
  }

  const median = computeMedian(scores);
  const mean = scores.reduce((s, v) => s + v, 0) / n;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  const consistencyRate = baseline !== null
    ? scores.filter(s => s <= baseline).length / n
    : 1; // Baseline-Run gilt immer als konsistent

  return { median, mean, min, max, stddev, runs: n, consistencyRate };
}

export function formatStatisticsOneLiner(stats: RunStatistics): string {
  return `Median: ${stats.median} Mean: ${stats.mean.toFixed(1)} ±${stats.stddev.toFixed(1)} [${stats.min}..${stats.max}] (${stats.runs} runs, ${(stats.consistencyRate * 100).toFixed(0)}% consistent)`;
}
