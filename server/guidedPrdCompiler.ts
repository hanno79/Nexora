/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Rueckwaertskompatible Guided-Aliase fuer den allgemeinen PRD-Compiler.
*/

// ÄNDERUNG 08.03.2026: Header und Aenderungsdokumentation fuer Phase-0-Paket-2 ergaenzt.

import {
  compilePrdDocument,
  ensurePrdRequiredSections,
  looksLikeTruncatedOutput,
  mergeStructuresForImprove,
  validatePrdStructure,
  type CompilePrdOptions,
  type CompilePrdResult,
  type PrdQualityIssue,
  type PrdQualityReport,
} from './prdCompiler';

// Rueckwaertskompatible Guided-Aliase.
export type GuidedQualityIssue = PrdQualityIssue;
export type GuidedQualityReport = PrdQualityReport;
export type CompileGuidedPrdOptions = CompilePrdOptions;
export type CompileGuidedPrdResult = CompilePrdResult;

export const compileGuidedPrdDocument = compilePrdDocument;
export const ensureGuidedRequiredSections = ensurePrdRequiredSections;
export const validateGuidedStructure = validatePrdStructure;
export { mergeStructuresForImprove, looksLikeTruncatedOutput };
