import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { persistCompilerRunArtifact } from "../server/compilerRunArtifactPersistence";
import { getCompilerRunMetrics } from "../server/compilerRunMetrics";
import type { CompilerRunDiagnostics } from "../server/prdRunQuality";

const tempDirs: string[] = [];

function buildDiagnostics(overrides: Partial<CompilerRunDiagnostics> = {}): CompilerRunDiagnostics {
  return {
    structuredFeatureCount: 0,
    totalFeatureCount: 0,
    jsonSectionUpdates: 0,
    markdownSectionRegens: 0,
    fullRegenerations: 0,
    featurePreservations: 0,
    featureIntegrityRestores: 0,
    driftEvents: 0,
    errorCount: 0,
    warningCount: 0,
    repairAttempts: 0,
    topRootCauseCodes: [],
    qualityIssueCodes: [],
    ...overrides,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("compiler run metrics", () => {
  it("aggregates pass, repair, semantic block, latency, token, and cost metrics from persisted artifacts", async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexora-compiler-metrics-"));
    tempDirs.push(baseDir);

    await persistCompilerRunArtifact({
      baseDir,
      workflow: "guided",
      routeKey: "guided-finalize",
      qualityStatus: "passed",
      finalizationStage: "final",
      finalContent: "Guided PRD",
      compiledContent: "Guided PRD",
      compiledStructure: { features: [], otherSections: {}, systemVision: "Guided PRD" },
      quality: { valid: true, truncatedLikely: false, missingSections: [], featureCount: 0, issues: [] },
      compilerDiagnostics: buildDiagnostics({
        warningCount: 1,
      }),
      modelsUsed: ["google/gemini-2.5-flash"],
      stageData: {
        totalTokens: 1000,
        timings: {
          totalDurationMs: 1200,
          generationDurationMs: 400,
        },
        generationStage: {
          model: "google/gemini-2.5-flash",
          usage: {
            prompt_tokens: 400,
            completion_tokens: 600,
            total_tokens: 1000,
          },
        },
      },
    });

    await persistCompilerRunArtifact({
      baseDir,
      workflow: "dual",
      routeKey: "dual-generate",
      qualityStatus: "passed",
      finalizationStage: "final",
      finalContent: "Dual PRD",
      compiledContent: "Dual PRD",
      compiledStructure: { features: [], otherSections: {}, systemVision: "Dual PRD" },
      quality: { valid: true, truncatedLikely: false, missingSections: [], featureCount: 0, issues: [] },
      compilerDiagnostics: buildDiagnostics({
        warningCount: 2,
        repairAttempts: 1,
        contentRefined: true,
        topRootCauseCodes: ["boilerplate_repetition_detected"],
        qualityIssueCodes: ["boilerplate_repetition_detected"],
        semanticVerifierVerdict: "pass",
      }),
      modelsUsed: [
        "openai/gpt-4o-mini",
        "anthropic/claude-haiku-4",
        "google/gemini-2.5-flash",
      ],
      stageData: {
        totalTokens: 2000,
        timings: {
          totalDurationMs: 2400,
          reviewerDurationMs: 300,
          compilerFinalizationDurationMs: 500,
        },
        generatorResponse: {
          model: "openai/gpt-4o-mini",
          usage: {
            prompt_tokens: 800,
            completion_tokens: 700,
            total_tokens: 1500,
          },
        },
        reviewerResponse: {
          model: "anthropic/claude-haiku-4",
          usage: {
            prompt_tokens: 200,
            completion_tokens: 200,
            total_tokens: 400,
          },
        },
        compilerArtifact: {
          repairAttempts: [
            {
              model: "google/gemini-2.5-flash",
              usage: {
                prompt_tokens: 50,
                completion_tokens: 50,
                total_tokens: 100,
              },
            },
          ],
          reviewerAttempts: [],
          semanticVerificationHistory: [],
        },
      },
    });

    await persistCompilerRunArtifact({
      baseDir,
      workflow: "guided",
      routeKey: "guided-finalize-stream",
      qualityStatus: "failed_quality",
      finalizationStage: "final",
      finalContent: "",
      compilerDiagnostics: buildDiagnostics({
        errorCount: 1,
        repairAttempts: 2,
        topRootCauseCodes: ["semantic_verifier_blocked"],
        qualityIssueCodes: ["semantic_verifier_blocked"],
        failureStage: "semantic_verifier",
        semanticVerifierVerdict: "fail",
        semanticBlockingCodes: ["schema_field_reference_mismatch"],
        semanticRepairApplied: true,
        semanticVerifierSameFamilyFallback: true,
      }),
      modelsUsed: ["unknown/model"],
      stageData: {
        totalTokens: 1500,
        timings: {
          totalDurationMs: 1800,
          compilerFinalizationDurationMs: 700,
        },
        generatorResponse: {
          model: "unknown/model",
          usage: {
            prompt_tokens: 300,
            completion_tokens: 400,
            total_tokens: 700,
          },
        },
        compilerArtifact: {
          repairAttempts: [],
          reviewerAttempts: [],
          semanticVerificationHistory: [
            {
              model: "unknown/verifier",
              usage: {
                prompt_tokens: 50,
                completion_tokens: 50,
                total_tokens: 100,
              },
            },
          ],
        },
      },
    });

    await persistCompilerRunArtifact({
      baseDir,
      workflow: "iterative",
      routeKey: "iterative-generate",
      qualityStatus: "failed_runtime",
      finalizationStage: "final",
      finalContent: "",
      compilerDiagnostics: buildDiagnostics({
        errorCount: 1,
        topRootCauseCodes: ["service_timeout"],
        qualityIssueCodes: ["service_timeout"],
      }),
      modelsUsed: [],
      stageData: {
        timings: {
          totalDurationMs: 900,
          routeDurationMs: 950,
        },
      },
    });

    const reportDir = path.join(baseDir, "documentation", "compiler_runs");
    fs.writeFileSync(path.join(reportDir, "broken.json"), "{not-valid-json", "utf8");

    const metrics = await getCompilerRunMetrics({ baseDir });

    expect(metrics.counts).toEqual({
      totalRuns: 4,
      passedRuns: 2,
      degradedRuns: 0,
      failedQualityRuns: 1,
      failedRuntimeRuns: 1,
      cancelledRuns: 0,
      acceptedRuns: 2,
    });

    expect(metrics.rates.acceptanceRate).toBe(0.5);
    expect(metrics.rates.firstPassPassRate).toBe(0.25);
    expect(metrics.rates.reviewerRepairRate).toBe(0.5);
    expect(metrics.rates.semanticBlockRate).toBe(0.25);
    expect(metrics.rates.hardFailRate).toBe(0.5);
    expect(metrics.rates.sameFamilyVerifierFallbackRate).toBe(0.25);

    expect(metrics.quality.averageRepairAttempts).toBe(0.75);
    expect(metrics.quality.averageWarningCount).toBe(0.75);
    expect(metrics.quality.averageErrorCount).toBe(0.5);
    expect(metrics.quality.topRootCauses).toEqual(expect.arrayContaining([
      { code: "boilerplate_repetition_detected", count: 1 },
      { code: "semantic_verifier_blocked", count: 1 },
      { code: "service_timeout", count: 1 },
    ]));

    expect(metrics.latency.stages.totalDurationMs).toEqual({
      count: 4,
      avg: 1575,
      p95: 2400,
      min: 900,
      max: 2400,
    });
    expect(metrics.latency.stages.compilerFinalizationDurationMs).toEqual({
      count: 2,
      avg: 600,
      p95: 700,
      min: 500,
      max: 700,
    });

    expect(metrics.tokens).toEqual({
      runsWithTokenData: 3,
      totalTokens: 4500,
      averageTotalTokens: 1500,
      p95TotalTokens: 2000,
      averageAcceptedRunTokens: 1500,
    });

    expect(metrics.costEstimate.totalEstimatedCostUsd).toBe(0.002);
    expect(metrics.costEstimate.acceptedEstimatedCostUsd).toBe(0.002);
    expect(metrics.costEstimate.averageEstimatedCostUsdPerAcceptedRun).toBe(0.001);
    expect(metrics.costEstimate.acceptedRunsWithCostData).toBe(2);
    expect(metrics.costEstimate.acceptedRunsWithCompleteCostCoverage).toBe(2);
    expect(metrics.costEstimate.acceptedRunCoverageRate).toBe(1);
    expect(metrics.costEstimate.pricedUsageSampleCount).toBe(4);
    expect(metrics.costEstimate.usageSampleCount).toBe(6);
    expect(metrics.costEstimate.unknownPricingModels).toEqual(["unknown/model", "unknown/verifier"]);
    expect(metrics.healthState).toBe("critical");
    expect(metrics.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "low_acceptance_rate",
        severity: "critical",
      }),
      expect.objectContaining({
        code: "reviewer_repair_rate_high",
        severity: "warning",
      }),
      expect.objectContaining({
        code: "semantic_block_rate_high",
        severity: "critical",
      }),
      expect.objectContaining({
        code: "verifier_independence_fallback_used",
        severity: "critical",
      }),
    ]));

    expect(metrics.workflows).toEqual(expect.arrayContaining([
      { workflow: "guided", count: 2, acceptedRuns: 1, hardFails: 1 },
      { workflow: "dual", count: 1, acceptedRuns: 1, hardFails: 0 },
      { workflow: "iterative", count: 1, acceptedRuns: 0, hardFails: 1 },
    ]));
    expect(metrics.routes).toEqual(expect.arrayContaining([
      { routeKey: "guided-finalize", count: 1, acceptedRuns: 1, hardFails: 0 },
      { routeKey: "dual-generate", count: 1, acceptedRuns: 1, hardFails: 0 },
    ]));
    expect(metrics.recentRuns).toHaveLength(4);
    expect(metrics.window.parseErrorCount).toBe(1);
    expect(metrics.window.totalArtifactsIncluded).toBe(4);
  });

  it("supports workflow and limit filters without counting unrelated artifacts", async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexora-compiler-metrics-filter-"));
    tempDirs.push(baseDir);

    await persistCompilerRunArtifact({
      baseDir,
      workflow: "guided",
      routeKey: "guided-finalize",
      qualityStatus: "passed",
      finalizationStage: "final",
      finalContent: "Guided A",
      compilerDiagnostics: buildDiagnostics(),
      stageData: {
        totalTokens: 900,
        timings: { totalDurationMs: 1100 },
      },
    });

    await persistCompilerRunArtifact({
      baseDir,
      workflow: "guided",
      routeKey: "guided-skip",
      qualityStatus: "failed_quality",
      finalizationStage: "final",
      finalContent: "",
      compilerDiagnostics: buildDiagnostics({
        errorCount: 1,
        topRootCauseCodes: ["semantic_verifier_blocked"],
        qualityIssueCodes: ["semantic_verifier_blocked"],
      }),
      stageData: {
        totalTokens: 1200,
        timings: { totalDurationMs: 1500 },
      },
    });

    await persistCompilerRunArtifact({
      baseDir,
      workflow: "dual",
      routeKey: "dual-generate",
      qualityStatus: "passed",
      finalizationStage: "final",
      finalContent: "Dual A",
      compilerDiagnostics: buildDiagnostics(),
      stageData: {
        totalTokens: 1300,
        timings: { totalDurationMs: 1700 },
      },
    });

    const metrics = await getCompilerRunMetrics({
      baseDir,
      workflow: "guided",
      limit: 1,
    });

    expect(metrics.window.workflow).toBe("guided");
    expect(metrics.window.limit).toBe(1);
    expect(metrics.counts.totalRuns).toBe(1);
    expect(metrics.alerts).toEqual([]);
    expect(metrics.healthState).toBe("healthy");
    expect(metrics.workflows).toEqual([{ workflow: "guided", count: 1, acceptedRuns: 0, hardFails: 1 }]);
    expect(metrics.routes).toEqual([{ routeKey: "guided-skip", count: 1, acceptedRuns: 0, hardFails: 1 }]);
  });
});
