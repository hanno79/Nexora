/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Testet die dauerhafte Persistenz von Compiler-Run-Artefakten inklusive Reviewer-/Verifier-Diagnostik.
*/

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { persistCompilerRunArtifact } from '../server/compilerRunArtifactPersistence';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('compiler run artifact persistence', () => {
  it('persistiert timestamped und latest run artifact unter documentation/compiler_runs', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-compiler-run-'));
    tempDirs.push(baseDir);

    const written = await persistCompilerRunArtifact({
      baseDir,
      workflow: 'guided',
      routeKey: 'guided-finalize',
      qualityStatus: 'failed_quality',
      finalizationStage: 'final',
      finalContent: '## System Vision\nArtifact content',
      compiledContent: '## System Vision\nCompiled artifact content',
      compiledStructure: { features: [], otherSections: {}, systemVision: 'Artifact content' },
      quality: {
        valid: false,
        truncatedLikely: false,
        missingSections: [],
        featureCount: 0,
        issues: [{ code: 'semantic_verifier_blocked', message: 'Verifier blocked final accept.', severity: 'error' }],
      },
      compilerDiagnostics: {
        structuredFeatureCount: 0,
        totalFeatureCount: 0,
        jsonSectionUpdates: 0,
        markdownSectionRegens: 0,
        fullRegenerations: 0,
        featurePreservations: 0,
        featureIntegrityRestores: 0,
        driftEvents: 0,
        errorCount: 1,
        warningCount: 0,
        repairAttempts: 2,
        topRootCauseCodes: ['semantic_verifier_blocked'],
        qualityIssueCodes: ['semantic_verifier_blocked'],
        semanticVerifierVerdict: 'fail',
        semanticBlockingCodes: ['cross_section_inconsistency'],
        semanticRepairApplied: true,
        reviewerModelIds: ['anthropic/claude-sonnet-4'],
        verifierModelIds: ['mistralai/mistral-small-3.1-24b-instruct'],
        semanticVerifierSameFamilyFallback: false,
        semanticVerifierBlockedFamilies: ['claude', 'gemini'],
        activePhase: 'semantic_verification',
        lastProgressEvent: 'semantic_verification_start',
        lastModelAttempt: {
          role: 'verifier',
          model: 'mistralai/mistral-small-3.1-24b-instruct',
          phase: 'semantic_verification',
          status: 'failed',
          durationMs: 12034,
        },
      },
      iterationLog: '# Iteration Protocol',
      modelsUsed: ['google/gemini-2.5-flash', 'anthropic/claude-sonnet-4', 'mistralai/mistral-small-3.1-24b-instruct'],
      requestContext: {
        templateCategory: 'feature',
        prdId: 'prd_test',
      },
      stageData: {
        compilerArtifact: {
          semanticRepairApplied: true,
        },
      },
    });

    expect(written.reportDir).toContain(path.join('documentation', 'compiler_runs'));
    expect(fs.existsSync(written.timestampedArtifactPath), 'Zeitgestempeltes Compiler-Artifact fehlt').toBe(true);
    expect(fs.existsSync(written.latestArtifactPath), 'Latest-Compiler-Artifact fehlt').toBe(true);

    const latest = JSON.parse(fs.readFileSync(written.latestArtifactPath, 'utf8'));
    expect(latest.workflow).toBe('guided');
    expect(latest.routeKey).toBe('guided-finalize');
    expect(latest.qualityStatus).toBe('failed_quality');
    expect(latest.compilerDiagnostics.semanticVerifierVerdict).toBe('fail');
    expect(latest.compilerDiagnostics.reviewerModelIds).toEqual(['anthropic/claude-sonnet-4']);
    expect(latest.compilerDiagnostics.verifierModelIds).toEqual(['mistralai/mistral-small-3.1-24b-instruct']);
    expect(latest.compilerDiagnostics.semanticVerifierBlockedFamilies).toEqual(['claude', 'gemini']);
    expect(latest.compilerDiagnostics.activePhase).toBe('semantic_verification');
    expect(latest.compilerDiagnostics.lastModelAttempt.phase).toBe('semantic_verification');
    expect(latest.stageData.compilerArtifact.semanticRepairApplied).toBe(true);
    expect(latest.compiled.quality.issues[0].code).toBe('semantic_verifier_blocked');
  });
});
