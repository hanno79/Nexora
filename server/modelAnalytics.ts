/*
Author: rahn
Datum: 15.03.2026
Version: 1.0
Beschreibung: Aggregationslogik fuer die Modell-Analytik Settings-Section.
              Liest Compiler-Run-Artifacts und berechnet PRD-Run-Liste,
              Modell-Ranking, Kombinations-Analyse und Kosten-Trend.
*/

import type { PrdQualityStatus } from './prdRunQuality';
import {
  loadCompilerRunArtifacts,
  collectUsageSamples,
  deriveTotalTokens,
  isAcceptedRun,
  hasReviewerRepair,
  type CompilerRunArtifact,
  type UsageSample,
} from './compilerRunMetrics';
import { estimateUsageCostUsd } from './modelPricing';

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface ModelAnalyticsRun {
  timestamp: string;
  routeKey: string;
  workflow: string;
  qualityStatus: PrdQualityStatus;
  generatorModel: string | null;
  reviewerModel: string | null;
  verifierModel: string | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  repairAttempts: number;
}

export interface ModelRankingEntry {
  model: string;
  provider: string;
  totalRuns: number;
  avgTokensPerRun: number;
  avgCostPerRun: number;
  acceptanceRate: number;
  repairRate: number;
  pricePerformanceScore: number;
}

export interface CombinationEntry {
  combinationKey: string;
  generatorModel: string;
  reviewerModel: string;
  verifierModel: string;
  runCount: number;
  avgCostUsd: number;
  acceptanceRate: number;
  avgTokens: number;
  bestQuality: PrdQualityStatus;
  worstQuality: PrdQualityStatus;
}

export interface CostTrendEntry {
  date: string;
  totalCostUsd: number;
  runCount: number;
  byModel: Record<string, number>;
}

export interface ModelAnalyticsResponse {
  runs: ModelAnalyticsRun[];
  modelRanking: ModelRankingEntry[];
  combinations: CombinationEntry[];
  costTrend: CostTrendEntry[];
  totalRuns: number;
  totalCostUsd: number;
  totalTokens: number;
}

export interface ModelAnalyticsOptions {
  baseDir: string;
  days?: number;
  qualityStatusFilter?: PrdQualityStatus[];
}

// ---------------------------------------------------------------------------
// Quality status ordering (best → worst)
// ---------------------------------------------------------------------------

const QUALITY_ORDER: Record<string, number> = {
  passed: 0,
  degraded: 1,
  failed_quality: 2,
  failed_runtime: 3,
  cancelled: 4,
};

function betterQuality(a: PrdQualityStatus, b: PrdQualityStatus): PrdQualityStatus {
  return (QUALITY_ORDER[a] ?? 99) <= (QUALITY_ORDER[b] ?? 99) ? a : b;
}

function worseQuality(a: PrdQualityStatus, b: PrdQualityStatus): PrdQualityStatus {
  return (QUALITY_ORDER[a] ?? 99) >= (QUALITY_ORDER[b] ?? 99) ? a : b;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractProvider(model: string): string {
  const slash = model.indexOf('/');
  return slash > 0 ? model.substring(0, slash) : 'unknown';
}

function extractModelRoles(
  artifact: CompilerRunArtifact,
  samples: UsageSample[],
): { generator: string | null; reviewer: string | null; verifier: string | null } {
  const stageData = artifact.stageData || {};
  const getModel = (stage: unknown): string | null => {
    if (stage && typeof stage === 'object' && 'model' in stage) {
      const m = (stage as Record<string, unknown>).model;
      return typeof m === 'string' && m.length > 0 ? m : null;
    }
    return null;
  };

  let generator = getModel(stageData.generatorResponse) || getModel(stageData.generationStage);
  let reviewer = getModel(stageData.reviewerResponse) || getModel(stageData.finalReview);
  let verifier: string | null = null;

  // Check compiler artifact for verifier model
  const compilerArtifact = stageData.compilerArtifact;
  if (compilerArtifact && typeof compilerArtifact === 'object') {
    const ca = compilerArtifact as Record<string, unknown>;
    if (Array.isArray(ca.semanticVerificationHistory) && ca.semanticVerificationHistory.length > 0) {
      verifier = getModel(ca.semanticVerificationHistory[0]);
    }
  }

  // Fallback: use modelsUsed array
  if (!generator && artifact.modelsUsed.length > 0) generator = artifact.modelsUsed[0];
  if (!reviewer && artifact.modelsUsed.length > 1) reviewer = artifact.modelsUsed[1];
  if (!verifier && artifact.modelsUsed.length > 2) verifier = artifact.modelsUsed[2];

  return { generator, reviewer, verifier };
}

function computeRunCost(samples: UsageSample[]): number | null {
  if (samples.length === 0) return null;
  let total = 0;
  let hasValidCost = false;
  for (const sample of samples) {
    const cost = estimateUsageCostUsd(sample.model, sample.usage);
    if (cost !== null) {
      total += cost;
      hasValidCost = true;
    }
  }
  return hasValidCost ? total : null;
}

function toDateKey(timestamp: string): string {
  try {
    return new Date(timestamp).toISOString().substring(0, 10);
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Main aggregation
// ---------------------------------------------------------------------------

export async function getModelAnalytics(options: ModelAnalyticsOptions): Promise<ModelAnalyticsResponse> {
  const { baseDir, days, qualityStatusFilter } = options;

  const { artifacts } = await loadCompilerRunArtifacts({
    baseDir,
    days,
    limit: 1000,
  });

  // Filter by quality status if requested
  const filtered = qualityStatusFilter?.length
    ? artifacts.filter(a => qualityStatusFilter.includes(a.qualityStatus))
    : artifacts;

  // Accumulators
  const runs: ModelAnalyticsRun[] = [];
  const modelStats = new Map<string, {
    totalRuns: number;
    totalTokens: number;
    totalCost: number;
    acceptedRuns: number;
    repairedRuns: number;
  }>();
  const comboStats = new Map<string, {
    generator: string;
    reviewer: string;
    verifier: string;
    runCount: number;
    totalCost: number;
    totalTokens: number;
    acceptedRuns: number;
    bestQuality: PrdQualityStatus;
    worstQuality: PrdQualityStatus;
  }>();
  const dailyCosts = new Map<string, {
    totalCostUsd: number;
    runCount: number;
    byModel: Record<string, number>;
  }>();

  let grandTotalCost = 0;
  let grandTotalTokens = 0;

  // Single pass over artifacts
  for (const artifact of filtered) {
    const samples = collectUsageSamples(artifact);
    const tokens = deriveTotalTokens(artifact, samples) ?? 0;
    const cost = computeRunCost(samples);
    const roles = extractModelRoles(artifact, samples);
    const accepted = isAcceptedRun(artifact);
    const repaired = hasReviewerRepair(artifact);
    const repairCount = artifact.compilerDiagnostics?.repairAttempts ?? 0;

    // View 1: runs list
    runs.push({
      timestamp: artifact.timestamp,
      routeKey: artifact.routeKey,
      workflow: artifact.workflow,
      qualityStatus: artifact.qualityStatus,
      generatorModel: roles.generator,
      reviewerModel: roles.reviewer,
      verifierModel: roles.verifier,
      totalTokens: tokens || null,
      estimatedCostUsd: cost,
      repairAttempts: repairCount,
    });

    // View 2: model ranking accumulation
    const allModels = new Set<string>();
    if (roles.generator) allModels.add(roles.generator);
    if (roles.reviewer) allModels.add(roles.reviewer);
    if (roles.verifier) allModels.add(roles.verifier);

    for (const model of allModels) {
      const existing = modelStats.get(model) || {
        totalRuns: 0, totalTokens: 0, totalCost: 0, acceptedRuns: 0, repairedRuns: 0,
      };
      existing.totalRuns++;
      existing.totalTokens += tokens;
      existing.totalCost += cost ?? 0;
      if (accepted) existing.acceptedRuns++;
      if (repaired) existing.repairedRuns++;
      modelStats.set(model, existing);
    }

    // View 3: combination accumulation
    const gen = roles.generator || 'unknown';
    const rev = roles.reviewer || 'unknown';
    const ver = roles.verifier || 'unknown';
    const comboKey = `${gen}|${rev}|${ver}`;
    const existingCombo = comboStats.get(comboKey) || {
      generator: gen, reviewer: rev, verifier: ver,
      runCount: 0, totalCost: 0, totalTokens: 0, acceptedRuns: 0,
      bestQuality: artifact.qualityStatus,
      worstQuality: artifact.qualityStatus,
    };
    existingCombo.runCount++;
    existingCombo.totalCost += cost ?? 0;
    existingCombo.totalTokens += tokens;
    if (accepted) existingCombo.acceptedRuns++;
    existingCombo.bestQuality = betterQuality(existingCombo.bestQuality, artifact.qualityStatus);
    existingCombo.worstQuality = worseQuality(existingCombo.worstQuality, artifact.qualityStatus);
    comboStats.set(comboKey, existingCombo);

    // View 4: daily cost trend
    const dateKey = toDateKey(artifact.timestamp);
    const daily = dailyCosts.get(dateKey) || { totalCostUsd: 0, runCount: 0, byModel: {} };
    daily.totalCostUsd += cost ?? 0;
    daily.runCount++;
    for (const model of allModels) {
      daily.byModel[model] = (daily.byModel[model] || 0) + (cost ?? 0) / allModels.size;
    }
    dailyCosts.set(dateKey, daily);

    grandTotalCost += cost ?? 0;
    grandTotalTokens += tokens;
  }

  // Finalize model ranking
  const modelRanking: ModelRankingEntry[] = [];
  for (const [model, stats] of modelStats) {
    const avgCost = stats.totalRuns > 0 ? stats.totalCost / stats.totalRuns : 0;
    const acceptanceRate = stats.totalRuns > 0 ? stats.acceptedRuns / stats.totalRuns : 0;
    modelRanking.push({
      model,
      provider: extractProvider(model),
      totalRuns: stats.totalRuns,
      avgTokensPerRun: stats.totalRuns > 0 ? Math.round(stats.totalTokens / stats.totalRuns) : 0,
      avgCostPerRun: avgCost,
      acceptanceRate,
      repairRate: stats.totalRuns > 0 ? stats.repairedRuns / stats.totalRuns : 0,
      pricePerformanceScore: avgCost > 0 ? acceptanceRate / avgCost : 0,
    });
  }
  modelRanking.sort((a, b) => b.pricePerformanceScore - a.pricePerformanceScore);

  // Finalize combinations
  const combinations: CombinationEntry[] = [];
  for (const [key, stats] of comboStats) {
    combinations.push({
      combinationKey: key,
      generatorModel: stats.generator,
      reviewerModel: stats.reviewer,
      verifierModel: stats.verifier,
      runCount: stats.runCount,
      avgCostUsd: stats.runCount > 0 ? stats.totalCost / stats.runCount : 0,
      acceptanceRate: stats.runCount > 0 ? stats.acceptedRuns / stats.runCount : 0,
      avgTokens: stats.runCount > 0 ? Math.round(stats.totalTokens / stats.runCount) : 0,
      bestQuality: stats.bestQuality,
      worstQuality: stats.worstQuality,
    });
  }
  combinations.sort((a, b) => b.acceptanceRate - a.acceptanceRate || a.avgCostUsd - b.avgCostUsd);

  // Finalize cost trend (sorted by date)
  const costTrend: CostTrendEntry[] = Array.from(dailyCosts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, stats]) => ({
      date,
      totalCostUsd: stats.totalCostUsd,
      runCount: stats.runCount,
      byModel: stats.byModel,
    }));

  // Sort runs by timestamp descending (newest first)
  runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return {
    runs,
    modelRanking,
    combinations,
    costTrend,
    totalRuns: filtered.length,
    totalCostUsd: grandTotalCost,
    totalTokens: grandTotalTokens,
  };
}
