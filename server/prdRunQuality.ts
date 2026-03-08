import type { CompilerDiagnostics, CompilerDiagnosticIssue } from './dualAiPrompts';
import type { PrdQualityIssue, PrdQualityReport } from './prdCompiler';
import type { FinalizerFailureStage, RepairGapReason, SemanticBlockingIssue } from './prdCompilerFinalizer';
import { PrdCompilerQualityError } from './prdCompilerFinalizer';

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
  earlyDriftDetected?: boolean;
  earlyDriftCodes?: string[];
  earlyDriftSections?: string[];
  blockedAddedFeatures?: string[];
  earlySemanticLintCodes?: string[];
  earlyRepairAttempted?: boolean;
  earlyRepairApplied?: boolean;
  primaryEarlyDriftReason?: string;
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
  semanticBlockingIssues?: CompilerDiagnosticIssue[];
  repairGapReason?: RepairGapReason;
}): string | undefined {
  const repairGapSuffix = params.repairGapReason
    ? ` Repair gap: ${String(params.repairGapReason).replace(/_/g, ' ')}.`
    : '';
  const semanticBlockingIssues = params.semanticBlockingIssues || [];
  if (params.failureStage === 'semantic_verifier' && semanticBlockingIssues.length > 0) {
    const firstIssue = semanticBlockingIssues[0];
    const sections = uniqueStrings(semanticBlockingIssues.map(issue => issue.sectionKey));
    const sectionSuffix = sections.length > 0
      ? ` Affected sections: ${sections.join(', ')}.`
      : '';
    return `Semantic verifier blocked finalization: ${firstIssue.message}${sectionSuffix}${repairGapSuffix}`;
  }

  const topRootCauseCodes = uniqueStrings(params.topRootCauseCodes || []);
  if (params.failureStage && topRootCauseCodes.length > 0) {
    return `Quality gate failed in ${params.failureStage}: ${topRootCauseCodes.map(humanizeDiagnosticCode).join(', ')}.${repairGapSuffix}`;
  }

  if (topRootCauseCodes.length > 0) {
    return `Quality gate failed due to ${topRootCauseCodes.map(humanizeDiagnosticCode).join(', ')}.${repairGapSuffix}`;
  }

  return undefined;
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

export function topRootCauseCodes(issues: PrdQualityIssue[], limit = 3): string[] {
  const ranked = issues
    .filter(issue => issue.severity === 'error')
    .map(issue => issue.code)
    .filter(Boolean);
  return Array.from(new Set(ranked)).slice(0, Math.max(1, limit));
}

export function buildCompilerRunDiagnostics(params: {
  quality?: PrdQualityReport | null;
  repairAttempts?: number;
  base?: Partial<CompilerDiagnostics>;
  failureStage?: FinalizerFailureStage;
  semanticVerifierVerdict?: 'pass' | 'fail';
  primaryGateReason?: string;
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
  earlyDriftDetected?: boolean;
  earlyDriftCodes?: string[];
  earlyDriftSections?: string[];
  blockedAddedFeatures?: string[];
  earlySemanticLintCodes?: string[];
  earlyRepairAttempted?: boolean;
  earlyRepairApplied?: boolean;
  primaryEarlyDriftReason?: string;
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
  const initialSemanticBlockingIssues = params.initialSemanticBlockingIssues
    || params.base?.initialSemanticBlockingIssues
    || [];
  const postRepairSemanticBlockingIssues = params.postRepairSemanticBlockingIssues
    || params.base?.postRepairSemanticBlockingIssues
    || [];
  const topCauseCodes = topRootCauseCodes(issues);
  const qualityIssueCodes = uniqueStrings(issues.map(issue => issue.code));
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
    failureStage: params.failureStage,
    semanticVerifierVerdict: params.semanticVerifierVerdict ?? params.base?.semanticVerifierVerdict,
    primaryGateReason:
      params.primaryGateReason
      || params.base?.primaryGateReason
      || buildPrimaryGateReason({
        failureStage: params.failureStage,
        topRootCauseCodes: topCauseCodes,
        semanticBlockingIssues: finalSemanticBlockingIssues,
        repairGapReason: params.repairGapReason ?? params.base?.repairGapReason,
      }),
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
} {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  const normalized = message.toLowerCase();
  const cancelled = normalized.includes('cancel') || normalized.includes('aborted');
  if (cancelled) {
    return {
      qualityStatus: 'cancelled',
      message,
      diagnostics: buildCompilerRunDiagnostics({ quality: null, repairAttempts: 0, base }),
    };
  }

  if (error instanceof PrdCompilerQualityError) {
    const finalSemanticBlockingIssues = toDiagnosticIssues(
      error.finalSemanticBlockingIssues?.length
        ? error.finalSemanticBlockingIssues
        : error.semanticVerification?.blockingIssues
    );
    const initialSemanticBlockingIssues = toDiagnosticIssues(error.initialSemanticBlockingIssues);
    const postRepairSemanticBlockingIssues = toDiagnosticIssues(error.postRepairSemanticBlockingIssues);
    return {
      qualityStatus: 'failed_quality',
      message,
      diagnostics: buildCompilerRunDiagnostics({
        quality: error.quality,
        repairAttempts: error.repairAttempts.length,
        base: {
          ...(base || {}),
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
          semanticBlockingIssues: finalSemanticBlockingIssues,
          repairGapReason: error.repairGapReason,
        }),
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
        earlyDriftDetected: error.earlyDriftDetected,
        earlyDriftCodes: error.earlyDriftCodes,
        earlyDriftSections: error.earlyDriftSections,
        blockedAddedFeatures: error.blockedAddedFeatures,
        earlySemanticLintCodes: error.earlySemanticLintCodes,
        earlyRepairAttempted: error.earlyRepairAttempted,
        earlyRepairApplied: error.earlyRepairApplied,
        primaryEarlyDriftReason: error.primaryEarlyDriftReason,
      }),
    };
  }

  const qualityLikeMessage = normalized.includes('quality gate') || normalized.includes('compiler finalization');
  if (qualityLikeMessage) {
    return {
      qualityStatus: 'failed_quality',
      message,
      diagnostics: buildCompilerRunDiagnostics({ quality: null, repairAttempts: 0, base }),
    };
  }

  return {
    qualityStatus: 'failed_runtime',
    message,
    diagnostics: buildCompilerRunDiagnostics({ quality: null, repairAttempts: 0, base }),
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
    failureStage: diagnostics.failureStage || null,
    semanticVerifierVerdict: diagnostics.semanticVerifierVerdict || null,
    primaryGateReason: diagnostics.primaryGateReason || null,
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
    earlyDriftDetected: !!diagnostics.earlyDriftDetected,
    earlyDriftCodes: diagnostics.earlyDriftCodes || [],
    earlyDriftSections: diagnostics.earlyDriftSections || [],
    blockedAddedFeatures: diagnostics.blockedAddedFeatures || [],
    earlySemanticLintCodes: diagnostics.earlySemanticLintCodes || [],
    earlyRepairAttempted: !!diagnostics.earlyRepairAttempted,
    earlyRepairApplied: !!diagnostics.earlyRepairApplied,
    primaryEarlyDriftReason: diagnostics.primaryEarlyDriftReason || null,
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
