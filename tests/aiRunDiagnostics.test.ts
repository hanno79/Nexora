import { describe, expect, it } from "vitest";
import {
  extractAiRunFinalContent,
  extractAiRunRecord,
  extractLatestCompilerRunRecord,
  hasUsableAiRunContent,
  isFailedQualityRun,
} from "@/lib/aiRunDiagnostics";

describe("aiRunDiagnostics", () => {
  it("extracts the latest compiler-run marker from the iteration log", () => {
    const iterationLog = [
      "# Iteration Protocol",
      '<!-- compiler-run:{"qualityStatus":"failed_quality","finalizationStage":"final","failureStage":"semantic_verifier","primaryGateReason":"Semantic verifier blocked finalization: Feature F-01 contradicts the global business rules.","semanticBlockingCodes":["cross_section_inconsistency"],"semanticBlockingIssues":[{"code":"cross_section_inconsistency","sectionKey":"feature:F-01","message":"Feature F-01 contradicts the global business rules."}],"initialSemanticBlockingIssues":[{"code":"cross_section_inconsistency","sectionKey":"feature:F-01","message":"Feature F-01 contradicts the global business rules."}],"postRepairSemanticBlockingIssues":[{"code":"schema_field_mismatch","sectionKey":"domainModel","message":"Domain Model still lacks cooldown."}],"finalSemanticBlockingIssues":[{"code":"schema_field_mismatch","sectionKey":"domainModel","message":"Domain Model still lacks cooldown."}],"repairGapReason":"emergent_issue_after_repair","repairCycleCount":2,"reviewerModelIds":["anthropic/claude-sonnet-4"],"verifierModelIds":["mistralai/mistral-small-3.1-24b-instruct"],"at":"2026-03-08T12:34:56.000Z"} -->',
    ].join("\n\n");

    const record = extractLatestCompilerRunRecord(iterationLog);

    expect(record).toMatchObject({
      qualityStatus: "failed_quality",
      finalizationStage: "final",
      compilerDiagnostics: {
        failureStage: "semantic_verifier",
        primaryGateReason: "Semantic verifier blocked finalization: Feature F-01 contradicts the global business rules.",
        semanticBlockingCodes: ["cross_section_inconsistency"],
        semanticBlockingIssues: [
          {
            code: "cross_section_inconsistency",
            sectionKey: "feature:F-01",
            message: "Feature F-01 contradicts the global business rules.",
          },
        ],
        postRepairSemanticBlockingIssues: [
          {
            code: "schema_field_mismatch",
            sectionKey: "domainModel",
            message: "Domain Model still lacks cooldown.",
          },
        ],
        finalSemanticBlockingIssues: [
          {
            code: "schema_field_mismatch",
            sectionKey: "domainModel",
            message: "Domain Model still lacks cooldown.",
          },
        ],
        repairGapReason: "emergent_issue_after_repair",
        repairCycleCount: 2,
        reviewerModelIds: ["anthropic/claude-sonnet-4"],
        verifierModelIds: ["mistralai/mistral-small-3.1-24b-instruct"],
      },
    });
  });

  it("builds an AI run record from direct response diagnostics", () => {
    const record = extractAiRunRecord({
      qualityStatus: "failed_quality",
      message: "Compiler quality gate failed after final verification.",
      finalContent: "Draft content",
      compilerDiagnostics: {
        earlyDriftDetected: true,
        earlyDriftCodes: ["feature_scope_drift_detected"],
        earlyDriftSections: ["feature:F-01"],
        blockedAddedFeatures: ["F-09: Competitive Matchmaking"],
        earlyRepairAttempted: true,
        earlyRepairApplied: false,
        primaryEarlyDriftReason: "Early improve-mode drift detected: feature scope drift detected. Affected sections: feature:F-01.",
        failureStage: "content_review",
        topRootCauseCodes: ["compiler_fallback_filler"],
        primaryGateReason: "Quality gate failed in content_review: compiler fallback filler.",
        semanticBlockingIssues: [
          {
            code: "cross_section_inconsistency",
            sectionKey: "definitionOfDone",
            message: "Definition of Done contradicts the deployment section.",
          },
        ],
        initialSemanticBlockingIssues: [
          {
            code: "cross_section_inconsistency",
            sectionKey: "definitionOfDone",
            message: "Definition of Done contradicts the deployment section.",
          },
        ],
        postRepairSemanticBlockingIssues: [
          {
            code: "schema_field_mismatch",
            sectionKey: "domainModel",
            message: "Domain Model still lacks cooldown.",
          },
        ],
        finalSemanticBlockingIssues: [
          {
            code: "schema_field_mismatch",
            sectionKey: "domainModel",
            message: "Domain Model still lacks cooldown.",
          },
        ],
        semanticRepairAttempted: true,
        semanticRepairIssueCodes: ["cross_section_inconsistency"],
        semanticRepairSectionKeys: ["definitionOfDone"],
        semanticRepairTruncated: true,
        repairGapReason: "emergent_issue_after_repair",
        repairCycleCount: 2,
        earlySemanticLintCodes: ["rule_schema_property_coverage_missing"],
        lastModelAttempt: {
          model: "mock/reviewer:free",
          phase: "semantic_repair",
          status: "failed",
          finishReason: "length",
        },
      },
    });

    expect(record).toMatchObject({
      qualityStatus: "failed_quality",
      message: "Compiler quality gate failed after final verification.",
      finalContent: "Draft content",
      compilerDiagnostics: {
        earlyDriftDetected: true,
        earlyDriftCodes: ["feature_scope_drift_detected"],
        earlyDriftSections: ["feature:F-01"],
        blockedAddedFeatures: ["F-09: Competitive Matchmaking"],
        earlyRepairAttempted: true,
        earlyRepairApplied: false,
        primaryEarlyDriftReason: "Early improve-mode drift detected: feature scope drift detected. Affected sections: feature:F-01.",
        failureStage: "content_review",
        topRootCauseCodes: ["compiler_fallback_filler"],
        primaryGateReason: "Quality gate failed in content_review: compiler fallback filler.",
        semanticBlockingIssues: [
          {
            code: "cross_section_inconsistency",
            sectionKey: "definitionOfDone",
            message: "Definition of Done contradicts the deployment section.",
          },
        ],
        postRepairSemanticBlockingIssues: [
          {
            code: "schema_field_mismatch",
            sectionKey: "domainModel",
            message: "Domain Model still lacks cooldown.",
          },
        ],
        finalSemanticBlockingIssues: [
          {
            code: "schema_field_mismatch",
            sectionKey: "domainModel",
            message: "Domain Model still lacks cooldown.",
          },
        ],
        semanticRepairAttempted: true,
        semanticRepairIssueCodes: ["cross_section_inconsistency"],
        semanticRepairSectionKeys: ["definitionOfDone"],
        semanticRepairTruncated: true,
        repairGapReason: "emergent_issue_after_repair",
        repairCycleCount: 2,
        earlySemanticLintCodes: ["rule_schema_property_coverage_missing"],
        lastModelAttempt: {
          finishReason: "length",
        },
      },
    });
  });

  it("falls back to compiler-run markers when the response has no direct diagnostics", () => {
    const record = extractAiRunRecord({
      iterationLog: '<!-- compiler-run:{"qualityStatus":"failed_quality","finalizationStage":"final","topRootCauseCodes":["feature_scope_drift_detected"],"qualityIssueCodes":["feature_scope_drift_detected"]} -->',
    });

    expect(record.qualityStatus).toBe("failed_quality");
    expect(record.compilerDiagnostics?.topRootCauseCodes).toEqual(["feature_scope_drift_detected"]);
    expect(record.compilerDiagnostics?.qualityIssueCodes).toEqual(["feature_scope_drift_detected"]);
  });

  it("detects usable degraded content and failed-quality runs", () => {
    const response = {
      qualityStatus: "failed_quality",
      mergedPRD: "Recovered draft",
    };

    expect(isFailedQualityRun(response)).toBe(true);
    expect(hasUsableAiRunContent(response)).toBe(true);
    expect(extractAiRunFinalContent(response)).toBe("Recovered draft");
  });
});
