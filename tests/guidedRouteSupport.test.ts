/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Gezielte Unit-Tests fuer extrahierte Guided-Routen-Helfer.
*/

// ÄNDERUNG 08.03.2026: Regressionen fuer Guided-Eingabevalidierung, Payload-Building und Timeout-Erkennung nach Routen-Split ergänzt.

import { describe, expect, it } from 'vitest';
import {
  buildGuidedResponsePayload,
  isGuidedTimeoutError,
  normalizeGuidedRequestInput,
} from '../server/guidedRouteSupport';

describe('guidedRouteSupport', () => {
  it('validiert Guided-Start konservativ fuer neue PRDs', () => {
    expect(normalizeGuidedRequestInput('kurz', '')).toMatchObject({
      hasExistingContent: false,
      validationMessage: 'Please provide a project idea (at least 10 characters)',
    });
  });

  it('validiert Guided-Improve konservativ fuer bestehende Inhalte', () => {
    expect(normalizeGuidedRequestInput('x', 'Bestehender Inhalt')).toMatchObject({
      hasExistingContent: true,
      validationMessage: 'Please provide a refinement request (at least 3 characters)',
    });
  });

  it('baut die oeffentliche Guided-Antwort ohne interne Artefaktfelder', () => {
    const payload = buildGuidedResponsePayload({
      result: {
        prdContent: '## System Vision',
        tokensUsed: 42,
        workflowMode: 'generate',
        modelsUsed: ['mock/model'],
        compilerArtifact: { hidden: true },
        analysisStage: { hidden: true },
        generationStage: { hidden: true },
        diagnostics: { hidden: true },
      },
      assessed: {
        qualityStatus: 'passed',
        compilerDiagnostics: { totalFeatureCount: 4 },
        finalizationStage: 'final',
      },
      saveRequested: true,
      fallbackMode: 'generate',
    });

    expect(payload).toEqual({
      prdContent: '## System Vision',
      tokensUsed: 42,
      workflowMode: 'generate',
      modelsUsed: ['mock/model'],
      qualityStatus: 'passed',
      compilerDiagnostics: { totalFeatureCount: 4 },
      finalizationStage: 'final',
      autoSaveRequested: true,
      effectiveMode: 'generate',
      baselineFeatureCount: 4,
      baselinePartial: false,
    });
  });

  it('erkennt Guided-Timeout-Fehler ueber Nachricht oder AbortError-Namen', () => {
    expect(isGuidedTimeoutError(new Error('Guided finalize aborted due to timeout'))).toBe(true);
    expect(isGuidedTimeoutError({ name: 'AbortError' })).toBe(true);
    expect(isGuidedTimeoutError(new Error('anderer fehler'))).toBe(false);
  });
});
