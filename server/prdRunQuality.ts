import type { CompilerDiagnostics, CompilerDiagnosticIssue } from './dualAiPrompts';
import type { PrdQualityIssue, PrdQualityReport } from './prdCompiler';
import type { FinalizerFailureStage, RepairGapReason, SemanticBlockingIssue } from './prdCompilerFinalizer';
import type { PRDStructure } from './prdStructure';
import { PrdCompilerQualityError, PrdCompilerRuntimeError } from './prdCompilerFinalizer';
import {
  parseProviderFailureDiagnostics,
  type ProviderFailureCounts,
  type ProviderFailureStage,
  type RuntimeFailureCode,
} from './providerFailureDiagnostics';

export type PrdQualityStatus = 'passed' | 'degraded' | 'failed_quality' | 'failed_runtime' | 'cancelled';
export type PrdFinalizationStage = 'intermediate' | 'final';

export interface CompilerRunDiagnostics extends CompilerDiagnostics {
  errorCount: number;
  warningCount: number;
  repairAttempts: number;
  topRootCauseCodes: string[];
  qualityIssueCodes: string[];
  failureStage?: FinalizerFailureStage;
  semanticVerifierVerdict?: 'pass' | 'fail';
  primaryGateReason?: string;
  structuralParseReason?: string;
  rawFeatureHeadingSamples?: string[];
  normalizationApplied?: boolean;
  normalizedFeatureCountRecovered?: number;
  primaryCapabilityAnchors?: string[];
  featurePriorityWindow?: string[];
  coreFeatureIds?: string[];
  supportFeatureIds?: string[];
  canonicalFeatureIds?: string[];
  timelineMismatchedFeatureIds?: string[];
  timelineRewrittenFromFeatureMap?: boolean;
  timelineRewriteAppliedLines?: number;
  semanticBlockingCodes?: string[];
  semanticBlockingIssues?: CompilerDiagnosticIssue[];
  initialSemanticBlockingIssues?: CompilerDiagnosticIssue[];
  postRepairSemanticBlockingIssues?: CompilerDiagnosticIssue[];
  finalSemanticBlockingIssues?: CompilerDiagnosticIssue[];
  semanticRepairApplied?: boolean;
  semanticRepairAttempted?: boolean;
  semanticRepairIssueCodes?: string[];
  semanticRepairSectionKeys?: string[];
  semanticRepairTruncated?: boolean;
  repairGapReason?: RepairGapReason;
  repairCycleCount?: number;
  compilerRepairTruncationCount?: number;
  compilerRepairFinishReasons?: string[];
  repairRejected?: boolean;
  repairRejectedReason?: string;
  repairDegradationSignals?: string[];
  degradedCandidateAvailable?: boolean;
  degradedCandidateSource?: 'pre_repair_best' | 'post_targeted_repair';
  displayedCandidateSource?: 'passed' | 'pre_repair_best' | 'post_targeted_repair';
  diagnosticsAlignedWithDisplayedCandidate?: boolean;
  collapsedFeatureNameIds?: string[];
  placeholderFeatureIds?: string[];
  acceptanceBoilerplateFeatureIds?: string[];
  featureQualityFloorFeatureIds?: string[];
  featureQualityFloorFailedFeatureIds?: string[];
  featureQualityFloorPassed?: boolean;
  primaryFeatureQualityReason?: string;
  emptyMainFlowFeatureIds?: string[];
  placeholderPurposeFeatureIds?: string[];
  placeholderAlternateFlowFeatureIds?: string[];
  thinAcceptanceCriteriaFeatureIds?: string[];
  semanticRepairChangedSections?: string[];
  semanticRepairStructuralChange?: boolean;
  earlyDriftDetected?: boolean;
  earlyDriftCodes?: string[];
  earlyDriftSections?: string[];
  blockedAddedFeatures?: string[];
  earlySemanticLintCodes?: string[];
  earlyRepairAttempted?: boolean;
  earlyRepairApplied?: boolean;
  primaryEarlyDriftReason?: string;
  qualityIssues?: CompilerDiagnosticIssue[];
  runtimeFailureCode?: RuntimeFailureCode;
  providerFailureSummary?: string;
  providerFailureCounts?: ProviderFailureCounts;
  providerFailedModels?: string[];
  providerFailureStage?: ProviderFailureStage;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean)));
}

function toDiagnosticIssue(issue: SemanticBlockingIssue): CompilerDiagnosticIssue {
  return {
    code: String(issue.code || '').trim() || 'cross_section_inconsistency',
    sectionKey: String(issue.sectionKey || '').trim() || 'systemVision',
    message: String(issue.message || '').trim() || 'Blocking semantic inconsistency.',
    ...(issue.suggestedAction ? { suggestedAction: issue.suggestedAction } : {}),
    ...(issue.targetFields?.length ? { targetFields: Array.from(new Set(issue.targetFields)) } : {}),
  };
}

export function deterministicIssueToDiagnostic(issue: {
  code: string;
  message: string;
  severity: string;
  evidencePath?: string;
}): CompilerDiagnosticIssue {
  const sectionKey = issue.evidencePath?.startsWith('feature:')
    ? issue.evidencePath
    : issue.evidencePath || 'systemVision';
  return {
    code: issue.code,
    sectionKey,
    message: issue.message,
    suggestedAction: sectionKey.startsWith('feature:') ? 'enrich' : 'rewrite',
  };
}

function toDiagnosticIssues(issues: SemanticBlockingIssue[] | undefined): CompilerDiagnosticIssue[] {
  if (!Array.isArray(issues)) return [];

  const normalized = issues.map(toDiagnosticIssue);
  const seen = new Set<string>();
  const unique: CompilerDiagnosticIssue[] = [];
  for (const issue of normalized) {
    const key = JSON.stringify([
      issue.code,
      issue.sectionKey,
      issue.message,
      issue.suggestedAction || '',
      issue.targetFields || [],
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue);
  }
  return unique;
}

function humanizeDiagnosticCode(code: string): string {
  return String(code || '')
    .trim()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPrimaryGateReason(params: {
  failureStage?: FinalizerFailureStage;
  topRootCauseCodes?: string[];
  primaryFeatureQualityReason?: string;
  structuralParseReason?: string;
  rawFeatureHeadingSamples?: string[];
  normalizationApplied?: boolean;
  normalizedFeatureCountRecovered?: number;
  semanticBlockingIssues?: CompilerDiagnosticIssue[];
  repairGapReason?: RepairGapReason;
}): string | undefined {
  const repairGapSuffix = params.repairGapReason
    ? ` Repair gap: ${String(params.repairGapReason).replace(/_/g, ' ')}.`
    : '';
  if (params.primaryFeatureQualityReason?.trim()) {
    const normalizedReason = params.primaryFeatureQualityReason.trim().replace(/[.\s]+$/, '');
    return `Quality gate failed because ${normalizedReason}.${repairGapSuffix}`;
  }
  const semanticBlockingIssues = params.semanticBlockingIssues || [];
  if (params.failureStage === 'semantic_verifier' && semanticBlockingIssues.length > 0) {
    const firstIssue = semanticBlockingIssues[0];
    const sections = uniqueStrings(semanticBlockingIssues.map(issue => issue.sectionKey));
    const sectionSuffix = sections.length > 0
      ? ` Affected sections: ${sections.join(', ')}.`
      : '';
    return `Semantic verifier blocked finalization: ${firstIssue.message}${sectionSuffix}${repairGapSuffix}`;
  }

  if (params.structuralParseReason === 'feature_catalogue_format_mismatch') {
    const samples = uniqueStrings(params.rawFeatureHeadingSamples || []);
    const sampleSuffix = samples.length > 0
      ? ` Raw heading samples: ${samples.join(' | ')}.`
      : '';
    const normalizationSuffix = params.normalizationApplied
      ? ` Deterministic normalization was applied${typeof params.normalizedFeatureCountRecovered === 'number'
          ? ` and recovered ${params.normalizedFeatureCountRecovered} feature(s)`
          : ''}.`
      : '';
    return `Feature catalogue exists in raw markdown but could not be parsed into canonical F-XX features.${sampleSuffix}${normalizationSuffix}${repairGapSuffix}`;
  }

  const topRootCauseCodes = uniqueStrings(params.topRootCauseCodes || []);
  if (
    topRootCauseCodes.includes('vision_capability_coverage_missing')
    || topRootCauseCodes.includes('support_features_overweight')
  ) {
    return `Quality gate failed because primary product capabilities from the vision are not represented by the leading feature set.${repairGapSuffix}`;
  }
  if (params.failureStage && topRootCauseCodes.length > 0) {
    return `Quality gate failed in ${params.failureStage}: ${topRootCauseCodes.map(humanizeDiagnosticCode).join(', ')}.${repairGapSuffix}`;
  }

  if (topRootCauseCodes.length > 0) {
    return `Quality gate failed due to ${topRootCauseCodes.map(humanizeDiagnosticCode).join(', ')}.${repairGapSuffix}`;
  }

  return undefined;
}

function buildPrimaryRepairFailureReason(params: {
  repairRejected?: boolean;
  repairRejectedReason?: string;
}): string | undefined {
  if (!params.repairRejected) return undefined;
  return params.repairRejectedReason || 'The last compiler repair was rejected because it degraded the best available PRD candidate.';
}

function buildPrimaryEarlyDriftReason(params: {
  earlyDriftCodes?: string[];
  earlyDriftSections?: string[];
  blockedAddedFeatures?: string[];
}): string | undefined {
  const blockedAddedFeatures = uniqueStrings(params.blockedAddedFeatures || []);
  if (blockedAddedFeatures.length > 0) {
    return `Improve mode blocked new feature additions: ${blockedAddedFeatures.join(', ')}.`;
  }

  const earlyDriftCodes = uniqueStrings(params.earlyDriftCodes || []);
  const earlyDriftSections = uniqueStrings(params.earlyDriftSections || []);
  if (earlyDriftCodes.length > 0) {
    const sectionSuffix = earlyDriftSections.length > 0
      ? ` Affected sections: ${earlyDriftSections.join(', ')}.`
      : '';
    return `Early improve-mode drift detected: ${earlyDriftCodes.map(humanizeDiagnosticCode).join(', ')}.${sectionSuffix}`;
  }

  return undefined;
}

function buildPrimaryRuntimeFailureReason(params: {
  runtimeFailureCode?: RuntimeFailureCode;
  providerFailureSummary?: string;
  providerFailureStage?: ProviderFailureStage;
}): string | undefined {
  if (!params.runtimeFailureCode && !params.providerFailureSummary) return undefined;
  const stage = params.providerFailureStage || 'compiler_repair';
  const summary = params.providerFailureSummary || 'All configured AI models were temporarily unavailable.';
  if (params.runtimeFailureCode === 'provider_auth') {
    return `Provider authentication failed during ${stage}: ${summary}`;
  }
  if (params.runtimeFailureCode === 'provider_unavailable') {
    return `Provider availability failure during ${stage}: ${summary}`;
  }
  return `Provider exhaustion blocked ${stage}: ${summary}`;
}

function severityCount(issues: PrdQualityIssue[], severity: 'error' | 'warning'): number {
  return issues.filter(issue => issue.severity === severity).length;
}

function countByCodePrefix(issues: PrdQualityIssue[], prefix: string): number {
  return issues.filter(issue => issue.code.startsWith(prefix)).length;
}

function extractAggregatedFeatureCount(issues: PrdQualityIssue[]): number {
  const issue = issues.find(entry => entry.code === 'feature_aggregation_applied');
  if (!issue) return 0;
  const match = issue.message.match(/merged\s+(\d+)/i);
  return match ? Number(match[1]) : 0;
}

export function topRootCauseCodes(
  issues: PrdQualityIssue[],
  limit = 3,
  options?: { featureQualityFloorFailed?: boolean }
): string[] {
  const ranked = issues
    .filter(issue => issue.severity === 'error')
    .map(issue => issue.code)
    .filter(Boolean);
  const uniqueRanked = Array.from(new Set(ranked));
  if (!options?.featureQualityFloorFailed) {
    return uniqueRanked.slice(0, Math.max(1, limit));
  }

  const featureQualityPriority = [
    'feature_quality_floor_failed',
    'feature_specs_incomplete',
    'feature_content_thin',
    'feature_content_shallow',
    'boilerplate_feature_acceptance_repetition',
    'boilerplate_repetition_detected',
    'feature_near_duplicates_unmerged',
  ];
  const deferredSecondary = new Set([
    'timeline_feature_reference_mismatch',
    'out_of_scope_reintroduced',
    'out_of_scope_future_leakage',
  ]);
  const prioritized = [
    ...featureQualityPriority.filter(code => uniqueRanked.includes(code)),
    ...uniqueRanked.filter(code => !featureQualityPriority.includes(code) && !deferredSecondary.has(code)),
    ...uniqueRanked.filter(code => deferredSecondary.has(code)),
  ];
  return Array.from(new Set(prioritized)).slice(0, Math.max(1, limit));
}

export function buildCompilerRunDiagnostics(params: {
  quality?: PrdQualityReport | null;
  repairAttempts?: number;
  base?: Partial<CompilerDiagnostics>;
  failureStage?: FinalizerFailureStage;
  semanticVerifierVerdict?: 'pass' | 'fail';
  primaryGateReason?: string;
  structuralParseReason?: string;
  rawFeatureHeadingSamples?: string[];
  normalizationApplied?: boolean;
  normalizedFeatureCountRecovered?: number;
  primaryCapabilityAnchors?: string[];
  featurePriorityWindow?: string[];
  coreFeatureIds?: string[];
  supportFeatureIds?: string[];
  canonicalFeatureIds?: string[];
  timelineMismatchedFeatureIds?: string[];
  timelineRewrittenFromFeatureMap?: boolean;
  timelineRewriteAppliedLines?: number;
  semanticBlockingCodes?: string[];
  semanticBlockingIssues?: CompilerDiagnosticIssue[];
  initialSemanticBlockingIssues?: CompilerDiagnosticIssue[];
  postRepairSemanticBlockingIssues?: CompilerDiagnosticIssue[];
  finalSemanticBlockingIssues?: CompilerDiagnosticIssue[];
  semanticRepairApplied?: boolean;
  semanticRepairAttempted?: boolean;
  semanticRepairIssueCodes?: string[];
  semanticRepairSectionKeys?: string[];
  semanticRepairTruncated?: boolean;
  repairGapReason?: RepairGapReason;
  repairCycleCount?: number;
  compilerRepairTruncationCount?: number;
  compilerRepairFinishReasons?: string[];
  repairRejected?: boolean;
  repairRejectedReason?: string;
  repairDegradationSignals?: string[];
  degradedCandidateAvailable?: boolean;
  degradedCandidateSource?: 'pre_repair_best' | 'post_targeted_repair';
  displayedCandidateSource?: 'passed' | 'pre_repair_best' | 'post_targeted_repair';
  diagnosticsAlignedWithDisplayedCandidate?: boolean;
  collapsedFeatureNameIds?: string[];
  placeholderFeatureIds?: string[];
  acceptanceBoilerplateFeatureIds?: string[];
  featureQualityFloorFeatureIds?: string[];
  featureQualityFloorFailedFeatureIds?: string[];
  featureQualityFloorPassed?: boolean;
  primaryFeatureQualityReason?: string;
  emptyMainFlowFeatureIds?: string[];
  placeholderPurposeFeatureIds?: string[];
  placeholderAlternateFlowFeatureIds?: string[];
  thinAcceptanceCriteriaFeatureIds?: string[];
  semanticRepairChangedSections?: string[];
  semanticRepairStructuralChange?: boolean;
  earlyDriftDetected?: boolean;
  earlyDriftCodes?: string[];
  earlyDriftSections?: string[];
  blockedAddedFeatures?: string[];
  earlySemanticLintCodes?: string[];
  earlyRepairAttempted?: boolean;
  earlyRepairApplied?: boolean;
  primaryEarlyDriftReason?: string;
  runtimeFailureCode?: RuntimeFailureCode;
  providerFailureSummary?: string;
  providerFailureCounts?: ProviderFailureCounts;
  providerFailedModels?: string[];
  providerFailureStage?: ProviderFailureStage;
}): CompilerRunDiagnostics {
  const quality = params.quality || null;
  const issues = quality?.issues || [];
  const errorCount = severityCount(issues, 'error');
  const warningCount = severityCount(issues, 'warning');
  const languageMismatchHits = countByCodePrefix(issues, 'language_mismatch_');
  const finalSemanticBlockingIssues = params.finalSemanticBlockingIssues
    || params.semanticBlockingIssues
    || params.base?.finalSemanticBlockingIssues
    || params.base?.semanticBlockingIssues
    || [];
  const structuralParseReason = params.structuralParseReason
    || params.base?.structuralParseReason
    || quality?.structuralParseReason;
  const rawFeatureHeadingSamples = uniqueStrings(
    params.rawFeatureHeadingSamples
    || params.base?.rawFeatureHeadingSamples
    || quality?.rawFeatureHeadingSamples
    || []
  );
  const normalizationApplied = params.normalizationApplied
    ?? params.base?.normalizationApplied
    ?? quality?.normalizationApplied;
  const normalizedFeatureCountRecovered = typeof params.normalizedFeatureCountRecovered === 'number'
    ? params.normalizedFeatureCountRecovered
    : typeof params.base?.normalizedFeatureCountRecovered === 'number'
      ? params.base.normalizedFeatureCountRecovered
      : quality?.normalizedFeatureCountRecovered;
  const initialSemanticBlockingIssues = params.initialSemanticBlockingIssues
    || params.base?.initialSemanticBlockingIssues
    || [];
  const postRepairSemanticBlockingIssues = params.postRepairSemanticBlockingIssues
    || params.base?.postRepairSemanticBlockingIssues
    || [];
  const runtimeFailureCode = params.runtimeFailureCode ?? params.base?.runtimeFailureCode;
  const providerFailureSummary = params.providerFailureSummary || params.base?.providerFailureSummary;
  const providerFailureStage = params.providerFailureStage ?? params.base?.providerFailureStage;
  const providerFailureCounts = params.providerFailureCounts ?? params.base?.providerFailureCounts;
  const providerFailedModels = uniqueStrings(params.providerFailedModels || params.base?.providerFailedModels || []);
  const featureQualityFloorPassed =
    params.featureQualityFloorPassed
    ?? params.base?.featureQualityFloorPassed;
  const primaryFeatureQualityReason =
    params.primaryFeatureQualityReason
    || params.base?.primaryFeatureQualityReason;
  const topCauseCodes = topRootCauseCodes(issues, 3, {
    featureQualityFloorFailed: featureQualityFloorPassed === false,
  });
  const qualityIssueCodes = uniqueStrings([
    ...(featureQualityFloorPassed === false ? ['feature_quality_floor_failed'] : []),
    ...issues.map(issue => issue.code),
  ]);
  const diagnostics: CompilerRunDiagnostics = {
    structuredFeatureCount: params.base?.structuredFeatureCount ?? 0,
    totalFeatureCount: params.base?.totalFeatureCount ?? (quality?.featureCount || 0),
    jsonSectionUpdates: params.base?.jsonSectionUpdates ?? 0,
    markdownSectionRegens: params.base?.markdownSectionRegens ?? 0,
    fullRegenerations: params.base?.fullRegenerations ?? 0,
    featurePreservations: params.base?.featurePreservations ?? 0,
    featureIntegrityRestores: params.base?.featureIntegrityRestores ?? 0,
    featureQualityRegressions: params.base?.featureQualityRegressions ?? 0,
    autoRecoveredFeatures: params.base?.autoRecoveredFeatures ?? 0,
    avgFeatureCompleteness: params.base?.avgFeatureCompleteness ?? 0,
    driftEvents: params.base?.driftEvents ?? 0,
    featureFreezeActive: params.base?.featureFreezeActive ?? false,
    blockedRegenerationAttempts: params.base?.blockedRegenerationAttempts ?? 0,
    freezeSeedSource: params.base?.freezeSeedSource || 'none',
    nfrGlobalCategoryAdds: params.base?.nfrGlobalCategoryAdds ?? 0,
    nfrFeatureCriteriaAdds: params.base?.nfrFeatureCriteriaAdds ?? 0,
    jsonRetryAttempts: params.base?.jsonRetryAttempts ?? 0,
    jsonRepairSuccesses: params.base?.jsonRepairSuccesses ?? 0,
    finalValidationPassed: params.base?.finalValidationPassed ?? !!quality?.valid,
    finalValidationErrors: params.base?.finalValidationErrors ?? errorCount,
    finalSanitizerApplied: params.base?.finalSanitizerApplied ?? false,
    artifactWriteConsistency: params.base?.artifactWriteConsistency ?? true,
    artifactWriteIssues: params.base?.artifactWriteIssues ?? 0,
    aggregatedFeatureCount: params.base?.aggregatedFeatureCount ?? extractAggregatedFeatureCount(issues),
    languageFixRequired: params.base?.languageFixRequired ?? languageMismatchHits > 0,
    boilerplateHits: params.base?.boilerplateHits ?? countByCodePrefix(issues, 'boilerplate_'),
    metaLeakHits: params.base?.metaLeakHits ?? countByCodePrefix(issues, 'meta_prompt_leak'),
    errorCount,
    warningCount,
    repairAttempts: Math.max(0, params.repairAttempts ?? params.base?.repairAttempts ?? 0),
    topRootCauseCodes: topCauseCodes,
    qualityIssueCodes,
    qualityIssues: issues
      .filter(i => i.severity === 'warning')
      .map(deterministicIssueToDiagnostic),
    failureStage: params.failureStage,
    semanticVerifierVerdict: params.semanticVerifierVerdict ?? params.base?.semanticVerifierVerdict,
    primaryGateReason:
      runtimeFailureCode
        ? undefined
        : params.primaryGateReason
          || params.base?.primaryGateReason
          || buildPrimaryGateReason({
            failureStage: params.failureStage,
            topRootCauseCodes: topCauseCodes,
            primaryFeatureQualityReason,
            structuralParseReason,
            rawFeatureHeadingSamples,
            normalizationApplied,
            normalizedFeatureCountRecovered,
            semanticBlockingIssues: finalSemanticBlockingIssues,
            repairGapReason: params.repairGapReason ?? params.base?.repairGapReason,
          }),
    structuralParseReason,
    rawFeatureHeadingSamples,
    normalizationApplied,
    normalizedFeatureCountRecovered,
    primaryCapabilityAnchors: uniqueStrings(
      params.primaryCapabilityAnchors
      || params.base?.primaryCapabilityAnchors
      || quality?.primaryCapabilityAnchors
      || []
    ),
    featurePriorityWindow: uniqueStrings(
      params.featurePriorityWindow
      || params.base?.featurePriorityWindow
      || quality?.featurePriorityWindow
      || []
    ),
    coreFeatureIds: uniqueStrings(
      params.coreFeatureIds
      || params.base?.coreFeatureIds
      || quality?.coreFeatureIds
      || []
    ),
    supportFeatureIds: uniqueStrings(
      params.supportFeatureIds
      || params.base?.supportFeatureIds
      || quality?.supportFeatureIds
      || []
    ),
    canonicalFeatureIds: uniqueStrings(
      params.canonicalFeatureIds
      || params.base?.canonicalFeatureIds
      || quality?.canonicalFeatureIds
      || []
    ),
    timelineMismatchedFeatureIds: uniqueStrings(
      params.timelineMismatchedFeatureIds
      || params.base?.timelineMismatchedFeatureIds
      || quality?.timelineMismatchedFeatureIds
      || []
    ),
    timelineRewrittenFromFeatureMap:
      params.timelineRewrittenFromFeatureMap
      ?? params.base?.timelineRewrittenFromFeatureMap
      ?? false,
    timelineRewriteAppliedLines: Math.max(0, params.timelineRewriteAppliedLines ?? params.base?.timelineRewriteAppliedLines ?? 0),
    semanticBlockingCodes: uniqueStrings(
      params.semanticBlockingCodes
      || params.base?.semanticBlockingCodes
      || finalSemanticBlockingIssues.map(issue => issue.code)
    ),
    semanticBlockingIssues: finalSemanticBlockingIssues,
    initialSemanticBlockingIssues,
    postRepairSemanticBlockingIssues,
    finalSemanticBlockingIssues,
    semanticRepairApplied: params.semanticRepairApplied ?? params.base?.semanticRepairApplied ?? false,
    semanticRepairAttempted: params.semanticRepairAttempted ?? params.base?.semanticRepairAttempted ?? false,
    semanticRepairIssueCodes: uniqueStrings(params.semanticRepairIssueCodes || params.base?.semanticRepairIssueCodes || []),
    semanticRepairSectionKeys: uniqueStrings(params.semanticRepairSectionKeys || params.base?.semanticRepairSectionKeys || []),
    semanticRepairTruncated: params.semanticRepairTruncated ?? params.base?.semanticRepairTruncated ?? false,
    repairGapReason: params.repairGapReason ?? params.base?.repairGapReason,
    repairCycleCount: Math.max(0, params.repairCycleCount ?? params.base?.repairCycleCount ?? 0),
    compilerRepairTruncationCount: Math.max(0, params.compilerRepairTruncationCount ?? params.base?.compilerRepairTruncationCount ?? 0),
    compilerRepairFinishReasons: uniqueStrings(
      params.compilerRepairFinishReasons
      || params.base?.compilerRepairFinishReasons
      || []
    ),
    repairRejected: params.repairRejected ?? params.base?.repairRejected ?? false,
    repairRejectedReason:
      params.repairRejectedReason
      || params.base?.repairRejectedReason
      || buildPrimaryRepairFailureReason({
        repairRejected: params.repairRejected ?? params.base?.repairRejected,
        repairRejectedReason: params.repairRejectedReason ?? params.base?.repairRejectedReason,
      }),
    repairDegradationSignals: uniqueStrings(
      params.repairDegradationSignals
      || params.base?.repairDegradationSignals
      || []
    ),
    degradedCandidateAvailable: params.degradedCandidateAvailable ?? params.base?.degradedCandidateAvailable ?? false,
    degradedCandidateSource: params.degradedCandidateSource ?? params.base?.degradedCandidateSource,
    displayedCandidateSource: params.displayedCandidateSource ?? params.base?.displayedCandidateSource,
    diagnosticsAlignedWithDisplayedCandidate:
      params.diagnosticsAlignedWithDisplayedCandidate
      ?? params.base?.diagnosticsAlignedWithDisplayedCandidate,
    collapsedFeatureNameIds: uniqueStrings(params.collapsedFeatureNameIds || params.base?.collapsedFeatureNameIds || []),
    placeholderFeatureIds: uniqueStrings(params.placeholderFeatureIds || params.base?.placeholderFeatureIds || []),
    acceptanceBoilerplateFeatureIds: uniqueStrings(
      params.acceptanceBoilerplateFeatureIds || params.base?.acceptanceBoilerplateFeatureIds || []
    ),
    featureQualityFloorFeatureIds: uniqueStrings(
      params.featureQualityFloorFeatureIds || params.base?.featureQualityFloorFeatureIds || []
    ),
    featureQualityFloorFailedFeatureIds: uniqueStrings(
      params.featureQualityFloorFailedFeatureIds || params.base?.featureQualityFloorFailedFeatureIds || []
    ),
    featureQualityFloorPassed,
    primaryFeatureQualityReason,
    emptyMainFlowFeatureIds: uniqueStrings(
      params.emptyMainFlowFeatureIds || params.base?.emptyMainFlowFeatureIds || []
    ),
    placeholderPurposeFeatureIds: uniqueStrings(
      params.placeholderPurposeFeatureIds || params.base?.placeholderPurposeFeatureIds || []
    ),
    placeholderAlternateFlowFeatureIds: uniqueStrings(
      params.placeholderAlternateFlowFeatureIds || params.base?.placeholderAlternateFlowFeatureIds || []
    ),
    thinAcceptanceCriteriaFeatureIds: uniqueStrings(
      params.thinAcceptanceCriteriaFeatureIds || params.base?.thinAcceptanceCriteriaFeatureIds || []
    ),
    semanticRepairChangedSections: uniqueStrings(
      params.semanticRepairChangedSections
      || params.base?.semanticRepairChangedSections
      || []
    ),
    semanticRepairStructuralChange:
      params.semanticRepairStructuralChange
      ?? params.base?.semanticRepairStructuralChange
      ?? false,
    earlyDriftDetected: params.earlyDriftDetected ?? params.base?.earlyDriftDetected ?? false,
    earlyDriftCodes: uniqueStrings(params.earlyDriftCodes || params.base?.earlyDriftCodes || []),
    earlyDriftSections: uniqueStrings(params.earlyDriftSections || params.base?.earlyDriftSections || []),
    blockedAddedFeatures: uniqueStrings(params.blockedAddedFeatures || params.base?.blockedAddedFeatures || []),
    earlySemanticLintCodes: uniqueStrings(params.earlySemanticLintCodes || params.base?.earlySemanticLintCodes || []),
    earlyRepairAttempted: params.earlyRepairAttempted ?? params.base?.earlyRepairAttempted ?? false,
    earlyRepairApplied: params.earlyRepairApplied ?? params.base?.earlyRepairApplied ?? false,
    primaryEarlyDriftReason:
      params.primaryEarlyDriftReason
      || params.base?.primaryEarlyDriftReason
      || buildPrimaryEarlyDriftReason({
        earlyDriftCodes: params.earlyDriftCodes || params.base?.earlyDriftCodes,
        earlyDriftSections: params.earlyDriftSections || params.base?.earlyDriftSections,
        blockedAddedFeatures: params.blockedAddedFeatures || params.base?.blockedAddedFeatures,
      }),
    runtimeFailureCode,
    providerFailureSummary:
      providerFailureSummary
      || buildPrimaryRuntimeFailureReason({
        runtimeFailureCode,
        providerFailureSummary,
        providerFailureStage,
      }),
    providerFailureCounts,
    providerFailedModels,
    providerFailureStage,
    repairModelIds: params.base?.repairModelIds ?? [],
    reviewerModelIds: params.base?.reviewerModelIds ?? [],
    verifierModelIds: params.base?.verifierModelIds ?? [],
    contentRefined: params.base?.contentRefined ?? false,
    contentReviewIssueCodes: params.base?.contentReviewIssueCodes ?? [],
    semanticVerifierSameFamilyFallback: params.base?.semanticVerifierSameFamilyFallback ?? false,
    semanticVerifierBlockedFamilies: params.base?.semanticVerifierBlockedFamilies ?? [],
    activePhase: params.base?.activePhase,
    lastProgressEvent: params.base?.lastProgressEvent,
    lastModelAttempt: params.base?.lastModelAttempt,
  };

  return diagnostics;
}

export function classifyRunFailure(
  error: unknown,
  base?: Partial<CompilerDiagnostics>,
): {
  qualityStatus: Exclude<PrdQualityStatus, 'passed'>;
  message: string;
  diagnostics: CompilerRunDiagnostics;
  finalContent?: string | null;
  compiledContent?: string | null;
  compiledStructure?: PRDStructure | null;
  quality?: PrdQualityReport | null;
} {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  const normalized = message.toLowerCase();
  const cancelled = normalized.includes('cancel') || normalized.includes('aborted');
  if (cancelled) {
    return {
      qualityStatus: 'cancelled',
      message,
      diagnostics: buildCompilerRunDiagnostics({ quality: null, repairAttempts: 0, base }),
      finalContent: null,
      compiledContent: null,
      compiledStructure: null,
      quality: null,
    };
  }

  if (error instanceof PrdCompilerQualityError) {
    // ÄNDERUNG 11.03.2026: Degradierte Compiler-Struktur und Quality im Failure-Pfad
    // weiterreichen, damit Artefakte Feature-/Task-Metadaten nicht verlieren.
    const finalSemanticBlockingIssues = toDiagnosticIssues(
      error.finalSemanticBlockingIssues?.length
        ? error.finalSemanticBlockingIssues
        : error.semanticVerification?.blockingIssues
    );
    const initialSemanticBlockingIssues = toDiagnosticIssues(error.initialSemanticBlockingIssues);
    const postRepairSemanticBlockingIssues = toDiagnosticIssues(error.postRepairSemanticBlockingIssues);
    const compiledFeatureCount = Array.isArray(error.compiledStructure?.features)
      ? error.compiledStructure.features.length
      : undefined;
    const baseStructuredFeatureCount = typeof base?.structuredFeatureCount === 'number'
      ? base.structuredFeatureCount
      : undefined;
    const baseTotalFeatureCount = typeof base?.totalFeatureCount === 'number'
      ? base.totalFeatureCount
      : undefined;
    const degradedCompiledContent = error.degradedCandidateAvailable ? (error.compiledContent || null) : null;
    const degradedCompiledStructure = error.degradedCandidateAvailable ? (error.compiledStructure || null) : null;
    return {
      qualityStatus: 'failed_quality',
      message,
      diagnostics: buildCompilerRunDiagnostics({
        quality: error.quality,
        repairAttempts: error.repairAttempts.length,
        base: {
          ...(base || {}),
          structuredFeatureCount:
            typeof compiledFeatureCount === 'number'
              ? compiledFeatureCount
              : baseStructuredFeatureCount,
          totalFeatureCount:
            Math.max(
              baseTotalFeatureCount ?? 0,
              error.quality.featureCount || 0,
              compiledFeatureCount ?? 0,
            ) || undefined,
          repairModelIds: error.repairAttempts.map(attempt => attempt.model).filter(Boolean),
          reviewerModelIds: error.reviewerAttempts.map(attempt => attempt.model).filter(Boolean),
          verifierModelIds: error.semanticVerification?.model ? [error.semanticVerification.model] : [],
          semanticVerifierSameFamilyFallback: error.semanticVerification?.sameFamilyFallback ?? false,
          semanticVerifierBlockedFamilies: error.semanticVerification?.blockedFamilies || [],
        },
        failureStage: error.failureStage,
        semanticVerifierVerdict: error.semanticVerification?.verdict,
        primaryGateReason: buildPrimaryGateReason({
          failureStage: error.failureStage,
          topRootCauseCodes: topRootCauseCodes(error.quality.issues),
          structuralParseReason: error.quality.structuralParseReason,
          rawFeatureHeadingSamples: error.quality.rawFeatureHeadingSamples,
          normalizationApplied: error.quality.normalizationApplied,
          normalizedFeatureCountRecovered: error.quality.normalizedFeatureCountRecovered,
          semanticBlockingIssues: finalSemanticBlockingIssues,
          repairGapReason: error.repairGapReason,
        }),
        structuralParseReason: error.quality.structuralParseReason,
        rawFeatureHeadingSamples: error.quality.rawFeatureHeadingSamples,
        normalizationApplied: error.quality.normalizationApplied,
        normalizedFeatureCountRecovered: error.quality.normalizedFeatureCountRecovered,
        primaryCapabilityAnchors: error.primaryCapabilityAnchors,
        featurePriorityWindow: error.featurePriorityWindow,
        coreFeatureIds: error.coreFeatureIds,
        supportFeatureIds: error.supportFeatureIds,
        canonicalFeatureIds: error.canonicalFeatureIds,
        timelineMismatchedFeatureIds: error.timelineMismatchedFeatureIds,
        timelineRewrittenFromFeatureMap: error.timelineRewrittenFromFeatureMap,
        timelineRewriteAppliedLines: error.timelineRewriteAppliedLines,
        semanticBlockingCodes: finalSemanticBlockingIssues.map(issue => issue.code),
        semanticBlockingIssues: finalSemanticBlockingIssues,
        initialSemanticBlockingIssues,
        postRepairSemanticBlockingIssues,
        finalSemanticBlockingIssues,
        semanticRepairApplied: error.semanticRepairApplied,
        semanticRepairAttempted: error.semanticRepairAttempted,
        semanticRepairIssueCodes: error.semanticRepairIssueCodes,
        semanticRepairSectionKeys: error.semanticRepairSectionKeys,
        semanticRepairTruncated: error.semanticRepairTruncated,
        repairGapReason: error.repairGapReason,
        repairCycleCount: error.repairCycleCount,
        compilerRepairTruncationCount: error.compilerRepairTruncationCount,
        compilerRepairFinishReasons: error.compilerRepairFinishReasons,
        repairRejected: error.repairRejected,
        repairRejectedReason: error.repairRejectedReason,
        repairDegradationSignals: error.repairDegradationSignals,
        degradedCandidateAvailable: error.degradedCandidateAvailable,
        degradedCandidateSource: error.degradedCandidateSource,
        displayedCandidateSource: error.displayedCandidateSource,
        diagnosticsAlignedWithDisplayedCandidate: error.diagnosticsAlignedWithDisplayedCandidate,
        collapsedFeatureNameIds: error.collapsedFeatureNameIds,
        placeholderFeatureIds: error.placeholderFeatureIds,
        acceptanceBoilerplateFeatureIds: error.acceptanceBoilerplateFeatureIds,
        featureQualityFloorFeatureIds: error.featureQualityFloorFeatureIds,
        featureQualityFloorFailedFeatureIds: error.featureQualityFloorFailedFeatureIds,
        featureQualityFloorPassed: error.featureQualityFloorPassed,
        primaryFeatureQualityReason: error.primaryFeatureQualityReason,
        emptyMainFlowFeatureIds: error.emptyMainFlowFeatureIds,
        placeholderPurposeFeatureIds: error.placeholderPurposeFeatureIds,
        placeholderAlternateFlowFeatureIds: error.placeholderAlternateFlowFeatureIds,
        thinAcceptanceCriteriaFeatureIds: error.thinAcceptanceCriteriaFeatureIds,
        semanticRepairChangedSections: error.semanticRepairChangedSections,
        semanticRepairStructuralChange: error.semanticRepairStructuralChange,
        earlyDriftDetected: error.earlyDriftDetected,
        earlyDriftCodes: error.earlyDriftCodes,
        earlyDriftSections: error.earlyDriftSections,
        blockedAddedFeatures: error.blockedAddedFeatures,
        earlySemanticLintCodes: error.earlySemanticLintCodes,
        earlyRepairAttempted: error.earlyRepairAttempted,
        earlyRepairApplied: error.earlyRepairApplied,
        primaryEarlyDriftReason: error.primaryEarlyDriftReason,
      }),
      finalContent: degradedCompiledContent,
      compiledContent: degradedCompiledContent,
      compiledStructure: degradedCompiledStructure,
      quality: error.quality,
    };
  }

  if (error instanceof PrdCompilerRuntimeError) {
    const degradedCompiledContent = error.degradedCandidateAvailable ? (error.compiledContent || null) : null;
    const degradedCompiledStructure = error.degradedCandidateAvailable ? (error.compiledStructure || null) : null;
    return {
      qualityStatus: 'failed_runtime',
      message,
      diagnostics: buildCompilerRunDiagnostics({
        quality: null,
        repairAttempts: error.repairAttempts.length,
        base: {
          ...(base || {}),
          repairModelIds: error.repairAttempts.map(attempt => attempt.model).filter(Boolean),
          reviewerModelIds: error.reviewerAttempts.map(attempt => attempt.model).filter(Boolean),
        },
        failureStage: error.failureStage,
        compilerRepairTruncationCount: error.compilerRepairTruncationCount,
        compilerRepairFinishReasons: error.compilerRepairFinishReasons,
        degradedCandidateAvailable: error.degradedCandidateAvailable,
        degradedCandidateSource: error.degradedCandidateSource,
        runtimeFailureCode: error.runtimeFailureCode,
        providerFailureSummary: error.providerFailureSummary,
        providerFailureCounts: error.providerFailureCounts,
        providerFailedModels: error.providerFailedModels,
        providerFailureStage: error.providerFailureStage,
      }),
      finalContent: degradedCompiledContent,
      compiledContent: degradedCompiledContent,
      compiledStructure: degradedCompiledStructure,
      quality: null,
    };
  }

  const providerFailureDiagnostics = parseProviderFailureDiagnostics(message);
  if (providerFailureDiagnostics) {
    const providerFailureStage = (() => {
      const phase = String(base?.lastModelAttempt?.phase || base?.activePhase || '').trim();
      if (phase === 'content_review' || phase === 'semantic_repair' || phase === 'final_review') return phase;
      if (phase === 'semantic_verification' || phase === 'semantic_verifier') return 'semantic_verification';
      return 'compiler_repair';
    })();
    const failureStage: FinalizerFailureStage =
      providerFailureStage === 'content_review'
        ? 'content_review'
        : providerFailureStage === 'semantic_verification' || providerFailureStage === 'semantic_repair'
          ? 'semantic_verifier'
          : 'compiler_repair';
    return {
      qualityStatus: 'failed_runtime',
      message,
      diagnostics: buildCompilerRunDiagnostics({
        quality: null,
        repairAttempts: 0,
        base,
        failureStage,
        runtimeFailureCode: providerFailureDiagnostics.runtimeFailureCode,
        providerFailureSummary: providerFailureDiagnostics.providerFailureSummary,
        providerFailureCounts: providerFailureDiagnostics.providerFailureCounts,
        providerFailedModels: providerFailureDiagnostics.providerFailedModels,
        providerFailureStage,
      }),
      finalContent: null,
      compiledContent: null,
      compiledStructure: null,
      quality: null,
    };
  }

  const qualityLikeMessage = normalized.includes('quality gate') || normalized.includes('compiler finalization');
  if (qualityLikeMessage) {
    return {
      qualityStatus: 'failed_quality',
      message,
      diagnostics: buildCompilerRunDiagnostics({ quality: null, repairAttempts: 0, base }),
      finalContent: null,
      compiledContent: null,
      compiledStructure: null,
      quality: null,
    };
  }

  return {
    qualityStatus: 'failed_runtime',
    message,
    diagnostics: buildCompilerRunDiagnostics({ quality: null, repairAttempts: 0, base }),
    finalContent: null,
    compiledContent: null,
    compiledStructure: null,
    quality: null,
  };
}

export function mergeDiagnosticsIntoIterationLog(
  existingIterationLog: string | null | undefined,
  qualityStatus: PrdQualityStatus,
  diagnostics: CompilerRunDiagnostics
): string {
  const existing = String(existingIterationLog || '').trim();
  const payload = {
    qualityStatus,
    finalizationStage: 'final',
    errorCount: diagnostics.errorCount,
    warningCount: diagnostics.warningCount,
    repairAttempts: diagnostics.repairAttempts,
    topRootCauseCodes: diagnostics.topRootCauseCodes,
    qualityIssueCodes: diagnostics.qualityIssueCodes,
    qualityIssues: diagnostics.qualityIssues || [],
    failureStage: diagnostics.failureStage || null,
    semanticVerifierVerdict: diagnostics.semanticVerifierVerdict || null,
    primaryGateReason: diagnostics.primaryGateReason || null,
    structuralParseReason: diagnostics.structuralParseReason || null,
    rawFeatureHeadingSamples: diagnostics.rawFeatureHeadingSamples || [],
    normalizationApplied: typeof diagnostics.normalizationApplied === 'boolean' ? diagnostics.normalizationApplied : null,
    normalizedFeatureCountRecovered: typeof diagnostics.normalizedFeatureCountRecovered === 'number'
      ? diagnostics.normalizedFeatureCountRecovered
      : null,
    primaryCapabilityAnchors: diagnostics.primaryCapabilityAnchors || [],
    featurePriorityWindow: diagnostics.featurePriorityWindow || [],
    coreFeatureIds: diagnostics.coreFeatureIds || [],
    supportFeatureIds: diagnostics.supportFeatureIds || [],
    canonicalFeatureIds: diagnostics.canonicalFeatureIds || [],
    timelineMismatchedFeatureIds: diagnostics.timelineMismatchedFeatureIds || [],
    timelineRewrittenFromFeatureMap:
      typeof diagnostics.timelineRewrittenFromFeatureMap === 'boolean'
        ? diagnostics.timelineRewrittenFromFeatureMap
        : null,
    timelineRewriteAppliedLines:
      typeof diagnostics.timelineRewriteAppliedLines === 'number'
        ? diagnostics.timelineRewriteAppliedLines
        : null,
    semanticBlockingCodes: diagnostics.semanticBlockingCodes || [],
    semanticBlockingIssues: diagnostics.semanticBlockingIssues || [],
    initialSemanticBlockingIssues: diagnostics.initialSemanticBlockingIssues || [],
    postRepairSemanticBlockingIssues: diagnostics.postRepairSemanticBlockingIssues || [],
    finalSemanticBlockingIssues: diagnostics.finalSemanticBlockingIssues || [],
    semanticRepairApplied: !!diagnostics.semanticRepairApplied,
    semanticRepairAttempted: !!diagnostics.semanticRepairAttempted,
    semanticRepairIssueCodes: diagnostics.semanticRepairIssueCodes || [],
    semanticRepairSectionKeys: diagnostics.semanticRepairSectionKeys || [],
    semanticRepairTruncated: !!diagnostics.semanticRepairTruncated,
    repairGapReason: diagnostics.repairGapReason || null,
    repairCycleCount: diagnostics.repairCycleCount || 0,
    compilerRepairTruncationCount: diagnostics.compilerRepairTruncationCount || 0,
    compilerRepairFinishReasons: diagnostics.compilerRepairFinishReasons || [],
    repairRejected: !!diagnostics.repairRejected,
    repairRejectedReason: diagnostics.repairRejectedReason || null,
    repairDegradationSignals: diagnostics.repairDegradationSignals || [],
    degradedCandidateAvailable: !!diagnostics.degradedCandidateAvailable,
    degradedCandidateSource: diagnostics.degradedCandidateSource || null,
    displayedCandidateSource: diagnostics.displayedCandidateSource || null,
    diagnosticsAlignedWithDisplayedCandidate:
      typeof diagnostics.diagnosticsAlignedWithDisplayedCandidate === 'boolean'
        ? diagnostics.diagnosticsAlignedWithDisplayedCandidate
        : null,
    collapsedFeatureNameIds: diagnostics.collapsedFeatureNameIds || [],
    placeholderFeatureIds: diagnostics.placeholderFeatureIds || [],
    acceptanceBoilerplateFeatureIds: diagnostics.acceptanceBoilerplateFeatureIds || [],
    featureQualityFloorFeatureIds: diagnostics.featureQualityFloorFeatureIds || [],
    featureQualityFloorFailedFeatureIds: diagnostics.featureQualityFloorFailedFeatureIds || [],
    featureQualityFloorPassed: typeof diagnostics.featureQualityFloorPassed === 'boolean' ? diagnostics.featureQualityFloorPassed : null,
    primaryFeatureQualityReason: diagnostics.primaryFeatureQualityReason || null,
    emptyMainFlowFeatureIds: diagnostics.emptyMainFlowFeatureIds || [],
    placeholderPurposeFeatureIds: diagnostics.placeholderPurposeFeatureIds || [],
    placeholderAlternateFlowFeatureIds: diagnostics.placeholderAlternateFlowFeatureIds || [],
    thinAcceptanceCriteriaFeatureIds: diagnostics.thinAcceptanceCriteriaFeatureIds || [],
    semanticRepairChangedSections: diagnostics.semanticRepairChangedSections || [],
    semanticRepairStructuralChange: !!diagnostics.semanticRepairStructuralChange,
    earlyDriftDetected: !!diagnostics.earlyDriftDetected,
    earlyDriftCodes: diagnostics.earlyDriftCodes || [],
    earlyDriftSections: diagnostics.earlyDriftSections || [],
    blockedAddedFeatures: diagnostics.blockedAddedFeatures || [],
    earlySemanticLintCodes: diagnostics.earlySemanticLintCodes || [],
    earlyRepairAttempted: !!diagnostics.earlyRepairAttempted,
    earlyRepairApplied: !!diagnostics.earlyRepairApplied,
    primaryEarlyDriftReason: diagnostics.primaryEarlyDriftReason || null,
    runtimeFailureCode: diagnostics.runtimeFailureCode || null,
    providerFailureSummary: diagnostics.providerFailureSummary || null,
    providerFailureCounts: diagnostics.providerFailureCounts || null,
    providerFailedModels: diagnostics.providerFailedModels || [],
    providerFailureStage: diagnostics.providerFailureStage || null,
    repairModelIds: diagnostics.repairModelIds || [],
    reviewerModelIds: diagnostics.reviewerModelIds || [],
    verifierModelIds: diagnostics.verifierModelIds || [],
    contentRefined: !!diagnostics.contentRefined,
    contentReviewIssueCodes: diagnostics.contentReviewIssueCodes || [],
    semanticVerifierSameFamilyFallback: !!diagnostics.semanticVerifierSameFamilyFallback,
    semanticVerifierBlockedFamilies: diagnostics.semanticVerifierBlockedFamilies || [],
    activePhase: diagnostics.activePhase || null,
    lastProgressEvent: diagnostics.lastProgressEvent || null,
    lastModelAttempt: diagnostics.lastModelAttempt || null,
    boilerplateHits: diagnostics.boilerplateHits || 0,
    metaLeakHits: diagnostics.metaLeakHits || 0,
    languageFixRequired: !!diagnostics.languageFixRequired,
    aggregatedFeatureCount: diagnostics.aggregatedFeatureCount || 0,
    at: new Date().toISOString(),
  };
  const marker = `<!-- compiler-run:${JSON.stringify(payload)} -->`;
  return [existing, marker].filter(Boolean).join('\n\n').trim();
}
