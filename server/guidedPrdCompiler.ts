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

// Backward-compatible guided aliases.
export type GuidedQualityIssue = PrdQualityIssue;
export type GuidedQualityReport = PrdQualityReport;
export type CompileGuidedPrdOptions = CompilePrdOptions;
export type CompileGuidedPrdResult = CompilePrdResult;

export const compileGuidedPrdDocument = compilePrdDocument;
export const ensureGuidedRequiredSections = ensurePrdRequiredSections;
export const validateGuidedStructure = validatePrdStructure;
export { mergeStructuresForImprove, looksLikeTruncatedOutput };
