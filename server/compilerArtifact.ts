import type { TokenUsage } from '@shared/schema';
import type { PrdQualityReport } from './prdCompiler';
import type { CompilerDiagnosticIssue } from './dualAiPrompts';
import type {
  FinalizeWithCompilerGatesResult,
  CompilerModelResult,
} from './prdCompilerFinalizer';

export interface ModelStageArtifact {
  content: string;
  model: string;
  usage: TokenUsage;
  finishReason?: string;
  tier?: string;
}

export interface CompilerArtifactSummary {
  quality: PrdQualityReport;
  qualityScore: number;
  contentReview?: FinalizeWithCompilerGatesResult['contentReview'];
  contentRefined?: boolean;
  repairAttempts: CompilerModelResult[];
  reviewerAttempts: FinalizeWithCompilerGatesResult['reviewerAttempts'];
  semanticVerification?: FinalizeWithCompilerGatesResult['semanticVerification'];
  semanticVerificationHistory: FinalizeWithCompilerGatesResult['semanticVerificationHistory'];
  semanticRepairApplied: boolean;
  semanticRepairAttempted: boolean;
  semanticRepairIssueCodes: string[];
  semanticRepairSectionKeys: string[];
  semanticRepairTruncated: boolean;
  initialSemanticBlockingIssues: CompilerDiagnosticIssue[];
  postRepairSemanticBlockingIssues: CompilerDiagnosticIssue[];
  finalSemanticBlockingIssues: CompilerDiagnosticIssue[];
  repairGapReason?: FinalizeWithCompilerGatesResult['repairGapReason'];
  repairCycleCount: number;
  earlySemanticLintCodes: string[];
  repairModelIds: string[];
  reviewerModelIds: string[];
  verifierModelIds: string[];
  semanticVerifierSameFamilyFallback: boolean;
  semanticVerifierBlockedFamilies: string[];
  contentReviewIssueCodes: string[];
  semanticBlockingIssues: CompilerDiagnosticIssue[];
}

function normalizeDiagnosticIssues(issues: Array<Record<string, any>> | undefined): CompilerDiagnosticIssue[] {
  return (issues || []).map(issue => ({
    code: String(issue.code || '').trim() || 'cross_section_inconsistency',
    sectionKey: String(issue.sectionKey || '').trim() || 'systemVision',
    message: String(issue.message || '').trim() || 'Blocking semantic inconsistency.',
    ...(issue.suggestedAction ? { suggestedAction: issue.suggestedAction } : {}),
    ...(issue.targetFields?.length ? { targetFields: Array.from(new Set(issue.targetFields)) } : {}),
  }));
}

export function summarizeFinalizerResult(
  result: FinalizeWithCompilerGatesResult
): CompilerArtifactSummary {
  const semanticHistory = result.semanticVerificationHistory || [];
  const semanticBlockedFamilies = Array.from(new Set(
    semanticHistory.flatMap(entry => entry.blockedFamilies || []).filter(Boolean)
  ));

  return {
    quality: result.quality,
    qualityScore: result.qualityScore,
    contentReview: result.contentReview,
    contentRefined: result.contentRefined,
    repairAttempts: result.repairAttempts,
    reviewerAttempts: result.reviewerAttempts || [],
    semanticVerification: result.semanticVerification,
    semanticVerificationHistory: semanticHistory,
    semanticRepairApplied: !!result.semanticRepairApplied,
    semanticRepairAttempted: !!result.semanticRepairAttempted,
    semanticRepairIssueCodes: Array.from(new Set((result.semanticRepairIssueCodes || []).filter(Boolean))),
    semanticRepairSectionKeys: Array.from(new Set((result.semanticRepairSectionKeys || []).filter(Boolean))),
    semanticRepairTruncated: !!result.semanticRepairTruncated,
    initialSemanticBlockingIssues: normalizeDiagnosticIssues(result.initialSemanticBlockingIssues),
    postRepairSemanticBlockingIssues: normalizeDiagnosticIssues(result.postRepairSemanticBlockingIssues),
    finalSemanticBlockingIssues: normalizeDiagnosticIssues(result.finalSemanticBlockingIssues),
    repairGapReason: result.repairGapReason,
    repairCycleCount: result.repairCycleCount || 0,
    earlySemanticLintCodes: Array.from(new Set((result.earlySemanticLintCodes || []).filter(Boolean))),
    repairModelIds: Array.from(new Set((result.repairAttempts || []).map(attempt => attempt.model).filter(Boolean))),
    reviewerModelIds: Array.from(new Set((result.reviewerAttempts || []).map(attempt => attempt.model).filter(Boolean))),
    verifierModelIds: Array.from(new Set(semanticHistory.map(entry => entry.model).filter(Boolean))),
    semanticVerifierSameFamilyFallback: semanticHistory.some(entry => entry.sameFamilyFallback),
    semanticVerifierBlockedFamilies: semanticBlockedFamilies,
    contentReviewIssueCodes: Array.from(new Set(
      (result.contentReview?.issues || []).map(issue => issue.code).filter(Boolean)
    )),
    semanticBlockingIssues: normalizeDiagnosticIssues(result.semanticVerification?.blockingIssues as Array<Record<string, any>> | undefined),
  };
}

export function buildCompilerArtifactDiagnostics(summary: CompilerArtifactSummary): Record<string, unknown> {
  const semanticVerification = summary.semanticVerification;

  return {
    repairAttempts: summary.repairAttempts.length,
    repairModelIds: summary.repairModelIds,
    reviewerModelIds: summary.reviewerModelIds,
    verifierModelIds: summary.verifierModelIds,
    contentRefined: !!summary.contentRefined,
    contentReviewIssueCodes: summary.contentReviewIssueCodes,
    semanticBlockingIssues: summary.semanticBlockingIssues,
    initialSemanticBlockingIssues: summary.initialSemanticBlockingIssues,
    postRepairSemanticBlockingIssues: summary.postRepairSemanticBlockingIssues,
    finalSemanticBlockingIssues: summary.finalSemanticBlockingIssues,
    semanticVerifierVerdict: semanticVerification?.verdict,
    semanticBlockingCodes: semanticVerification?.blockingIssues?.map(issue => issue.code) || [],
    semanticRepairApplied: !!summary.semanticRepairApplied,
    semanticRepairAttempted: !!summary.semanticRepairAttempted,
    semanticRepairIssueCodes: summary.semanticRepairIssueCodes,
    semanticRepairSectionKeys: summary.semanticRepairSectionKeys,
    semanticRepairTruncated: !!summary.semanticRepairTruncated,
    repairGapReason: summary.repairGapReason || null,
    repairCycleCount: summary.repairCycleCount || 0,
    earlySemanticLintCodes: summary.earlySemanticLintCodes,
    semanticVerifierSameFamilyFallback: summary.semanticVerifierSameFamilyFallback,
    semanticVerifierBlockedFamilies: summary.semanticVerifierBlockedFamilies,
  };
}
