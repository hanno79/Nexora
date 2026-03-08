import type { TokenUsage } from '@shared/schema';
import type { PrdQualityReport } from './prdCompiler';
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
  repairModelIds: string[];
  reviewerModelIds: string[];
  verifierModelIds: string[];
  semanticVerifierSameFamilyFallback: boolean;
  semanticVerifierBlockedFamilies: string[];
  contentReviewIssueCodes: string[];
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
    repairModelIds: Array.from(new Set((result.repairAttempts || []).map(attempt => attempt.model).filter(Boolean))),
    reviewerModelIds: Array.from(new Set((result.reviewerAttempts || []).map(attempt => attempt.model).filter(Boolean))),
    verifierModelIds: Array.from(new Set(semanticHistory.map(entry => entry.model).filter(Boolean))),
    semanticVerifierSameFamilyFallback: semanticHistory.some(entry => entry.sameFamilyFallback),
    semanticVerifierBlockedFamilies: semanticBlockedFamilies,
    contentReviewIssueCodes: Array.from(new Set(
      (result.contentReview?.issues || []).map(issue => issue.code).filter(Boolean)
    )),
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
    semanticVerifierVerdict: semanticVerification?.verdict,
    semanticBlockingCodes: semanticVerification?.blockingIssues?.map(issue => issue.code) || [],
    semanticRepairApplied: !!summary.semanticRepairApplied,
    semanticVerifierSameFamilyFallback: summary.semanticVerifierSameFamilyFallback,
    semanticVerifierBlockedFamilies: summary.semanticVerifierBlockedFamilies,
  };
}
