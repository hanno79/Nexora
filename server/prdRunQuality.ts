import type { CompilerDiagnostics } from './dualAiPrompts';
import type { PrdQualityIssue, PrdQualityReport } from './prdCompiler';
import { PrdCompilerQualityError } from './prdCompilerFinalizer';

export type PrdQualityStatus = 'passed' | 'degraded' | 'failed_quality' | 'failed_runtime' | 'cancelled';
export type PrdFinalizationStage = 'intermediate' | 'final';

export interface CompilerRunDiagnostics extends CompilerDiagnostics {
  errorCount: number;
  warningCount: number;
  repairAttempts: number;
  topRootCauseCodes: string[];
  qualityIssueCodes: string[];
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
}): CompilerRunDiagnostics {
  const quality = params.quality || null;
  const issues = quality?.issues || [];
  const errorCount = severityCount(issues, 'error');
  const warningCount = severityCount(issues, 'warning');
  const languageMismatchHits = countByCodePrefix(issues, 'language_mismatch_');
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
    repairAttempts: Math.max(0, params.repairAttempts || 0),
    topRootCauseCodes: topRootCauseCodes(issues),
    qualityIssueCodes: Array.from(new Set(issues.map(issue => issue.code).filter(Boolean))),
  };

  return diagnostics;
}

export function classifyRunFailure(error: unknown): {
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
      diagnostics: buildCompilerRunDiagnostics({ quality: null, repairAttempts: 0 }),
    };
  }

  if (error instanceof PrdCompilerQualityError) {
    return {
      qualityStatus: 'failed_quality',
      message,
      diagnostics: buildCompilerRunDiagnostics({
        quality: error.quality,
        repairAttempts: error.repairAttempts.length,
      }),
    };
  }

  const qualityLikeMessage = normalized.includes('quality gate') || normalized.includes('compiler finalization');
  if (qualityLikeMessage) {
    return {
      qualityStatus: 'failed_quality',
      message,
      diagnostics: buildCompilerRunDiagnostics({ quality: null, repairAttempts: 0 }),
    };
  }

  return {
    qualityStatus: 'failed_runtime',
    message,
    diagnostics: buildCompilerRunDiagnostics({ quality: null, repairAttempts: 0 }),
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
    boilerplateHits: diagnostics.boilerplateHits || 0,
    metaLeakHits: diagnostics.metaLeakHits || 0,
    languageFixRequired: !!diagnostics.languageFixRequired,
    aggregatedFeatureCount: diagnostics.aggregatedFeatureCount || 0,
    at: new Date().toISOString(),
  };
  const marker = `<!-- compiler-run:${JSON.stringify(payload)} -->`;
  return [existing, marker].filter(Boolean).join('\n\n').trim();
}
