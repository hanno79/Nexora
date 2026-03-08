/*
Author: rahn
Datum: 08.03.2026
Version: 1.1
Beschreibung: Pure Guided-Routen-Helfer fuer Eingabenormalisierung, Timeout-Erkennung und Response-Building.
*/

// ÄNDERUNG 08.03.2026: DB-/Persistenz-Helfer nach
// `guidedRoutePersistence.ts` verschoben, damit dieses Modul import-sicher bleibt.

import type { GuidedFinalizeResponse } from './guidedAiPrompts';
import type {
  CompilerRunDiagnostics,
  PrdQualityStatus,
} from './prdRunQuality';

type GuidedAssessedLike = {
  qualityStatus: PrdQualityStatus;
  compilerDiagnostics?: CompilerRunDiagnostics | null;
  finalizationStage: 'final';
};

export function normalizeGuidedRequestInput(projectIdea: unknown, existingContent: unknown) {
  const normalizedIdea = typeof projectIdea === 'string' ? projectIdea.trim() : '';
  const normalizedExistingContent = typeof existingContent === 'string' ? existingContent.trim() : '';
  const hasExistingContent = normalizedExistingContent.length > 0;

  if (!hasExistingContent && normalizedIdea.length < 10) {
    return {
      normalizedIdea,
      normalizedExistingContent,
      hasExistingContent,
      validationMessage: 'Please provide a project idea (at least 10 characters)',
    };
  }

  if (hasExistingContent && normalizedIdea.length < 3) {
    return {
      normalizedIdea,
      normalizedExistingContent,
      hasExistingContent,
      validationMessage: 'Please provide a refinement request (at least 3 characters)',
    };
  }

  return {
    normalizedIdea,
    normalizedExistingContent,
    hasExistingContent,
  };
}

export function buildGuidedResponsePayload(params: {
  result: GuidedFinalizeResponse;
  assessed: GuidedAssessedLike;
  saveRequested: boolean;
  fallbackMode: 'generate' | 'improve';
}) {
  const {
    compilerArtifact: _compilerArtifact,
    analysisStage: _analysisStage,
    generationStage: _generationStage,
    diagnostics: _guidedInternalDiagnostics,
    ...publicGuidedResult
  } = params.result;

  return {
    ...publicGuidedResult,
    qualityStatus: params.assessed.qualityStatus,
    compilerDiagnostics: params.assessed.compilerDiagnostics,
    finalizationStage: params.assessed.finalizationStage,
    autoSaveRequested: params.saveRequested,
    effectiveMode: params.result.workflowMode || params.fallbackMode,
    baselineFeatureCount: params.assessed.compilerDiagnostics?.totalFeatureCount ?? 0,
    baselinePartial: false,
  };
}

export function isGuidedTimeoutError(error: any): boolean {
  return error?.message?.includes('aborted due to timeout') || error?.name === 'AbortError';
}
