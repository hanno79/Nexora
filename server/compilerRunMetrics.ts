import fs from "fs";
import path from "path";
import type { TokenUsage } from "@shared/schema";
import type { PrdQualityReport } from "./prdCompiler";
import type { CompilerRunDiagnostics, PrdFinalizationStage, PrdQualityStatus } from "./prdRunQuality";
import type { PRDStructure } from "./prdStructure";
import { estimateUsageCostUsd, getFallbackModelPricing } from "./modelPricing";

interface CompilerRunArtifactStageData {
  totalTokens?: number;
  timings?: Record<string, number>;
  [key: string]: unknown;
}

export interface CompilerRunArtifact {
  timestamp: string;
  workflow: string;
  routeKey: string;
  qualityStatus: PrdQualityStatus;
  finalizationStage: PrdFinalizationStage;
  finalContent: string;
  compiled: {
    content: string;
    structure: PRDStructure | null;
    quality: PrdQualityReport | null;
  };
  iterationLog: string | null;
  modelsUsed: string[];
  compilerDiagnostics: CompilerRunDiagnostics | null;
  requestContext: Record<string, unknown>;
  stageData: CompilerRunArtifactStageData;
  artifactPath?: string;
}

export interface CompilerRunMetricsOptions {
  baseDir: string;
  workflow?: string;
  routeKey?: string;
  days?: number;
  limit?: number;
  includeLatest?: boolean;
  now?: Date;
}

export interface NumericMetricSummary {
  count: number;
  avg: number;
  p95: number;
  min: number;
  max: number;
}

export type CompilerRunHealthState = "healthy" | "warning" | "critical";

export interface CompilerRunMetricsAlert {
  code: string;
  severity: "warning" | "critical";
  title: string;
  message: string;
  recommendation: string;
  metricValue: number;
  threshold: number;
}

export interface CompilerRunMetricsSummary {
  window: {
    reportDir: string;
    workflow?: string;
    routeKey?: string;
    days?: number;
    limit?: number;
    includeLatest: boolean;
    totalArtifactsScanned: number;
    totalArtifactsIncluded: number;
    parseErrorCount: number;
    newestTimestamp?: string;
    oldestTimestamp?: string;
  };
  counts: {
    totalRuns: number;
    passedRuns: number;
    degradedRuns: number;
    failedQualityRuns: number;
    failedRuntimeRuns: number;
    cancelledRuns: number;
    acceptedRuns: number;
  };
  rates: {
    acceptanceRate: number;
    firstPassPassRate: number;
    reviewerRepairRate: number;
    semanticBlockRate: number;
    hardFailRate: number;
    sameFamilyVerifierFallbackRate: number;
  };
  quality: {
    averageRepairAttempts: number;
    averageWarningCount: number;
    averageErrorCount: number;
    topRootCauses: Array<{ code: string; count: number }>;
  };
  latency: {
    stages: Record<string, NumericMetricSummary>;
  };
  tokens: {
    runsWithTokenData: number;
    totalTokens: number;
    averageTotalTokens: number;
    p95TotalTokens: number;
    averageAcceptedRunTokens: number;
  };
  costEstimate: {
    totalEstimatedCostUsd: number;
    acceptedEstimatedCostUsd: number;
    averageEstimatedCostUsdPerAcceptedRun: number;
    acceptedRunsWithCostData: number;
    acceptedRunsWithCompleteCostCoverage: number;
    acceptedRunCoverageRate: number;
    pricedUsageSampleCount: number;
    usageSampleCount: number;
    unknownPricingModels: string[];
  };
  alerts: CompilerRunMetricsAlert[];
  healthState: CompilerRunHealthState;
  workflows: Array<{ workflow: string; count: number; acceptedRuns: number; hardFails: number }>;
  routes: Array<{ routeKey: string; count: number; acceptedRuns: number; hardFails: number }>;
  recentRuns: Array<{
    timestamp: string;
    workflow: string;
    routeKey: string;
    qualityStatus: PrdQualityStatus;
    failureStage?: string;
    repairAttempts: number;
    semanticVerifierVerdict?: "pass" | "fail";
    totalTokens?: number;
    totalDurationMs?: number;
  }>;
}

interface UsageSample {
  model: string;
  usage: TokenUsage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return roundMetric(numerator / denominator);
}

function summarizeNumeric(values: number[]): NumericMetricSummary {
  if (values.length === 0) {
    return { count: 0, avg: 0, p95: 0, min: 0, max: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  const total = sorted.reduce((sum, value) => sum + value, 0);

  return {
    count: sorted.length,
    avg: roundMetric(total / sorted.length),
    p95: roundMetric(sorted[p95Index]),
    min: roundMetric(sorted[0]),
    max: roundMetric(sorted[sorted.length - 1]),
  };
}

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

function hasReviewerRepair(artifact: CompilerRunArtifact): boolean {
  const diagnostics = artifact.compilerDiagnostics;
  if (!diagnostics) return false;
  return (
    (diagnostics.repairAttempts || 0) > 0 ||
    !!diagnostics.contentRefined ||
    !!diagnostics.semanticRepairApplied
  );
}

function isFirstPassAccepted(artifact: CompilerRunArtifact): boolean {
  const diagnostics = artifact.compilerDiagnostics;
  return artifact.qualityStatus === "passed" && !hasReviewerRepair(artifact) && !diagnostics?.failureStage;
}

function isAcceptedRun(artifact: CompilerRunArtifact): boolean {
  return artifact.qualityStatus === "passed" || artifact.qualityStatus === "degraded";
}

function isSemanticBlocked(artifact: CompilerRunArtifact): boolean {
  const diagnostics = artifact.compilerDiagnostics;
  return diagnostics?.failureStage === "semantic_verifier" || diagnostics?.semanticVerifierVerdict === "fail";
}

function isTimedStageRecord(value: unknown): value is Record<string, number> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(entry => typeof entry === "number" && Number.isFinite(entry));
}

function extractTimings(artifact: CompilerRunArtifact): Record<string, number> {
  const timings = artifact.stageData?.timings;
  return isTimedStageRecord(timings) ? timings : {};
}

function toUsageSample(value: unknown): UsageSample | null {
  if (!isRecord(value)) return null;
  if (typeof value.model !== "string" || !value.model.trim()) return null;
  if (!isRecord(value.usage)) return null;

  const promptTokens = toFiniteNumber(value.usage.prompt_tokens) ?? 0;
  const completionTokens = toFiniteNumber(value.usage.completion_tokens) ?? 0;
  const totalTokens = toFiniteNumber(value.usage.total_tokens) ?? promptTokens + completionTokens;

  return {
    model: value.model.trim(),
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
    },
  };
}

function collectUsageSamples(artifact: CompilerRunArtifact): UsageSample[] {
  const stageData = artifact.stageData || {};
  const candidates: unknown[] = [
    stageData.generatorResponse,
    stageData.reviewerResponse,
    stageData.improvedVersion,
    stageData.analysisStage,
    stageData.generationStage,
    stageData.finalReview,
  ];

  const compilerArtifact = isRecord(stageData.compilerArtifact) ? stageData.compilerArtifact : null;
  if (compilerArtifact) {
    if (Array.isArray(compilerArtifact.repairAttempts)) {
      candidates.push(...compilerArtifact.repairAttempts);
    }
    if (Array.isArray(compilerArtifact.reviewerAttempts)) {
      candidates.push(...compilerArtifact.reviewerAttempts);
    }
    if (Array.isArray(compilerArtifact.semanticVerificationHistory)) {
      candidates.push(...compilerArtifact.semanticVerificationHistory);
    }
  }

  const deduped = new Map<string, UsageSample>();
  for (const candidate of candidates) {
    const sample = toUsageSample(candidate);
    if (!sample) continue;
    const key = [
      sample.model,
      sample.usage.prompt_tokens ?? 0,
      sample.usage.completion_tokens ?? 0,
      sample.usage.total_tokens ?? 0,
    ].join("|");
    if (!deduped.has(key)) {
      deduped.set(key, sample);
    }
  }

  return Array.from(deduped.values());
}

function deriveTotalTokens(artifact: CompilerRunArtifact, usageSamples: UsageSample[]): number | undefined {
  const explicitTotal = toFiniteNumber(artifact.stageData?.totalTokens);
  if (explicitTotal !== undefined) {
    return explicitTotal;
  }

  if (usageSamples.length === 0) {
    return undefined;
  }

  const usageTotal = usageSamples.reduce((sum, sample) => sum + (sample.usage.total_tokens || 0), 0);
  return usageTotal > 0 ? usageTotal : undefined;
}

function normalizeArtifact(raw: unknown, artifactPath: string): CompilerRunArtifact | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.timestamp !== "string") return null;
  if (typeof raw.workflow !== "string") return null;
  if (typeof raw.routeKey !== "string") return null;
  if (typeof raw.qualityStatus !== "string") return null;
  if (typeof raw.finalizationStage !== "string") return null;

  const compiled = isRecord(raw.compiled) ? raw.compiled : {};
  const stageData = isRecord(raw.stageData) ? raw.stageData : {};

  return {
    timestamp: raw.timestamp,
    workflow: raw.workflow,
    routeKey: raw.routeKey,
    qualityStatus: raw.qualityStatus as PrdQualityStatus,
    finalizationStage: raw.finalizationStage as PrdFinalizationStage,
    finalContent: typeof raw.finalContent === "string" ? raw.finalContent : "",
    compiled: {
      content: typeof compiled.content === "string" ? compiled.content : "",
      structure: (compiled.structure as PRDStructure | null) || null,
      quality: (compiled.quality as PrdQualityReport | null) || null,
    },
    iterationLog: typeof raw.iterationLog === "string" ? raw.iterationLog : null,
    modelsUsed: Array.isArray(raw.modelsUsed) ? raw.modelsUsed.filter((entry): entry is string => typeof entry === "string") : [],
    compilerDiagnostics: (raw.compilerDiagnostics as CompilerRunDiagnostics | null) || null,
    requestContext: isRecord(raw.requestContext) ? raw.requestContext : {},
    stageData: stageData as CompilerRunArtifactStageData,
    artifactPath,
  };
}

export async function loadCompilerRunArtifacts(options: CompilerRunMetricsOptions): Promise<{
  reportDir: string;
  artifacts: CompilerRunArtifact[];
  totalArtifactsScanned: number;
  parseErrorCount: number;
}> {
  const reportDir = path.join(options.baseDir, "documentation", "compiler_runs");
  const includeLatest = options.includeLatest === true;
  const now = options.now || new Date();
  const workflowFilter = options.workflow?.trim().toLowerCase() || "";
  const routeKeyFilter = options.routeKey?.trim().toLowerCase() || "";
  const minTimestamp = typeof options.days === "number" && options.days > 0
    ? now.getTime() - options.days * 24 * 60 * 60 * 1000
    : null;

  let fileNames: string[] = [];
  try {
    fileNames = (await fs.promises.readdir(reportDir))
      .filter(fileName => fileName.endsWith(".json"))
      .filter(fileName => includeLatest || !fileName.endsWith("_latest.json"));
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return { reportDir, artifacts: [], totalArtifactsScanned: 0, parseErrorCount: 0 };
    }
    throw error;
  }

  const parsedArtifacts: CompilerRunArtifact[] = [];
  let parseErrorCount = 0;

  for (const fileName of fileNames) {
    const artifactPath = path.join(reportDir, fileName);
    try {
      const content = await fs.promises.readFile(artifactPath, "utf8");
      const parsed = normalizeArtifact(JSON.parse(content), artifactPath);
      if (!parsed) {
        parseErrorCount += 1;
        continue;
      }
      const artifactTime = Date.parse(parsed.timestamp);
      if (Number.isNaN(artifactTime)) {
        parseErrorCount += 1;
        continue;
      }
      if (workflowFilter && parsed.workflow.trim().toLowerCase() !== workflowFilter) continue;
      if (routeKeyFilter && parsed.routeKey.trim().toLowerCase() !== routeKeyFilter) continue;
      if (minTimestamp !== null && artifactTime < minTimestamp) continue;
      parsedArtifacts.push(parsed);
    } catch {
      parseErrorCount += 1;
    }
  }

  parsedArtifacts.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));

  const limitedArtifacts =
    typeof options.limit === "number" && options.limit > 0
      ? parsedArtifacts.slice(0, options.limit)
      : parsedArtifacts;

  return {
    reportDir,
    artifacts: limitedArtifacts,
    totalArtifactsScanned: fileNames.length,
    parseErrorCount,
  };
}

export async function getCompilerRunMetrics(options: CompilerRunMetricsOptions): Promise<CompilerRunMetricsSummary> {
  const loaded = await loadCompilerRunArtifacts(options);
  const artifacts = loaded.artifacts;
  const acceptedRuns = artifacts.filter(isAcceptedRun);

  const counts = {
    totalRuns: artifacts.length,
    passedRuns: artifacts.filter(artifact => artifact.qualityStatus === "passed").length,
    degradedRuns: artifacts.filter(artifact => artifact.qualityStatus === "degraded").length,
    failedQualityRuns: artifacts.filter(artifact => artifact.qualityStatus === "failed_quality").length,
    failedRuntimeRuns: artifacts.filter(artifact => artifact.qualityStatus === "failed_runtime").length,
    cancelledRuns: artifacts.filter(artifact => artifact.qualityStatus === "cancelled").length,
    acceptedRuns: acceptedRuns.length,
  };

  const timingBuckets = new Map<string, number[]>();
  const tokenValues: number[] = [];
  const acceptedTokenValues: number[] = [];
  const rootCauseCounts = new Map<string, number>();
  const workflowCounts = new Map<string, { count: number; acceptedRuns: number; hardFails: number }>();
  const routeCounts = new Map<string, { count: number; acceptedRuns: number; hardFails: number }>();

  let repairAttemptsTotal = 0;
  let warningCountTotal = 0;
  let errorCountTotal = 0;
  let pricedUsageSampleCount = 0;
  let usageSampleCount = 0;
  let totalEstimatedCostUsd = 0;
  let acceptedEstimatedCostUsd = 0;
  let acceptedRunsWithCostData = 0;
  let acceptedRunsWithCompleteCostCoverage = 0;
  const unknownPricingModels = new Set<string>();

  for (const artifact of artifacts) {
    const diagnostics = artifact.compilerDiagnostics;
    const timings = extractTimings(artifact);
    const usageSamples = collectUsageSamples(artifact);
    const totalTokens = deriveTotalTokens(artifact, usageSamples);
    const hardFail = !isAcceptedRun(artifact);

    repairAttemptsTotal += diagnostics?.repairAttempts || 0;
    warningCountTotal += diagnostics?.warningCount || 0;
    errorCountTotal += diagnostics?.errorCount || 0;

    for (const code of diagnostics?.topRootCauseCodes || []) {
      rootCauseCounts.set(code, (rootCauseCounts.get(code) || 0) + 1);
    }

    const workflowEntry = workflowCounts.get(artifact.workflow) || { count: 0, acceptedRuns: 0, hardFails: 0 };
    workflowEntry.count += 1;
    workflowEntry.acceptedRuns += isAcceptedRun(artifact) ? 1 : 0;
    workflowEntry.hardFails += hardFail ? 1 : 0;
    workflowCounts.set(artifact.workflow, workflowEntry);

    const routeEntry = routeCounts.get(artifact.routeKey) || { count: 0, acceptedRuns: 0, hardFails: 0 };
    routeEntry.count += 1;
    routeEntry.acceptedRuns += isAcceptedRun(artifact) ? 1 : 0;
    routeEntry.hardFails += hardFail ? 1 : 0;
    routeCounts.set(artifact.routeKey, routeEntry);

    Object.entries(timings).forEach(([stageKey, value]) => {
      if (!Number.isFinite(value)) return;
      const bucket = timingBuckets.get(stageKey) || [];
      bucket.push(value);
      timingBuckets.set(stageKey, bucket);
    });

    if (typeof totalTokens === "number" && totalTokens > 0) {
      tokenValues.push(totalTokens);
      if (isAcceptedRun(artifact)) {
        acceptedTokenValues.push(totalTokens);
      }
    }

    usageSampleCount += usageSamples.length;
    let runEstimatedCostUsd = 0;
    let runHasCostData = false;
    let runCompleteCostCoverage = usageSamples.length > 0;

    for (const sample of usageSamples) {
      const estimatedCostUsd = estimateUsageCostUsd(sample.model, sample.usage);
      if (estimatedCostUsd === null) {
        runCompleteCostCoverage = false;
        if ((sample.usage.total_tokens || 0) > 0) {
          unknownPricingModels.add(sample.model);
        }
        continue;
      }

      pricedUsageSampleCount += 1;
      runHasCostData = true;
      runEstimatedCostUsd += estimatedCostUsd;
    }

    totalEstimatedCostUsd += runEstimatedCostUsd;
    if (isAcceptedRun(artifact) && runHasCostData) {
      acceptedEstimatedCostUsd += runEstimatedCostUsd;
      acceptedRunsWithCostData += 1;
      if (runCompleteCostCoverage) {
        acceptedRunsWithCompleteCostCoverage += 1;
      }
    }
  }

  const newestTimestamp = artifacts[0]?.timestamp;
  const oldestTimestamp = artifacts[artifacts.length - 1]?.timestamp;

  const summary: CompilerRunMetricsSummary = {
    window: {
      reportDir: loaded.reportDir,
      workflow: options.workflow,
      routeKey: options.routeKey,
      days: options.days,
      limit: options.limit,
      includeLatest: options.includeLatest === true,
      totalArtifactsScanned: loaded.totalArtifactsScanned,
      totalArtifactsIncluded: artifacts.length,
      parseErrorCount: loaded.parseErrorCount,
      newestTimestamp,
      oldestTimestamp,
    },
    counts,
    rates: {
      acceptanceRate: ratio(counts.acceptedRuns, counts.totalRuns),
      firstPassPassRate: ratio(artifacts.filter(isFirstPassAccepted).length, counts.totalRuns),
      reviewerRepairRate: ratio(artifacts.filter(hasReviewerRepair).length, counts.totalRuns),
      semanticBlockRate: ratio(artifacts.filter(isSemanticBlocked).length, counts.totalRuns),
      hardFailRate: ratio(
        counts.failedQualityRuns + counts.failedRuntimeRuns + counts.cancelledRuns,
        counts.totalRuns
      ),
      sameFamilyVerifierFallbackRate: ratio(
        artifacts.filter(artifact => !!artifact.compilerDiagnostics?.semanticVerifierSameFamilyFallback).length,
        counts.totalRuns
      ),
    },
    quality: {
      averageRepairAttempts: counts.totalRuns > 0 ? roundMetric(repairAttemptsTotal / counts.totalRuns) : 0,
      averageWarningCount: counts.totalRuns > 0 ? roundMetric(warningCountTotal / counts.totalRuns) : 0,
      averageErrorCount: counts.totalRuns > 0 ? roundMetric(errorCountTotal / counts.totalRuns) : 0,
      topRootCauses: Array.from(rootCauseCounts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 10)
        .map(([code, count]) => ({ code, count })),
    },
    latency: {
      stages: Object.fromEntries(
        Array.from(timingBuckets.entries())
          .sort((left, right) => left[0].localeCompare(right[0]))
          .map(([stageKey, values]) => [stageKey, summarizeNumeric(values)])
      ),
    },
    tokens: {
      runsWithTokenData: tokenValues.length,
      totalTokens: tokenValues.reduce((sum, value) => sum + value, 0),
      averageTotalTokens: summarizeNumeric(tokenValues).avg,
      p95TotalTokens: summarizeNumeric(tokenValues).p95,
      averageAcceptedRunTokens: summarizeNumeric(acceptedTokenValues).avg,
    },
    costEstimate: {
      totalEstimatedCostUsd: roundMetric(totalEstimatedCostUsd),
      acceptedEstimatedCostUsd: roundMetric(acceptedEstimatedCostUsd),
      averageEstimatedCostUsdPerAcceptedRun: counts.acceptedRuns > 0
        ? roundMetric(acceptedEstimatedCostUsd / counts.acceptedRuns)
        : 0,
      acceptedRunsWithCostData,
      acceptedRunsWithCompleteCostCoverage,
      acceptedRunCoverageRate: ratio(acceptedRunsWithCompleteCostCoverage, acceptedRuns.length),
      pricedUsageSampleCount,
      usageSampleCount,
      unknownPricingModels: Array.from(unknownPricingModels).sort((left, right) => left.localeCompare(right)),
    },
    alerts: [],
    healthState: "healthy",
    workflows: Array.from(workflowCounts.entries())
      .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
      .map(([workflow, value]) => ({ workflow, ...value })),
    routes: Array.from(routeCounts.entries())
      .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
      .map(([routeKey, value]) => ({ routeKey, ...value })),
    recentRuns: artifacts.slice(0, 10).map(artifact => {
      const timings = extractTimings(artifact);
      const usageSamples = collectUsageSamples(artifact);
      return {
        timestamp: artifact.timestamp,
        workflow: artifact.workflow,
        routeKey: artifact.routeKey,
        qualityStatus: artifact.qualityStatus,
        failureStage: artifact.compilerDiagnostics?.failureStage,
        repairAttempts: artifact.compilerDiagnostics?.repairAttempts || 0,
        semanticVerifierVerdict: artifact.compilerDiagnostics?.semanticVerifierVerdict,
        totalTokens: deriveTotalTokens(artifact, usageSamples),
        totalDurationMs: timings.totalDurationMs,
      };
    }),
  };

  const alerts = buildCompilerRunAlerts(summary);
  return {
    ...summary,
    alerts,
    healthState: alerts.some(alert => alert.severity === "critical")
      ? "critical"
      : alerts.length > 0
        ? "warning"
        : "healthy",
  };
}

export function hasKnownPricingForModel(modelId: string): boolean {
  return !!getFallbackModelPricing(modelId);
}

function buildCompilerRunAlerts(summary: CompilerRunMetricsSummary): CompilerRunMetricsAlert[] {
  const alerts: CompilerRunMetricsAlert[] = [];
  const totalRuns = summary.counts.totalRuns;
  const acceptedRuns = summary.counts.acceptedRuns;
  const totalLatencyP95 = summary.latency.stages.totalDurationMs?.p95 || 0;
  const routeLatencyP95 = summary.latency.stages.routeDurationMs?.p95 || 0;

  if (totalRuns >= 4 && summary.rates.acceptanceRate < 0.8) {
    alerts.push({
      code: "low_acceptance_rate",
      severity: summary.rates.acceptanceRate < 0.65 ? "critical" : "warning",
      title: "Compiler acceptance rate is below target",
      message: `Only ${percentage(summary.rates.acceptanceRate)} of recent runs were accepted.`,
      recommendation: "Inspect recent hard fails and semantic blocks first; stabilize the highest-volume root cause before changing prompts.",
      metricValue: summary.rates.acceptanceRate,
      threshold: 0.8,
    });
  }

  if (totalRuns >= 4 && summary.rates.semanticBlockRate >= 0.1) {
    alerts.push({
      code: "semantic_block_rate_high",
      severity: summary.rates.semanticBlockRate >= 0.2 ? "critical" : "warning",
      title: "Semantic verifier is blocking too many runs",
      message: `${percentage(summary.rates.semanticBlockRate)} of recent runs failed at semantic verification.`,
      recommendation: "Review the top semantic blocker and add or tighten deterministic semantic lints before increasing iteration count.",
      metricValue: summary.rates.semanticBlockRate,
      threshold: 0.1,
    });
  }

  if (totalRuns >= 4 && summary.rates.reviewerRepairRate >= 0.45) {
    alerts.push({
      code: "reviewer_repair_rate_high",
      severity: summary.rates.reviewerRepairRate >= 0.7 ? "critical" : "warning",
      title: "Too many runs require reviewer repair",
      message: `${percentage(summary.rates.reviewerRepairRate)} of runs needed a reviewer repair or targeted refinement.`,
      recommendation: "Improve first-pass generator adherence for the most common failing sections instead of broadening rewrite passes.",
      metricValue: summary.rates.reviewerRepairRate,
      threshold: 0.45,
    });
  }

  if (totalRuns >= 4 && summary.rates.sameFamilyVerifierFallbackRate > 0) {
    alerts.push({
      code: "verifier_independence_fallback_used",
      severity: summary.rates.sameFamilyVerifierFallbackRate >= 0.1 ? "critical" : "warning",
      title: "Verifier independence fallback was used",
      message: `${percentage(summary.rates.sameFamilyVerifierFallbackRate)} of runs needed a same-family verifier fallback.`,
      recommendation: "Broaden the verifier candidate pool per tier so the semantic verifier stays independent from generator and reviewer families.",
      metricValue: summary.rates.sameFamilyVerifierFallbackRate,
      threshold: 0,
    });
  }

  if (acceptedRuns >= 3 && summary.costEstimate.acceptedRunCoverageRate < 0.75) {
    alerts.push({
      code: "cost_coverage_low",
      severity: summary.costEstimate.acceptedRunCoverageRate < 0.5 ? "critical" : "warning",
      title: "Estimated cost coverage is incomplete",
      message: `Only ${percentage(summary.costEstimate.acceptedRunCoverageRate)} of accepted runs have complete pricing coverage.`,
      recommendation: "Add fallback pricing for unknown models so cost per accepted PRD remains measurable across all workflows.",
      metricValue: summary.costEstimate.acceptedRunCoverageRate,
      threshold: 0.75,
    });
  }

  if (acceptedRuns >= 3 && summary.costEstimate.averageEstimatedCostUsdPerAcceptedRun > 0.02) {
    alerts.push({
      code: "accepted_run_cost_high",
      severity: summary.costEstimate.averageEstimatedCostUsdPerAcceptedRun > 0.05 ? "critical" : "warning",
      title: "Average accepted-run cost is above budget",
      message: `Accepted runs currently average ${formatUsd(summary.costEstimate.averageEstimatedCostUsdPerAcceptedRun)} per PRD.`,
      recommendation: "Check whether reviewer or verifier models can stay stronger while the generator is moved to a cheaper tier default.",
      metricValue: summary.costEstimate.averageEstimatedCostUsdPerAcceptedRun,
      threshold: 0.02,
    });
  }

  if (totalRuns >= 4 && totalLatencyP95 >= 90_000) {
    alerts.push({
      code: "generation_latency_high",
      severity: totalLatencyP95 >= 180_000 ? "critical" : "warning",
      title: "End-to-end PRD latency is too high",
      message: `P95 total runtime is ${Math.round(totalLatencyP95 / 1000)}s.`,
      recommendation: "Use the stage timing breakdown to identify whether generation, reviewer repair, or compiler finalization is dominating runtime.",
      metricValue: totalLatencyP95,
      threshold: 90_000,
    });
  }

  if (totalRuns >= 4 && routeLatencyP95 >= 90_000) {
    alerts.push({
      code: "route_latency_high",
      severity: routeLatencyP95 >= 180_000 ? "critical" : "warning",
      title: "HTTP route latency is approaching timeout risk",
      message: `P95 route duration is ${Math.round(routeLatencyP95 / 1000)}s.`,
      recommendation: "Cross-check route p95 against workflow timings; long route overhead usually indicates SSE timeout pressure or excessive post-processing.",
      metricValue: routeLatencyP95,
      threshold: 90_000,
    });
  }

  return alerts.sort((left, right) => {
    const severityRank = left.severity === right.severity
      ? 0
      : left.severity === "critical"
        ? -1
        : 1;
    if (severityRank !== 0) return severityRank;
    return left.code.localeCompare(right.code);
  });
}
