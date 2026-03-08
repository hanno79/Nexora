import { describe, expect, it } from 'vitest';
import type { PrdQualityReport } from '../server/prdCompiler';
import { PrdCompilerQualityError } from '../server/prdCompilerFinalizer';
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

  it('carries reviewer and verifier diagnostics through base compiler metadata', () => {
    const diagnostics = buildCompilerRunDiagnostics({
      quality: makeQuality(),
      base: {
        repairAttempts: 3,
        reviewerModelIds: ['anthropic/claude-sonnet-4'],
        verifierModelIds: ['mistralai/mistral-small-3.1-24b-instruct'],
        semanticVerifierVerdict: 'fail',
        semanticBlockingCodes: ['cross_section_inconsistency'],
        semanticRepairApplied: true,
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
    expect(diagnostics.reviewerModelIds).toEqual(['anthropic/claude-sonnet-4']);
    expect(diagnostics.verifierModelIds).toEqual(['mistralai/mistral-small-3.1-24b-instruct']);
    expect(diagnostics.semanticVerifierVerdict).toBe('fail');
    expect(diagnostics.semanticBlockingCodes).toEqual(['cross_section_inconsistency']);
    expect(diagnostics.semanticRepairApplied).toBe(true);
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

  it('classifies compiler quality failures with detailed diagnostics', () => {
    const quality = makeQuality();
    const error = new PrdCompilerQualityError(
      'PRD compiler quality gate failed',
      quality,
      [
        {
          content: 'attempt',
          model: 'test-model',
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
      ]
    );
    const failure = classifyRunFailure(error);

    expect(failure.qualityStatus).toBe('failed_quality');
    expect(failure.diagnostics.errorCount).toBe(3);
    expect(failure.diagnostics.repairAttempts).toBe(1);
    expect(failure.diagnostics.failureStage).toBe('compiler_repair');
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

  it('embeds structured diagnostics marker into iteration log', () => {
    const diagnostics = buildCompilerRunDiagnostics({
      quality: makeQuality(),
      repairAttempts: 1,
      base: {
        reviewerModelIds: ['anthropic/claude-sonnet-4'],
        verifierModelIds: ['mistralai/mistral-small-3.1-24b-instruct'],
      },
    });
    const next = mergeDiagnosticsIntoIterationLog('# Iteration Protocol', 'failed_quality', diagnostics);
    expect(next).toContain('compiler-run:');
    expect(next).toContain('"qualityStatus":"failed_quality"');
    expect(next).toContain('"reviewerModelIds":["anthropic/claude-sonnet-4"]');
    expect(next).toContain('"activePhase":null');
  });
});
