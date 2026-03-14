import type { TokenUsage } from '@shared/schema';
import type { PrdQualityReport } from './prdCompiler';
import type { CompilerDiagnosticIssue, CompilerDiagnostics } from './dualAiPrompts';
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
  compilerRepairTruncationCount?: number;
  compilerRepairFinishReasons?: string[];
  repairRejected?: boolean;
  repairRejectedReason?: string;
  repairDegradationSignals?: string[];
  degradedCandidateAvailable?: boolean;
  degradedCandidateSource?: FinalizeWithCompilerGatesResult['degradedCandidateSource'];
  displayedCandidateSource?: FinalizeWithCompilerGatesResult['displayedCandidateSource'];
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
}

function normalizeDiagnosticIssues(issues: Array<Record<string, any>> | undefined): CompilerDiagnosticIssue[] {
  return (issues || []).map(issue => ({
    code: String(issue.code || '').trim() || 'unknown',
    sectionKey: String(issue.sectionKey || '').trim() || 'unspecified',
    message: String(issue.message || '').trim() || 'Diagnostic issue details unavailable.',
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
    structuralParseReason: result.quality.structuralParseReason,
    rawFeatureHeadingSamples: result.quality.rawFeatureHeadingSamples,
    normalizationApplied: result.quality.normalizationApplied,
    normalizedFeatureCountRecovered: result.quality.normalizedFeatureCountRecovered,
    primaryCapabilityAnchors: result.primaryCapabilityAnchors,
    featurePriorityWindow: result.featurePriorityWindow,
    coreFeatureIds: result.coreFeatureIds,
    supportFeatureIds: result.supportFeatureIds,
    canonicalFeatureIds: result.canonicalFeatureIds,
    timelineMismatchedFeatureIds: result.timelineMismatchedFeatureIds,
    timelineRewrittenFromFeatureMap: result.timelineRewrittenFromFeatureMap,
    timelineRewriteAppliedLines: result.timelineRewriteAppliedLines,
    compilerRepairTruncationCount: result.compilerRepairTruncationCount,
    compilerRepairFinishReasons: result.compilerRepairFinishReasons,
    repairRejected: result.repairRejected,
    repairRejectedReason: result.repairRejectedReason,
    repairDegradationSignals: result.repairDegradationSignals,
    degradedCandidateAvailable: result.degradedCandidateAvailable,
    degradedCandidateSource: result.degradedCandidateSource,
    displayedCandidateSource: result.displayedCandidateSource,
    diagnosticsAlignedWithDisplayedCandidate: result.diagnosticsAlignedWithDisplayedCandidate,
    collapsedFeatureNameIds: result.collapsedFeatureNameIds,
    placeholderFeatureIds: result.placeholderFeatureIds,
    acceptanceBoilerplateFeatureIds: result.acceptanceBoilerplateFeatureIds,
    featureQualityFloorFeatureIds: result.featureQualityFloorFeatureIds,
    featureQualityFloorFailedFeatureIds: result.featureQualityFloorFailedFeatureIds,
    featureQualityFloorPassed: result.featureQualityFloorPassed,
    primaryFeatureQualityReason: result.primaryFeatureQualityReason,
    emptyMainFlowFeatureIds: result.emptyMainFlowFeatureIds,
    placeholderPurposeFeatureIds: result.placeholderPurposeFeatureIds,
    placeholderAlternateFlowFeatureIds: result.placeholderAlternateFlowFeatureIds,
    thinAcceptanceCriteriaFeatureIds: result.thinAcceptanceCriteriaFeatureIds,
    semanticRepairChangedSections: result.semanticRepairChangedSections,
    semanticRepairStructuralChange: result.semanticRepairStructuralChange,
  };
}

export function buildCompilerArtifactDiagnostics(summary: CompilerArtifactSummary): Partial<CompilerDiagnostics> {
  const semanticVerification = summary.semanticVerification;

  return {
    featureDiagnostics: {
      structuralParseReason: summary.structuralParseReason || undefined,
      rawFeatureHeadingSamples: summary.rawFeatureHeadingSamples || [],
      normalizationApplied: typeof summary.normalizationApplied === 'boolean' ? summary.normalizationApplied : undefined,
      normalizedFeatureCountRecovered: typeof summary.normalizedFeatureCountRecovered === 'number'
        ? summary.normalizedFeatureCountRecovered
        : undefined,
      primaryCapabilityAnchors: summary.primaryCapabilityAnchors || [],
      featurePriorityWindow: summary.featurePriorityWindow || [],
      coreFeatureIds: summary.coreFeatureIds || [],
      supportFeatureIds: summary.supportFeatureIds || [],
      canonicalFeatureIds: summary.canonicalFeatureIds || [],
      timelineMismatchedFeatureIds: summary.timelineMismatchedFeatureIds || [],
      timelineRewrittenFromFeatureMap: summary.timelineRewrittenFromFeatureMap,
      timelineRewriteAppliedLines: summary.timelineRewriteAppliedLines,
      collapsedFeatureNameIds: summary.collapsedFeatureNameIds || [],
      placeholderFeatureIds: summary.placeholderFeatureIds || [],
      acceptanceBoilerplateFeatureIds: summary.acceptanceBoilerplateFeatureIds || [],
      featureQualityFloorFeatureIds: summary.featureQualityFloorFeatureIds || [],
      featureQualityFloorFailedFeatureIds: summary.featureQualityFloorFailedFeatureIds || [],
      featureQualityFloorPassed: summary.featureQualityFloorPassed,
      primaryFeatureQualityReason: summary.primaryFeatureQualityReason || undefined,
      emptyMainFlowFeatureIds: summary.emptyMainFlowFeatureIds || [],
      placeholderPurposeFeatureIds: summary.placeholderPurposeFeatureIds || [],
      placeholderAlternateFlowFeatureIds: summary.placeholderAlternateFlowFeatureIds || [],
      thinAcceptanceCriteriaFeatureIds: summary.thinAcceptanceCriteriaFeatureIds || [],
    },
    generationDiagnostics: {
      contentRefined: !!summary.contentRefined,
      contentReviewIssueCodes: summary.contentReviewIssueCodes,
    },
    repairDiagnostics: {
      repairAttempts: summary.repairAttempts.length,
      repairModelIds: summary.repairModelIds,
      reviewerModelIds: summary.reviewerModelIds,
      verifierModelIds: summary.verifierModelIds,
      semanticRepairApplied: !!summary.semanticRepairApplied,
      semanticRepairAttempted: !!summary.semanticRepairAttempted,
      semanticRepairIssueCodes: summary.semanticRepairIssueCodes,
      semanticRepairSectionKeys: summary.semanticRepairSectionKeys,
      semanticRepairTruncated: !!summary.semanticRepairTruncated,
      repairGapReason: summary.repairGapReason,
      repairCycleCount: summary.repairCycleCount || 0,
      compilerRepairTruncationCount: summary.compilerRepairTruncationCount || 0,
      compilerRepairFinishReasons: summary.compilerRepairFinishReasons || [],
      repairRejected: !!summary.repairRejected,
      repairRejectedReason: summary.repairRejectedReason || undefined,
      repairDegradationSignals: summary.repairDegradationSignals || [],
      degradedCandidateAvailable: !!summary.degradedCandidateAvailable,
      degradedCandidateSource: summary.degradedCandidateSource || undefined,
      displayedCandidateSource: summary.displayedCandidateSource || undefined,
      diagnosticsAlignedWithDisplayedCandidate: summary.diagnosticsAlignedWithDisplayedCandidate,
      semanticRepairChangedSections: summary.semanticRepairChangedSections || [],
      semanticRepairStructuralChange: !!summary.semanticRepairStructuralChange,
    },
    semanticDiagnostics: {
      semanticBlockingCodes: semanticVerification?.blockingIssues?.map(issue => issue.code) || [],
      semanticBlockingIssues: summary.semanticBlockingIssues,
      initialSemanticBlockingIssues: summary.initialSemanticBlockingIssues,
      postRepairSemanticBlockingIssues: summary.postRepairSemanticBlockingIssues,
      finalSemanticBlockingIssues: summary.finalSemanticBlockingIssues,
      semanticVerifierVerdict: semanticVerification?.verdict,
      earlySemanticLintCodes: summary.earlySemanticLintCodes,
      semanticVerifierSameFamilyFallback: summary.semanticVerifierSameFamilyFallback,
      semanticVerifierBlockedFamilies: summary.semanticVerifierBlockedFamilies,
    },
  };
}
