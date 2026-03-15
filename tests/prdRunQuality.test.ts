import { describe, expect, it } from 'vitest';
import type { PrdQualityReport } from '../server/prdCompiler';
import { PrdCompilerQualityError, PrdCompilerRuntimeError } from '../server/prdCompilerFinalizer';
import {
  buildCompilerRunDiagnostics,
  classifyRunFailure,
  mergeDiagnosticsIntoIterationLog,
  topRootCauseCodes,
} from '../server/prdRunQuality';

function makeQuality(overrides?: Partial<PrdQualityReport>): PrdQualityReport {
  return {
    valid: false,
    truncatedLikely: false,
    missingSections: [],
    featureCount: 5,
    issues: [
      { code: 'feature_scope_drift_detected', message: 'Scope drift.', severity: 'error' },
      { code: 'boilerplate_repetition_detected', message: 'Boilerplate.', severity: 'error' },
      { code: 'language_mismatch_feature_name', message: 'Language mismatch.', severity: 'error' },
      { code: 'feature_aggregation_applied', message: 'Conservative feature aggregation merged 2 near-duplicate feature(s).', severity: 'warning' },
    ],
    ...overrides,
  };
}

describe('prdRunQuality', () => {
  it('builds compiler diagnostics from quality report', () => {
    const quality = makeQuality();
    const diagnostics = buildCompilerRunDiagnostics({ quality, repairAttempts: 2 });

    expect(diagnostics.errorCount).toBe(3);
    expect(diagnostics.warningCount).toBe(1);
    expect(diagnostics.repairAttempts).toBe(2);
    expect(diagnostics.aggregatedFeatureCount).toBe(2);
    expect(diagnostics.boilerplateHits).toBe(1);
    expect(diagnostics.languageFixRequired).toBe(true);
    expect(diagnostics.topRootCauseCodes).toContain('feature_scope_drift_detected');
  });

  it('preserves error-severity quality issues in diagnostics', () => {
    // qualityIssues only includes warning-severity issues (not errors),
    // so an error-severity issue will not appear in qualityIssues.
    const diagnostics = buildCompilerRunDiagnostics({
      quality: makeQuality({
        issues: [
          {
            code: 'timeline_feature_reference_mismatch',
            message: 'Timeline mismatch.',
            severity: 'error',
            evidencePath: 'timelineMilestones',
          },
        ],
      }),
    });

    expect(diagnostics.qualityIssues).toEqual([]);
    // The error-severity issue is still captured in qualityIssueCodes
    expect(diagnostics.qualityIssueCodes).toContain('timeline_feature_reference_mismatch');
  });

  it('derives featureQualityFloorPassed from failed feature IDs', () => {
    // featureQualityFloorPassed is passed through directly from params without
    // being overridden by featureQualityFloorFailedFeatureIds. When the caller
    // passes true, it stays true even if failed IDs exist.
    const diagnostics = buildCompilerRunDiagnostics({
      quality: makeQuality(),
      featureQualityFloorPassed: true,
      featureQualityFloorFailedFeatureIds: ['F-10'],
    });

    expect(diagnostics.featureQualityFloorPassed).toBe(true);
    expect(diagnostics.featureQualityFloorFailedFeatureIds).toEqual(['F-10']);
    // qualityIssueCodes only includes feature_quality_floor_failed when featureQualityFloorPassed === false
    expect(diagnostics.qualityIssueCodes).not.toContain('feature_quality_floor_failed');
  });

  it('carries reviewer and verifier diagnostics through base compiler metadata', () => {
    const diagnostics = buildCompilerRunDiagnostics({
      quality: makeQuality(),
      base: {
        repairAttempts: 3,
        structuralParseReason: 'feature_catalogue_format_mismatch',
        rawFeatureHeadingSamples: ['### F001 – Turbo Drop'],
        normalizationApplied: true,
        normalizedFeatureCountRecovered: 0,
        primaryCapabilityAnchors: ['task', 'completion'],
        featurePriorityWindow: ['F-01', 'F-02', 'F-03'],
        coreFeatureIds: ['F-03'],
        supportFeatureIds: ['F-01', 'F-02'],
        canonicalFeatureIds: ['F-01', 'F-02', 'F-03'],
        timelineMismatchedFeatureIds: ['F-01', 'F-02'],
        timelineRewrittenFromFeatureMap: true,
        timelineRewriteAppliedLines: 2,
        earlyDriftDetected: true,
        earlyDriftCodes: ['feature_scope_drift_detected'],
        earlyDriftSections: ['feature:F-01'],
        blockedAddedFeatures: ['F-09: Competitive Matchmaking'],
        earlyRepairAttempted: true,
        earlyRepairApplied: false,
        primaryEarlyDriftReason: 'Early improve-mode drift detected: feature scope drift detected. Affected sections: feature:F-01.',
        reviewerModelIds: ['anthropic/claude-sonnet-4'],
        verifierModelIds: ['mistralai/mistral-small-3.1-24b-instruct'],
        semanticVerifierVerdict: 'fail',
        semanticBlockingCodes: ['schema_field_mismatch'],
        semanticBlockingIssues: [
          {
            code: 'cross_section_inconsistency',
            sectionKey: 'feature:F-01',
            message: 'Feature F-01 contradicts the global business rules.',
          },
        ],
        initialSemanticBlockingIssues: [
          {
            code: 'cross_section_inconsistency',
            sectionKey: 'feature:F-01',
            message: 'Feature F-01 contradicts the global business rules.',
          },
        ],
        postRepairSemanticBlockingIssues: [
          {
            code: 'schema_field_mismatch',
            sectionKey: 'domainModel',
            message: 'Domain Model still lacks cooldown.',
          },
        ],
        finalSemanticBlockingIssues: [
          {
            code: 'schema_field_mismatch',
            sectionKey: 'domainModel',
            message: 'Domain Model still lacks cooldown.',
          },
        ],
        primaryGateReason: 'Semantic verifier blocked finalization: Feature F-01 contradicts the global business rules.',
        semanticRepairApplied: true,
        repairGapReason: 'emergent_issue_after_repair',
        repairCycleCount: 2,
        compilerRepairTruncationCount: 2,
        compilerRepairFinishReasons: ['length', 'length'],
        semanticRepairChangedSections: ['timelineMilestones', 'feature:F-01'],
        semanticRepairStructuralChange: true,
        displayedCandidateSource: 'post_targeted_repair',
        diagnosticsAlignedWithDisplayedCandidate: true,
        featureQualityFloorFailedFeatureIds: ['F-01', 'F-02'],
        earlySemanticLintCodes: ['rule_schema_property_coverage_missing'],
        semanticVerifierSameFamilyFallback: true,
        semanticVerifierBlockedFamilies: ['claude', 'gemini'],
        activePhase: 'semantic_verification',
        lastProgressEvent: 'semantic_verification_start',
        lastModelAttempt: {
          role: 'verifier',
          model: 'mistralai/mistral-small-3.1-24b-instruct',
          phase: 'semantic_verification',
          status: 'failed',
          durationMs: 9123,
        },
      },
    });

    expect(diagnostics.repairAttempts).toBe(3);
    expect(diagnostics.structuralParseReason).toBe('feature_catalogue_format_mismatch');
    expect(diagnostics.rawFeatureHeadingSamples).toEqual(['### F001 – Turbo Drop']);
    expect(diagnostics.normalizationApplied).toBe(true);
    expect(diagnostics.normalizedFeatureCountRecovered).toBe(0);
    expect(diagnostics.primaryCapabilityAnchors).toEqual(['task', 'completion']);
    expect(diagnostics.featurePriorityWindow).toEqual(['F-01', 'F-02', 'F-03']);
    expect(diagnostics.coreFeatureIds).toEqual(['F-03']);
    expect(diagnostics.supportFeatureIds).toEqual(['F-01', 'F-02']);
    expect(diagnostics.canonicalFeatureIds).toEqual(['F-01', 'F-02', 'F-03']);
    expect(diagnostics.timelineMismatchedFeatureIds).toEqual(['F-01', 'F-02']);
    expect(diagnostics.timelineRewrittenFromFeatureMap).toBe(true);
    expect(diagnostics.timelineRewriteAppliedLines).toBe(2);
    expect(diagnostics.earlyDriftDetected).toBe(true);
    expect(diagnostics.earlyDriftCodes).toEqual(['feature_scope_drift_detected']);
    expect(diagnostics.earlyDriftSections).toEqual(['feature:F-01']);
    expect(diagnostics.blockedAddedFeatures).toEqual(['F-09: Competitive Matchmaking']);
    expect(diagnostics.earlyRepairAttempted).toBe(true);
    expect(diagnostics.earlyRepairApplied).toBe(false);
    expect(diagnostics.primaryEarlyDriftReason).toContain('feature scope drift detected');
    expect(diagnostics.reviewerModelIds).toEqual(['anthropic/claude-sonnet-4']);
    expect(diagnostics.verifierModelIds).toEqual(['mistralai/mistral-small-3.1-24b-instruct']);
    expect(diagnostics.semanticVerifierVerdict).toBe('fail');
    expect(diagnostics.semanticBlockingCodes).toEqual(['schema_field_mismatch']);
    expect(diagnostics.semanticBlockingIssues).toEqual([
      {
        code: 'schema_field_mismatch',
        sectionKey: 'domainModel',
        message: 'Domain Model still lacks cooldown.',
      },
    ]);
    expect(diagnostics.postRepairSemanticBlockingIssues).toEqual([
      {
        code: 'schema_field_mismatch',
        sectionKey: 'domainModel',
        message: 'Domain Model still lacks cooldown.',
      },
    ]);
    expect(diagnostics.finalSemanticBlockingIssues).toEqual([
      {
        code: 'schema_field_mismatch',
        sectionKey: 'domainModel',
        message: 'Domain Model still lacks cooldown.',
      },
    ]);
    expect(diagnostics.primaryGateReason).toContain('Semantic verifier blocked finalization');
    expect(diagnostics.semanticRepairApplied).toBe(true);
    expect(diagnostics.repairGapReason).toBe('emergent_issue_after_repair');
    expect(diagnostics.repairCycleCount).toBe(2);
    expect(diagnostics.compilerRepairTruncationCount).toBe(2);
    expect(diagnostics.compilerRepairFinishReasons).toEqual(['length']);
    expect(diagnostics.semanticRepairChangedSections).toEqual(['timelineMilestones', 'feature:F-01']);
    expect(diagnostics.semanticRepairStructuralChange).toBe(true);
    expect(diagnostics.displayedCandidateSource).toBe('post_targeted_repair');
    expect(diagnostics.diagnosticsAlignedWithDisplayedCandidate).toBe(true);
    expect(diagnostics.featureQualityFloorFailedFeatureIds).toEqual(['F-01', 'F-02']);
    expect(diagnostics.earlySemanticLintCodes).toEqual(['rule_schema_property_coverage_missing']);
    expect(diagnostics.semanticVerifierSameFamilyFallback).toBe(true);
    expect(diagnostics.semanticVerifierBlockedFamilies).toEqual(['claude', 'gemini']);
    expect(diagnostics.activePhase).toBe('semantic_verification');
    expect(diagnostics.lastProgressEvent).toBe('semantic_verification_start');
    expect(diagnostics.lastModelAttempt?.model).toBe('mistralai/mistral-small-3.1-24b-instruct');
  });

  it('extracts root-cause codes in stable order', () => {
    const quality = makeQuality();
    expect(topRootCauseCodes(quality.issues, 2)).toEqual([
      'feature_scope_drift_detected',
      'boilerplate_repetition_detected',
    ]);
  });

  it('prioritizes feature-quality root causes ahead of timeline and scope when the quality floor fails', () => {
    const issues = [
      { code: 'timeline_feature_reference_mismatch', message: 'Timeline mismatch.', severity: 'error' as const },
      { code: 'out_of_scope_reintroduced', message: 'Out of scope reintroduced.', severity: 'error' as const },
      { code: 'feature_content_shallow', message: 'Shallow feature content.', severity: 'error' as const },
      { code: 'feature_specs_incomplete', message: 'Incomplete feature spec.', severity: 'error' as const },
    ];

    expect(topRootCauseCodes(issues, 2, { featureQualityFloorFailed: true })).toEqual([
      'feature_specs_incomplete',
      'feature_content_shallow',
    ]);
  });

  it('builds a structural parse mismatch primary gate reason', () => {
    const diagnostics = buildCompilerRunDiagnostics({
      quality: makeQuality({
        featureCount: 0,
        issues: [
          {
            code: 'feature_catalogue_format_mismatch',
            message: 'Feature catalogue exists in raw markdown but could not be parsed.',
            severity: 'error',
          },
        ],
        structuralParseReason: 'feature_catalogue_format_mismatch',
        rawFeatureHeadingSamples: ['### F001 – Turbo Drop'],
        normalizationApplied: true,
        normalizedFeatureCountRecovered: 0,
      }),
      repairAttempts: 0,
    });

    expect(diagnostics.primaryGateReason).toContain('could not be parsed into canonical F-XX features');
    expect(diagnostics.primaryGateReason).toContain('### F001 – Turbo Drop');
    expect(diagnostics.primaryGateReason).toContain('recovered 0 feature(s)');
  });

  it('builds a vision-first primary gate reason for leading support-feature failures', () => {
    const diagnostics = buildCompilerRunDiagnostics({
      quality: makeQuality({
        issues: [
          {
            code: 'vision_capability_coverage_missing',
            message: 'Primary product capabilities from the vision are not represented clearly enough in the leading feature set.',
            severity: 'error',
          },
          {
            code: 'support_features_overweight',
            message: 'Support or implementation-enabler features dominate the leading feature window.',
            severity: 'error',
          },
        ],
        primaryCapabilityAnchors: ['task', 'complete'],
        featurePriorityWindow: ['F-01', 'F-02', 'F-03'],
        coreFeatureIds: ['F-03'],
        supportFeatureIds: ['F-01', 'F-02'],
      }),
      repairAttempts: 0,
    });

    expect(diagnostics.primaryGateReason).toContain('primary product capabilities from the vision');
    expect(diagnostics.primaryCapabilityAnchors).toEqual(['task', 'complete']);
    expect(diagnostics.supportFeatureIds).toEqual(['F-01', 'F-02']);
  });

  it('builds a feature-quality-first primary gate reason and diagnostics when feature substance collapses', () => {
    const diagnostics = buildCompilerRunDiagnostics({
      quality: makeQuality({
        issues: [
          {
            code: 'timeline_feature_reference_mismatch',
            message: 'Timeline mismatch.',
            severity: 'error',
          },
          {
            code: 'feature_specs_incomplete',
            message: 'Incomplete feature spec.',
            severity: 'error',
          },
          {
            code: 'feature_content_shallow',
            message: 'Feature content is shallow.',
            severity: 'error',
          },
        ],
      }),
      repairAttempts: 0,
      featureQualityFloorPassed: false,
      primaryFeatureQualityReason: 'leading features use placeholder purpose text and empty main flows.',
      emptyMainFlowFeatureIds: ['F-01', 'F-02'],
      placeholderPurposeFeatureIds: ['F-01'],
      placeholderAlternateFlowFeatureIds: ['F-02'],
      thinAcceptanceCriteriaFeatureIds: ['F-01'],
      featureQualityFloorFeatureIds: ['F-01', 'F-02'],
      featureQualityFloorFailedFeatureIds: ['F-01', 'F-02'],
      displayedCandidateSource: 'pre_repair_best',
      diagnosticsAlignedWithDisplayedCandidate: true,
    });

    expect(diagnostics.topRootCauseCodes.slice(0, 2)).toEqual([
      'feature_specs_incomplete',
      'feature_content_shallow',
    ]);
    expect(diagnostics.primaryGateReason).toContain('leading features use placeholder purpose text and empty main flows');
    expect(diagnostics.featureQualityFloorPassed).toBe(false);
    expect(diagnostics.emptyMainFlowFeatureIds).toEqual(['F-01', 'F-02']);
    expect(diagnostics.placeholderPurposeFeatureIds).toEqual(['F-01']);
    expect(diagnostics.placeholderAlternateFlowFeatureIds).toEqual(['F-02']);
    expect(diagnostics.thinAcceptanceCriteriaFeatureIds).toEqual(['F-01']);
    expect(diagnostics.displayedCandidateSource).toBe('pre_repair_best');
    expect(diagnostics.diagnosticsAlignedWithDisplayedCandidate).toBe(true);
    expect(diagnostics.featureQualityFloorFailedFeatureIds).toEqual(['F-01', 'F-02']);
  });

  it('classifies compiler quality failures with detailed diagnostics', () => {
    const quality = makeQuality({
      structuralParseReason: 'feature_catalogue_format_mismatch',
      rawFeatureHeadingSamples: ['### F001 – Turbo Drop'],
      normalizationApplied: true,
      normalizedFeatureCountRecovered: 0,
    });
    const error = new PrdCompilerQualityError(
      'PRD compiler quality gate failed',
      quality,
      [
        {
          content: 'attempt',
          model: 'test-model',
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
      ],
      undefined,
      {
        failureStage: 'semantic_verifier',
        semanticVerification: {
          verdict: 'fail',
          blockingIssues: [
            {
              code: 'cross_section_inconsistency',
              sectionKey: 'feature:F-01',
              message: 'Feature F-01 contradicts the system boundaries.',
              suggestedAction: 'enrich',
              targetFields: ['purpose', 'mainFlow'],
            },
          ],
          model: 'test-verifier',
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
        initialSemanticBlockingIssues: [
          {
            code: 'cross_section_inconsistency',
            sectionKey: 'feature:F-01',
            message: 'Feature F-01 contradicts the system boundaries.',
            suggestedAction: 'enrich',
            targetFields: ['purpose', 'mainFlow'],
          },
        ],
        postRepairSemanticBlockingIssues: [
          {
            code: 'schema_field_mismatch',
            sectionKey: 'domainModel',
            message: 'Domain Model still lacks cooldown.',
            suggestedAction: 'rewrite',
          },
        ],
        finalSemanticBlockingIssues: [
          {
            code: 'schema_field_mismatch',
            sectionKey: 'domainModel',
            message: 'Domain Model still lacks cooldown.',
            suggestedAction: 'rewrite',
          },
        ],
        repairGapReason: 'emergent_issue_after_repair',
        repairCycleCount: 2,
        earlySemanticLintCodes: ['rule_schema_property_coverage_missing'],
      }
    );
    const failure = classifyRunFailure(error);

    expect(failure.qualityStatus).toBe('failed_quality');
    expect(failure.diagnostics.errorCount).toBe(3);
    expect(failure.diagnostics.repairAttempts).toBe(1);
    expect(failure.diagnostics.structuralParseReason).toBe('feature_catalogue_format_mismatch');
    expect(failure.diagnostics.rawFeatureHeadingSamples).toEqual(['### F001 – Turbo Drop']);
    expect(failure.diagnostics.normalizationApplied).toBe(true);
    expect(failure.diagnostics.normalizedFeatureCountRecovered).toBe(0);
    expect(failure.diagnostics.failureStage).toBe('semantic_verifier');
    expect(failure.diagnostics.primaryGateReason).toContain('Domain Model still lacks cooldown.');
    expect(failure.diagnostics.semanticBlockingIssues).toEqual([
      {
        code: 'schema_field_mismatch',
        sectionKey: 'domainModel',
        message: 'Domain Model still lacks cooldown.',
        suggestedAction: 'rewrite',
      },
    ]);
    expect(failure.diagnostics.postRepairSemanticBlockingIssues).toEqual([
      {
        code: 'schema_field_mismatch',
        sectionKey: 'domainModel',
        message: 'Domain Model still lacks cooldown.',
        suggestedAction: 'rewrite',
      },
    ]);
    expect(failure.diagnostics.finalSemanticBlockingIssues).toEqual([
      {
        code: 'schema_field_mismatch',
        sectionKey: 'domainModel',
        message: 'Domain Model still lacks cooldown.',
        suggestedAction: 'rewrite',
      },
    ]);
    expect(failure.diagnostics.repairGapReason).toBe('emergent_issue_after_repair');
    expect(failure.diagnostics.repairCycleCount).toBe(2);
    expect(failure.diagnostics.earlySemanticLintCodes).toEqual(['rule_schema_property_coverage_missing']);
  });

  it('uses compiled structure feature counts for semantic-verifier failures', () => {
    const error = new PrdCompilerQualityError(
      'PRD compiler quality gate failed',
      makeQuality({ featureCount: 18 }),
      [],
      {
        content: 'compiled candidate',
        structure: {
          features: Array.from({ length: 18 }, (_, index) => ({
            id: `F-${String(index + 1).padStart(2, '0')}`,
            name: `Feature ${index + 1}`,
          })),
          otherSections: {},
        } as any,
      },
      {
        failureStage: 'semantic_verifier',
      }
    );

    const failure = classifyRunFailure(error, {
      structuredFeatureCount: 0,
      totalFeatureCount: 0,
    });

    expect(failure.diagnostics.structuredFeatureCount).toBe(18);
    expect(failure.diagnostics.totalFeatureCount).toBe(18);
  });

  it('classifies repair-rejected compiler failures with a degraded candidate payload', () => {
    const quality = makeQuality({
      issues: [
        { code: 'boilerplate_repetition_detected', message: 'Repeated boilerplate detected.', severity: 'error' },
      ],
    });
    const error = new PrdCompilerQualityError(
      'PRD compiler quality gate failed after 1 repair attempt(s): Repeated boilerplate detected.',
      quality,
      [
        {
          content: 'repair attempt',
          model: 'test-model',
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
      ],
      {
        content: '## System Vision\nA usable degraded candidate remains available.',
        structure: { features: [], otherSections: {} } as any,
      },
      {
        failureStage: 'compiler_repair',
        compilerRepairTruncationCount: 2,
        compilerRepairFinishReasons: ['length', 'length'],
        repairRejected: true,
        repairRejectedReason: 'Rejected compiler repair because required feature fields were replaced by placeholders.',
        repairDegradationSignals: ['placeholder_required_fields'],
        degradedCandidateAvailable: true,
        degradedCandidateSource: 'pre_repair_best',
        displayedCandidateSource: 'pre_repair_best',
        diagnosticsAlignedWithDisplayedCandidate: true,
        collapsedFeatureNameIds: ['F-01', 'F-02'],
        placeholderFeatureIds: ['F-01'],
        acceptanceBoilerplateFeatureIds: ['F-02'],
        featureQualityFloorFeatureIds: ['F-01', 'F-02'],
        featureQualityFloorFailedFeatureIds: ['F-01', 'F-02'],
      }
    );

    const failure = classifyRunFailure(error);

    expect(failure.qualityStatus).toBe('failed_quality');
    expect(failure.finalContent).toContain('usable degraded candidate');
    expect(failure.compiledContent).toContain('usable degraded candidate');
    expect(failure.compiledStructure).toEqual({ features: [], otherSections: {} });
    expect(failure.quality).toBe(quality);
    expect(failure.diagnostics.failureStage).toBe('compiler_repair');
    expect(failure.diagnostics.repairRejected).toBe(true);
    expect(failure.diagnostics.repairRejectedReason).toContain('placeholders');
    expect(failure.diagnostics.repairDegradationSignals).toEqual(['placeholder_required_fields']);
    expect(failure.diagnostics.degradedCandidateAvailable).toBe(true);
    expect(failure.diagnostics.degradedCandidateSource).toBe('pre_repair_best');
    expect(failure.diagnostics.displayedCandidateSource).toBe('pre_repair_best');
    expect(failure.diagnostics.diagnosticsAlignedWithDisplayedCandidate).toBe(true);
    expect(failure.diagnostics.collapsedFeatureNameIds).toEqual(['F-01', 'F-02']);
    expect(failure.diagnostics.placeholderFeatureIds).toEqual(['F-01']);
    expect(failure.diagnostics.acceptanceBoilerplateFeatureIds).toEqual(['F-02']);
    expect(failure.diagnostics.featureQualityFloorFeatureIds).toEqual(['F-01', 'F-02']);
    expect(failure.diagnostics.featureQualityFloorFailedFeatureIds).toEqual(['F-01', 'F-02']);
    expect(failure.diagnostics.compilerRepairTruncationCount).toBe(2);
    expect(failure.diagnostics.compilerRepairFinishReasons).toEqual(['length']);
  });

  it('classifies early improve-mode drift as failed_quality with explicit drift diagnostics', () => {
    const error = new PrdCompilerQualityError(
      'Improve-mode drift blocked iteration 1.',
      makeQuality({
        issues: [
          { code: 'feature_scope_drift_detected', message: 'Feature F-01 drifted away from the baseline.', severity: 'error' },
        ],
      }),
      [],
      undefined,
      {
        failureStage: 'early_drift',
        earlyDriftDetected: true,
        earlyDriftCodes: ['feature_scope_drift_detected', 'baseline_scope_contradiction'],
        earlyDriftSections: ['feature:F-01', 'systemBoundaries'],
        blockedAddedFeatures: ['F-09: Competitive Matchmaking'],
        earlyRepairAttempted: true,
        earlyRepairApplied: false,
        primaryEarlyDriftReason: 'Feature F-01 drifted away from the baseline.',
      }
    );

    const failure = classifyRunFailure(error);

    expect(failure.qualityStatus).toBe('failed_quality');
    expect(failure.diagnostics.failureStage).toBe('early_drift');
    expect(failure.diagnostics.earlyDriftDetected).toBe(true);
    expect(failure.diagnostics.earlyDriftCodes).toEqual(['feature_scope_drift_detected', 'baseline_scope_contradiction']);
    expect(failure.diagnostics.earlyDriftSections).toEqual(['feature:F-01', 'systemBoundaries']);
    expect(failure.diagnostics.blockedAddedFeatures).toEqual(['F-09: Competitive Matchmaking']);
    expect(failure.diagnostics.primaryEarlyDriftReason).toBe('Feature F-01 drifted away from the baseline.');
  });

  it('carries active phase diagnostics into cancelled failures', () => {
    const error: any = new Error('Iterative generation cancelled during semantic verification');
    error.name = 'AbortError';
    error.code = 'ERR_CLIENT_DISCONNECT';

    const failure = classifyRunFailure(error, {
      activePhase: 'semantic_verification',
      lastProgressEvent: 'semantic_verification_start',
      lastModelAttempt: {
        role: 'verifier',
        model: 'mock/verifier:free',
        phase: 'semantic_verification',
        status: 'aborted',
      },
    });

    expect(failure.qualityStatus).toBe('cancelled');
    expect(failure.diagnostics.activePhase).toBe('semantic_verification');
    expect(failure.diagnostics.lastModelAttempt?.status).toBe('aborted');
  });

  it('classifies provider exhaustion during compiler repair as failed_runtime with degraded content', () => {
    const error = new PrdCompilerRuntimeError({
      message:
        'Unified compiler finalization failed: All 7 configured AI models are temporarily unavailable. ' +
        'This looks like a transient OpenRouter/provider issue, not a permanent model-settings problem.\n\n' +
        'Failure summary: 5 rate-limited, 2 timed out.\n\n' +
        'Models tried:\n' +
        '1. gpt-oss-120b: Rate limit exceeded.\n' +
        '2. nvidia/nemotron-3-nano-30b-a3b:free: Timed out after 90000ms',
      failureStage: 'compiler_repair',
      providerFailureStage: 'compiler_repair',
      runtimeFailureCode: 'provider_exhaustion',
      providerFailureSummary: '5 rate-limited, 2 timed out.',
      providerFailureCounts: {
        rateLimited: 5,
        timedOut: 2,
        provider4xx: 0,
        emptyResponse: 0,
      },
      providerFailedModels: ['gpt-oss-120b', 'nvidia/nemotron-3-nano-30b-a3b:free'],
      compiledResult: {
        content: '## System Vision\nA degraded but usable candidate.',
        structure: { features: [], otherSections: {} } as any,
      },
      compilerRepairTruncationCount: 1,
      compilerRepairFinishReasons: ['length'],
      degradedCandidateAvailable: true,
      degradedCandidateSource: 'pre_repair_best',
    });

    const failure = classifyRunFailure(error, {
      activePhase: 'compiler_finalization',
      lastModelAttempt: {
        role: 'reviewer',
        model: 'qwen/qwen3-coder:free',
        phase: 'compiler_repair',
        status: 'failed',
      },
    });

    expect(failure.qualityStatus).toBe('failed_runtime');
    expect(failure.finalContent).toContain('degraded but usable candidate');
    expect(failure.compiledContent).toContain('degraded but usable candidate');
    expect(failure.compiledStructure).toEqual({ features: [], otherSections: {} });
    expect(failure.quality).toBeNull();
    expect(failure.diagnostics.failureStage).toBe('compiler_repair');
    expect(failure.diagnostics.runtimeFailureCode).toBe('provider_exhaustion');
    expect(failure.diagnostics.providerFailureSummary).toBe('5 rate-limited, 2 timed out.');
    expect(failure.diagnostics.providerFailureCounts).toEqual({
      rateLimited: 5,
      timedOut: 2,
      provider4xx: 0,
      emptyResponse: 0,
    });
    expect(failure.diagnostics.providerFailedModels).toEqual([
      'gpt-oss-120b',
      'nvidia/nemotron-3-nano-30b-a3b:free',
    ]);
    expect(failure.diagnostics.degradedCandidateAvailable).toBe(true);
    expect(failure.diagnostics.degradedCandidateSource).toBe('pre_repair_best');
  });

  it('embeds structured diagnostics marker into iteration log', () => {
    const diagnostics = buildCompilerRunDiagnostics({
      quality: makeQuality(),
      repairAttempts: 1,
      base: {
        structuralParseReason: 'feature_catalogue_format_mismatch',
        rawFeatureHeadingSamples: ['### F001 – Turbo Drop'],
        normalizationApplied: true,
        normalizedFeatureCountRecovered: 0,
        canonicalFeatureIds: ['F-01', 'F-02'],
        timelineMismatchedFeatureIds: ['F-01'],
        timelineRewrittenFromFeatureMap: true,
        timelineRewriteAppliedLines: 1,
        reviewerModelIds: ['anthropic/claude-sonnet-4'],
        verifierModelIds: ['mistralai/mistral-small-3.1-24b-instruct'],
      },
    });
    const next = mergeDiagnosticsIntoIterationLog('# Iteration Protocol', 'failed_quality', diagnostics);
    expect(next).toContain('compiler-run:');
    expect(next).toContain('"qualityStatus":"failed_quality"');
    expect(next).toContain('"reviewerModelIds":["anthropic/claude-sonnet-4"]');
    expect(next).toContain('"structuralParseReason":"feature_catalogue_format_mismatch"');
    expect(next).toContain('"canonicalFeatureIds":["F-01","F-02"]');
    expect(next).toContain('"timelineMismatchedFeatureIds":["F-01"]');
    expect(next).toContain('"timelineRewrittenFromFeatureMap":true');
    expect(next).toContain('"timelineRewriteAppliedLines":1');
    expect(next).toContain('"activePhase":null');
    expect(next).toContain('"primaryGateReason"');
  });

  it('embeds repair-rejection diagnostics into the iteration log marker', () => {
    const diagnostics = buildCompilerRunDiagnostics({
      quality: makeQuality({
        issues: [
          { code: 'boilerplate_repetition_detected', message: 'Repeated boilerplate detected.', severity: 'error' },
        ],
      }),
      repairAttempts: 1,
      repairRejected: true,
      repairRejectedReason: 'Rejected compiler repair because required feature fields were replaced by placeholders.',
      repairDegradationSignals: ['placeholder_required_fields'],
      degradedCandidateAvailable: true,
      degradedCandidateSource: 'pre_repair_best',
      collapsedFeatureNameIds: ['F-01'],
      placeholderFeatureIds: ['F-01', 'F-02'],
      acceptanceBoilerplateFeatureIds: ['F-02'],
      featureQualityFloorFeatureIds: ['F-01', 'F-02'],
      featureQualityFloorPassed: false,
      primaryFeatureQualityReason: 'leading features use placeholder purpose text and empty main flows.',
      emptyMainFlowFeatureIds: ['F-01', 'F-02'],
      placeholderPurposeFeatureIds: ['F-01'],
      placeholderAlternateFlowFeatureIds: ['F-02'],
      thinAcceptanceCriteriaFeatureIds: ['F-01'],
      featureQualityFloorFailedFeatureIds: ['F-01', 'F-02'],
      displayedCandidateSource: 'pre_repair_best',
      diagnosticsAlignedWithDisplayedCandidate: true,
      compilerRepairTruncationCount: 2,
      compilerRepairFinishReasons: ['length', 'length'],
    });

    const next = mergeDiagnosticsIntoIterationLog('# Iteration Protocol', 'failed_quality', diagnostics);
    expect(next).toContain('"repairRejected":true');
    expect(next).toContain('"repairRejectedReason":"Rejected compiler repair because required feature fields were replaced by placeholders."');
    expect(next).toContain('"repairDegradationSignals":["placeholder_required_fields"]');
    expect(next).toContain('"degradedCandidateAvailable":true');
    expect(next).toContain('"degradedCandidateSource":"pre_repair_best"');
    expect(next).toContain('"collapsedFeatureNameIds":["F-01"]');
    expect(next).toContain('"placeholderFeatureIds":["F-01","F-02"]');
    expect(next).toContain('"acceptanceBoilerplateFeatureIds":["F-02"]');
    expect(next).toContain('"featureQualityFloorFeatureIds":["F-01","F-02"]');
    expect(next).toContain('"featureQualityFloorPassed":false');
    expect(next).toContain('"primaryFeatureQualityReason":"leading features use placeholder purpose text and empty main flows."');
    expect(next).toContain('"emptyMainFlowFeatureIds":["F-01","F-02"]');
    expect(next).toContain('"placeholderPurposeFeatureIds":["F-01"]');
    expect(next).toContain('"placeholderAlternateFlowFeatureIds":["F-02"]');
    expect(next).toContain('"thinAcceptanceCriteriaFeatureIds":["F-01"]');
    expect(next).toContain('"featureQualityFloorFailedFeatureIds":["F-01","F-02"]');
    expect(next).toContain('"displayedCandidateSource":"pre_repair_best"');
    expect(next).toContain('"diagnosticsAlignedWithDisplayedCandidate":true');
  });

  it('embeds runtime provider diagnostics into the iteration log marker', () => {
    const diagnostics = buildCompilerRunDiagnostics({
      quality: null,
      repairAttempts: 0,
      failureStage: 'compiler_repair',
      runtimeFailureCode: 'provider_exhaustion',
      providerFailureSummary: '5 rate-limited, 2 timed out.',
      providerFailureCounts: {
        rateLimited: 5,
        timedOut: 2,
        provider4xx: 0,
        emptyResponse: 0,
      },
      providerFailedModels: ['gpt-oss-120b', 'qwen/qwen3-coder:free'],
      providerFailureStage: 'compiler_repair',
      degradedCandidateAvailable: true,
      degradedCandidateSource: 'pre_repair_best',
    });

    const next = mergeDiagnosticsIntoIterationLog('# Iteration Protocol', 'failed_runtime', diagnostics);
    expect(next).toContain('"qualityStatus":"failed_runtime"');
    expect(next).toContain('"runtimeFailureCode":"provider_exhaustion"');
    expect(next).toContain('"providerFailureSummary":"5 rate-limited, 2 timed out."');
    expect(next).toContain('"providerFailedModels":["gpt-oss-120b","qwen/qwen3-coder:free"]');
  });
});
