import type { TokenUsage } from '@shared/schema';
import type { PRDStructure } from './prdStructure';
import {
  compilePrdDocument,
  type CompilePrdDocumentFn,
  type PrdQualityReport,
} from './prdCompiler';
import {
  applySemanticPatchRefinement,
  applyTargetedContentRefinement,
  reviewAndRefineContent,
  type ContentIssue,
  type ContentReviewResult,
  type ReviewerContentGenerator,
  type ReviewerRefineResult,
} from './prdContentReviewer';
import type {
  SemanticBlockingIssue,
  SemanticVerificationResult,
  SemanticVerifierInput,
} from './prdSemanticVerifier';
import {
  buildRepairPrompt,
  type RepairHistoryEntry,
} from './prdCompilerRepairPrompt';
import { buildAvoidedModelFamilies } from './modelFamily';

type SupportedLanguage = 'de' | 'en';
export type FinalizerFailureStage = 'compiler_repair' | 'content_review' | 'semantic_verifier' | 'early_drift';
export type RepairGapReason =
  | 'emergent_issue_after_repair'
  | 'same_issues_persisted'
  | 'repair_no_structural_change'
  | 'repair_budget_exhausted';

export type {
  SemanticBlockingIssue,
  SemanticVerificationResult,
  SemanticVerifierInput,
} from './prdSemanticVerifier';

export interface CompilerModelResult {
  content: string;
  model: string;
  usage: TokenUsage;
  finishReason?: string;
}

export interface FinalizeWithCompilerGatesOptions {
  initialResult: CompilerModelResult;
  mode: 'generate' | 'improve';
  existingContent?: string;
  language?: SupportedLanguage;
  templateCategory?: string;
  originalRequest: string;
  maxRepairPasses?: number;
  repairReviewer: (repairPrompt: string, pass: number) => Promise<CompilerModelResult>;
  compileDocument?: CompilePrdDocumentFn;
  /** Enable post-compiler content review to detect and fix filler/repetition. Default: true. */
  enableContentReview?: boolean;
  /** Reviewer for the targeted content-refine AI call. If not provided, content review runs
   *  in analysis-only mode (issues reported but no AI refinement). */
  contentRefineReviewer?: ReviewerContentGenerator;
  /** Reviewer for targeted semantic repair patches after verifier blocking issues. */
  semanticRefineReviewer?: ReviewerContentGenerator;
  /** Independent semantic verifier that runs after compiler/content review. */
  semanticVerifier?: (input: SemanticVerifierInput) => Promise<SemanticVerificationResult>;
  onStageProgress?: (event: {
    type: 'content_review_start' | 'semantic_verification_start' | 'semantic_repair_start' | 'semantic_repair_done';
    issueCount?: number;
    sectionKeys?: string[];
    applied?: boolean;
    truncated?: boolean;
  }) => void;
}

export interface FinalizeWithCompilerGatesResult {
  content: string;
  structure: PRDStructure;
  quality: PrdQualityReport;
  qualityScore: number;
  repairAttempts: CompilerModelResult[];
  reviewerAttempts: ReviewerRefineResult[];
  /** Content review results (populated when enableContentReview is true). */
  contentReview?: ContentReviewResult;
  /** Whether the content was refined by AI after content review. */
  contentRefined?: boolean;
  semanticVerification?: SemanticVerificationResult;
  semanticVerificationHistory?: SemanticVerificationResult[];
  semanticRepairApplied?: boolean;
  semanticRepairAttempted?: boolean;
  semanticRepairIssueCodes?: string[];
  semanticRepairSectionKeys?: string[];
  semanticRepairTruncated?: boolean;
  initialSemanticBlockingIssues?: SemanticBlockingIssue[];
  postRepairSemanticBlockingIssues?: SemanticBlockingIssue[];
  finalSemanticBlockingIssues?: SemanticBlockingIssue[];
  repairGapReason?: RepairGapReason;
  repairCycleCount?: number;
  earlySemanticLintCodes?: string[];
}

export class PrdCompilerQualityError extends Error {
  readonly quality: PrdQualityReport;
  readonly repairAttempts: CompilerModelResult[];
  readonly reviewerAttempts: ReviewerRefineResult[];
  readonly compiledContent?: string;
  readonly compiledStructure?: PRDStructure;
  readonly semanticVerification?: SemanticVerificationResult;
  readonly failureStage: FinalizerFailureStage;
  readonly semanticRepairApplied: boolean;
  readonly semanticRepairAttempted: boolean;
  readonly semanticRepairIssueCodes: string[];
  readonly semanticRepairSectionKeys: string[];
  readonly semanticRepairTruncated: boolean;
  readonly initialSemanticBlockingIssues: SemanticBlockingIssue[];
  readonly postRepairSemanticBlockingIssues: SemanticBlockingIssue[];
  readonly finalSemanticBlockingIssues: SemanticBlockingIssue[];
  readonly repairGapReason?: RepairGapReason;
  readonly repairCycleCount: number;
  readonly earlySemanticLintCodes: string[];
  readonly earlyDriftDetected: boolean;
  readonly earlyDriftCodes: string[];
  readonly earlyDriftSections: string[];
  readonly blockedAddedFeatures: string[];
  readonly earlyRepairAttempted: boolean;
  readonly earlyRepairApplied: boolean;
  readonly primaryEarlyDriftReason?: string;

  constructor(
    message: string,
    quality: PrdQualityReport,
    repairAttempts: CompilerModelResult[],
    compiledResult?: { content: string; structure: PRDStructure },
    meta?: {
      reviewerAttempts?: ReviewerRefineResult[];
      semanticVerification?: SemanticVerificationResult;
      failureStage?: FinalizerFailureStage;
      semanticRepairApplied?: boolean;
      semanticRepairAttempted?: boolean;
      semanticRepairIssueCodes?: string[];
      semanticRepairSectionKeys?: string[];
      semanticRepairTruncated?: boolean;
      initialSemanticBlockingIssues?: SemanticBlockingIssue[];
      postRepairSemanticBlockingIssues?: SemanticBlockingIssue[];
      finalSemanticBlockingIssues?: SemanticBlockingIssue[];
      repairGapReason?: RepairGapReason;
      repairCycleCount?: number;
      earlySemanticLintCodes?: string[];
      earlyDriftDetected?: boolean;
      earlyDriftCodes?: string[];
      earlyDriftSections?: string[];
      blockedAddedFeatures?: string[];
      earlyRepairAttempted?: boolean;
      earlyRepairApplied?: boolean;
      primaryEarlyDriftReason?: string;
    }
  ) {
    super(message);
    this.name = 'PrdCompilerQualityError';
    this.quality = quality;
    this.repairAttempts = repairAttempts;
    this.reviewerAttempts = meta?.reviewerAttempts || [];
    this.compiledContent = compiledResult?.content;
    this.compiledStructure = compiledResult?.structure;
    this.semanticVerification = meta?.semanticVerification;
    this.failureStage = meta?.failureStage || 'compiler_repair';
    this.semanticRepairApplied = meta?.semanticRepairApplied ?? false;
    this.semanticRepairAttempted = meta?.semanticRepairAttempted ?? false;
    this.semanticRepairIssueCodes = meta?.semanticRepairIssueCodes || [];
    this.semanticRepairSectionKeys = meta?.semanticRepairSectionKeys || [];
    this.semanticRepairTruncated = meta?.semanticRepairTruncated ?? false;
    this.initialSemanticBlockingIssues = meta?.initialSemanticBlockingIssues || [];
    this.postRepairSemanticBlockingIssues = meta?.postRepairSemanticBlockingIssues || [];
    this.finalSemanticBlockingIssues = meta?.finalSemanticBlockingIssues || [];
    this.repairGapReason = meta?.repairGapReason;
    this.repairCycleCount = meta?.repairCycleCount ?? 0;
    this.earlySemanticLintCodes = meta?.earlySemanticLintCodes || [];
    this.earlyDriftDetected = meta?.earlyDriftDetected ?? false;
    this.earlyDriftCodes = meta?.earlyDriftCodes || [];
    this.earlyDriftSections = meta?.earlyDriftSections || [];
    this.blockedAddedFeatures = meta?.blockedAddedFeatures || [];
    this.earlyRepairAttempted = meta?.earlyRepairAttempted ?? false;
    this.earlyRepairApplied = meta?.earlyRepairApplied ?? false;
    this.primaryEarlyDriftReason = meta?.primaryEarlyDriftReason;
  }
}

export function qualityScore(quality: PrdQualityReport): number {
  let score = 100;
  for (const issue of quality.issues) {
    score -= issue.severity === 'error' ? 10 : 3;
  }
  if (quality.truncatedLikely) score -= 15;
  score -= (quality.missingSections?.length || 0) * 5;
  score -= (quality.fallbackSections?.length || 0) * 3;
  score += Math.min(20, (quality.featureCount || 0) * 2);
  return score;
}

function hasQualityIssue(quality: PrdQualityReport, code: string): boolean {
  return quality.issues.some(issue => issue.code === code);
}

function hasContentReviewError(review: ContentReviewResult | undefined, code: string): boolean {
  return Boolean(review?.issues.some(issue => issue.severity === 'error' && issue.code === code));
}

function shouldRepair(
  _result: CompilerModelResult,
  quality: PrdQualityReport,
  mode: 'generate' | 'improve'
): boolean {
  if (!quality.valid) return true;
  if (quality.truncatedLikely) return true;

  // ÄNDERUNG 08.03.2026: Generate-Ergebnisse mit massiv compilerseitig
  // erzeugten Fallback-Sektionen duerfen nicht still als final akzeptiert
  // werden. Sie muessen in den Repair-/Fehlerpfad laufen.
  if (mode === 'generate' && hasQualityIssue(quality, 'excessive_fallback_sections')) {
    return true;
  }

  // If the compiler produced a valid, non-truncated structure, accept it even
  // when the raw model output looked syntactically incomplete (finish_reason='length').
  return false;
}

function toSemanticContentIssues(issues: SemanticBlockingIssue[]): ContentIssue[] {
  return issues.map(issue => {
    const sectionKey = String(issue.sectionKey || '').trim() || 'systemVision';
    const isFeatureIssue = sectionKey.startsWith('feature:');
    const targetFields = issue.targetFields?.length
      ? issue.targetFields.join(', ')
      : '';
    const baseMessage = String(issue.message || '').trim()
      || (isFeatureIssue
        ? `Feature block "${sectionKey}" contains a blocking semantic mismatch.`
        : `Section "${sectionKey}" contains a blocking semantic inconsistency.`);
    const message = isFeatureIssue && targetFields && !/Rewrite:\s/i.test(baseMessage)
      ? `${baseMessage} Rewrite: ${targetFields}`
      : baseMessage;

    return {
      code: issue.code || 'cross_section_inconsistency',
      sectionKey,
      message,
      severity: 'error',
      suggestedAction: issue.suggestedAction || (isFeatureIssue ? 'enrich' : 'rewrite'),
      ...(issue.targetFields?.length ? { targetFields: issue.targetFields } : {}),
    };
  });
}

function cloneSemanticBlockingIssues(issues: SemanticBlockingIssue[] | undefined): SemanticBlockingIssue[] {
  if (!Array.isArray(issues)) return [];
  return issues.map(issue => ({
    code: String(issue.code || '').trim() || 'cross_section_inconsistency',
    sectionKey: String(issue.sectionKey || '').trim() || 'systemVision',
    message: String(issue.message || '').trim() || 'Blocking semantic inconsistency.',
    suggestedAction: issue.suggestedAction || (String(issue.sectionKey || '').trim().startsWith('feature:') ? 'enrich' : 'rewrite'),
    ...(issue.targetFields?.length ? { targetFields: Array.from(new Set(issue.targetFields)) } : {}),
  }));
}

function blockingIssuePairSignature(issues: SemanticBlockingIssue[] | undefined): string[] {
  return Array.from(new Set(
    cloneSemanticBlockingIssues(issues)
      .map(issue => `${issue.sectionKey}::${issue.code}`)
      .filter(Boolean)
  )).sort();
}

function determineRepairGapReason(params: {
  beforeRepair: SemanticBlockingIssue[];
  afterRepair: SemanticBlockingIssue[];
  changed: boolean;
  exhaustedBudget?: boolean;
}): RepairGapReason {
  if (!params.changed) {
    return 'repair_no_structural_change';
  }

  const beforePairs = blockingIssuePairSignature(params.beforeRepair);
  const afterPairs = blockingIssuePairSignature(params.afterRepair);
  if (
    beforePairs.length === afterPairs.length
    && beforePairs.every((pair, index) => pair === afterPairs[index])
  ) {
    return 'same_issues_persisted';
  }

  const hasEmergentIssue = afterPairs.some(pair => !beforePairs.includes(pair));
  if (hasEmergentIssue) {
    return 'emergent_issue_after_repair';
  }

  if (params.exhaustedBudget) {
    return 'repair_budget_exhausted';
  }

  return 'same_issues_persisted';
}

function withSyntheticQualityIssue(
  quality: PrdQualityReport,
  issue: { code: string; message: string; severity: 'error' | 'warning' }
): PrdQualityReport {
  return {
    ...quality,
    valid: false,
    issues: [...quality.issues, issue],
  };
}

export async function finalizeWithCompilerGates(
  options: FinalizeWithCompilerGatesOptions
): Promise<FinalizeWithCompilerGatesResult> {
  const {
    initialResult,
    mode,
    existingContent,
    language,
    templateCategory,
    originalRequest,
    repairReviewer,
    maxRepairPasses = 2,
    compileDocument = compilePrdDocument,
  } = options;

  let current = initialResult;
  const compileCurrent = (content: string) =>
    compileDocument(content, {
      mode,
      existingContent,
      language,
      templateCategory,
      strictCanonical: true,
      strictLanguageConsistency: true,
      enableFeatureAggregation: true,
      contextHint: originalRequest,
    });

  let compiled = compileCurrent(current.content);
  let needsRepair = shouldRepair(current, compiled.quality, mode);
  const repairAttempts: CompilerModelResult[] = [];
  const reviewerAttempts: ReviewerRefineResult[] = [];
  const semanticVerificationHistory: SemanticVerificationResult[] = [];

  // Track best result across repair passes to prevent quality degradation
  let bestCurrent = current;
  let bestCompiled = compiled;
  let bestScore = qualityScore(compiled.quality);
  let degradationCount = 0;

  const repairHistory: RepairHistoryEntry[] = [];

  for (let pass = 1; pass <= maxRepairPasses && needsRepair; pass++) {
    const issueSummary = bestCompiled.quality.issues.map(i => `- ${i.message}`).join('\n') || '- Unknown quality issue';
    const repairPrompt = buildRepairPrompt({
      mode,
      issueSummary,
      existingContent,
      currentContent: bestCurrent.content,
      currentStructure: bestCompiled.structure,
      originalRequest,
      templateCategory,
      language,
      repairHistory,
    });

    const repairResult = await repairReviewer(repairPrompt, pass);
    repairAttempts.push(repairResult);
    const repairCompiled = compileCurrent(repairResult.content);
    const repairScore = qualityScore(repairCompiled.quality);

    repairHistory.push({
      pass,
      score: repairScore,
      issueCount: repairCompiled.quality.issues.length,
      topIssues: repairCompiled.quality.issues.slice(0, 3).map(i => i.code),
    });

    if (repairScore > bestScore) {
      bestCurrent = repairResult;
      bestCompiled = repairCompiled;
      bestScore = repairScore;
      degradationCount = 0;
    } else {
      degradationCount++;
      if (degradationCount >= 2) break; // repairs are not helping, abort early
    }

    current = bestCurrent;
    compiled = bestCompiled;
    needsRepair = shouldRepair(current, compiled.quality, mode);
  }

  if (needsRepair) {
    const errorIssues = compiled.quality.issues.filter(i => i.severity === 'error');
    const details = errorIssues.map(i => i.message).join(' | ') || 'Unknown quality issue.';
    throw new PrdCompilerQualityError(
      `PRD compiler quality gate failed after ${repairAttempts.length} repair attempt(s): ${details}`,
      compiled.quality,
      repairAttempts,
      { content: compiled.content, structure: compiled.structure },
      { failureStage: 'compiler_repair' }
    );
  }

  // --- Content Review & Refine (post-compiler pass) ---
  const enableContentReview = options.enableContentReview !== false;
  let contentReview: ContentReviewResult | undefined;
  let contentRefined = false;
  let semanticVerification: SemanticVerificationResult | undefined;
  let semanticRepairApplied = false;
  let semanticRepairAttempted = false;
  let semanticRepairIssueCodes: string[] = [];
  let semanticRepairSectionKeys: string[] = [];
  let semanticRepairTruncated = false;
  let initialSemanticBlockingIssues: SemanticBlockingIssue[] = [];
  let postRepairSemanticBlockingIssues: SemanticBlockingIssue[] = [];
  let finalSemanticBlockingIssues: SemanticBlockingIssue[] = [];
  let repairGapReason: RepairGapReason | undefined;
  let repairCycleCount = 0;

  if (enableContentReview) {
    options.onStageProgress?.({ type: 'content_review_start' });
    const refineResult = await reviewAndRefineContent({
      content: compiled.content,
      structure: compiled.structure,
      language: language || 'en',
      templateCategory,
      fallbackSections: compiled.quality.fallbackSections,
      reviewer: options.contentRefineReviewer,
    });

    contentReview = refineResult.reviewResult;
    contentRefined = refineResult.refined;
    reviewerAttempts.push(...(refineResult.reviewerAttempts || []));

    if (refineResult.refined) {
      // Re-compile the refined content to ensure structural integrity
      const recompiled = compileCurrent(refineResult.content);
      if (recompiled.quality.valid || qualityScore(recompiled.quality) >= bestScore) {
        compiled = recompiled;
        bestScore = Math.max(bestScore, qualityScore(recompiled.quality));
      }
      // If recompile degraded quality, keep the pre-refinement version
    }
  }

  const shouldBlockExcessiveFallbackReview = Boolean(
    options.contentRefineReviewer
    && hasQualityIssue(compiled.quality, 'excessive_fallback_sections')
    && hasContentReviewError(contentReview, 'compiler_fallback_filler')
  );

  if (shouldBlockExcessiveFallbackReview) {
    // ÄNDERUNG 07.03.2026: Den kompilierten Fehlstand im Error mitführen, damit
    // degradierte Fallback-Pfade nicht den rohen Repair-Text statt des echten
    // Compiler-Ergebnisses zurückgeben.
    const blockedQuality = withSyntheticQualityIssue(compiled.quality, {
      code: 'content_review_blocked_excessive_fallback',
      message: 'Content review still detected compiler-generated fallback filler after refinement attempts.',
      severity: 'error',
    });
    throw new PrdCompilerQualityError(
      'PRD compiler quality gate failed after content review: compiler-generated fallback filler remains.',
      blockedQuality,
      repairAttempts,
      { content: compiled.content, structure: compiled.structure },
      {
        reviewerAttempts,
        failureStage: 'content_review',
      }
    );
  }

  if (options.semanticVerifier) {
    const runSemanticVerifier = async () => {
      options.onStageProgress?.({ type: 'semantic_verification_start' });
      const avoidModelFamilies = buildAvoidedModelFamilies([
        initialResult.model,
        ...repairAttempts.map(attempt => attempt.model),
        ...reviewerAttempts.map(attempt => attempt.model),
      ]);
      const result = await options.semanticVerifier!({
        content: compiled.content,
        structure: compiled.structure,
        mode,
        existingContent,
        language: language || 'en',
        templateCategory,
        originalRequest,
        avoidModelFamilies,
      });
      semanticVerification = result;
      semanticVerificationHistory.push(result);
      return result;
    };

    let verification = await runSemanticVerifier();
    finalSemanticBlockingIssues = cloneSemanticBlockingIssues(verification.blockingIssues);
    const semanticRepairReviewer = options.semanticRefineReviewer || options.contentRefineReviewer;
    const maxSemanticRepairCycles = semanticRepairReviewer ? 2 : 0;

    if (verification.verdict === 'fail' && verification.blockingIssues.length > 0) {
      initialSemanticBlockingIssues = cloneSemanticBlockingIssues(verification.blockingIssues);
    }

    while (
      verification.verdict === 'fail'
      && verification.blockingIssues.length > 0
      && repairCycleCount < maxSemanticRepairCycles
      && semanticRepairReviewer
    ) {
      const beforeRepairIssues = cloneSemanticBlockingIssues(verification.blockingIssues);
      const semanticIssues = toSemanticContentIssues(beforeRepairIssues);
      semanticRepairAttempted = true;
      repairCycleCount += 1;
      semanticRepairIssueCodes = Array.from(new Set([
        ...semanticRepairIssueCodes,
        ...semanticIssues.map(issue => issue.code).filter(Boolean),
      ]));
      semanticRepairSectionKeys = Array.from(new Set([
        ...semanticRepairSectionKeys,
        ...semanticIssues.map(issue => issue.sectionKey).filter(Boolean),
      ]));
      options.onStageProgress?.({
        type: 'semantic_repair_start',
        issueCount: beforeRepairIssues.length,
        sectionKeys: semanticIssues.map(issue => issue.sectionKey).filter(Boolean),
      });
      const semanticRepair = await applySemanticPatchRefinement({
        content: compiled.content,
        structure: compiled.structure,
        issues: semanticIssues,
        language: language || 'en',
        templateCategory,
        originalRequest,
        reviewer: semanticRepairReviewer,
      });
      reviewerAttempts.push(...semanticRepair.reviewerAttempts);
      semanticRepairTruncated = semanticRepairTruncated || semanticRepair.truncated;
      options.onStageProgress?.({
        type: 'semantic_repair_done',
        issueCount: beforeRepairIssues.length,
        sectionKeys: semanticIssues.map(issue => issue.sectionKey).filter(Boolean),
        applied: semanticRepair.refined,
        truncated: semanticRepair.truncated,
      });

      if (!semanticRepair.refined) {
        repairGapReason = determineRepairGapReason({
          beforeRepair: beforeRepairIssues,
          afterRepair: beforeRepairIssues,
          changed: false,
          exhaustedBudget: repairCycleCount >= maxSemanticRepairCycles,
        });
        if (repairCycleCount === 1) {
          postRepairSemanticBlockingIssues = cloneSemanticBlockingIssues(beforeRepairIssues);
        }
        finalSemanticBlockingIssues = cloneSemanticBlockingIssues(beforeRepairIssues);
        break;
      }

      const recompiled = compileCurrent(semanticRepair.content);
      if (!(recompiled.quality.valid || qualityScore(recompiled.quality) >= bestScore)) {
        repairGapReason = determineRepairGapReason({
          beforeRepair: beforeRepairIssues,
          afterRepair: beforeRepairIssues,
          changed: false,
          exhaustedBudget: repairCycleCount >= maxSemanticRepairCycles,
        });
        if (repairCycleCount === 1) {
          postRepairSemanticBlockingIssues = cloneSemanticBlockingIssues(beforeRepairIssues);
        }
        finalSemanticBlockingIssues = cloneSemanticBlockingIssues(beforeRepairIssues);
        break;
      }

      compiled = recompiled;
      bestScore = Math.max(bestScore, qualityScore(recompiled.quality));
      semanticRepairApplied = true;
      verification = await runSemanticVerifier();
      finalSemanticBlockingIssues = cloneSemanticBlockingIssues(verification.blockingIssues);
      if (repairCycleCount === 1) {
        postRepairSemanticBlockingIssues = cloneSemanticBlockingIssues(verification.blockingIssues);
      }

      if (verification.verdict === 'pass' || verification.blockingIssues.length === 0) {
        repairGapReason = undefined;
        break;
      }

      if (repairCycleCount >= maxSemanticRepairCycles) {
        repairGapReason = determineRepairGapReason({
          beforeRepair: beforeRepairIssues,
          afterRepair: verification.blockingIssues,
          changed: true,
          exhaustedBudget: true,
        });
        break;
      }
    }

    if (verification.verdict === 'fail' && verification.blockingIssues.length > 0) {
      const blockedQuality = withSyntheticQualityIssue(compiled.quality, {
        code: 'semantic_verifier_blocked',
        message: verification.blockingIssues.map(issue => issue.message).join(' | ') || 'Semantic verifier reported blocking issues.',
        severity: 'error',
      });
      throw new PrdCompilerQualityError(
        'PRD compiler quality gate failed after semantic verification.',
        blockedQuality,
        repairAttempts,
        { content: compiled.content, structure: compiled.structure },
      {
        reviewerAttempts,
        semanticVerification: verification,
        failureStage: 'semantic_verifier',
        semanticRepairApplied,
        semanticRepairAttempted,
        semanticRepairIssueCodes,
        semanticRepairSectionKeys,
        semanticRepairTruncated,
        initialSemanticBlockingIssues,
        postRepairSemanticBlockingIssues,
        finalSemanticBlockingIssues,
        repairGapReason,
        repairCycleCount,
      }
    );
  }
  }

  return {
    content: compiled.content,
    structure: compiled.structure,
    quality: compiled.quality,
    qualityScore: bestScore,
    repairAttempts,
    reviewerAttempts,
    contentReview,
    contentRefined,
    semanticVerification,
    semanticVerificationHistory,
    semanticRepairApplied,
    semanticRepairAttempted,
    semanticRepairIssueCodes,
    semanticRepairSectionKeys,
    semanticRepairTruncated,
    initialSemanticBlockingIssues,
    postRepairSemanticBlockingIssues,
    finalSemanticBlockingIssues,
    repairGapReason,
    repairCycleCount,
  };
}
