import type { TokenUsage } from '@shared/schema';
import type { PRDStructure } from './prdStructure';
import {
  compilePrdDocument,
  type CompilePrdDocumentFn,
  type PrdQualityReport,
} from './prdCompiler';
import {
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
export type FinalizerFailureStage = 'compiler_repair' | 'content_review' | 'semantic_verifier';

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
  /** Independent semantic verifier that runs after compiler/content review. */
  semanticVerifier?: (input: SemanticVerifierInput) => Promise<SemanticVerificationResult>;
  onStageProgress?: (event: { type: 'content_review_start' | 'semantic_verification_start' }) => void;
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
    if (verification.verdict === 'fail' && verification.blockingIssues.length > 0 && options.contentRefineReviewer) {
      const semanticRepair = await applyTargetedContentRefinement({
        content: compiled.content,
        structure: compiled.structure,
        issues: toSemanticContentIssues(verification.blockingIssues),
        language: language || 'en',
        templateCategory,
        reviewer: options.contentRefineReviewer,
      });
      reviewerAttempts.push(...semanticRepair.reviewerAttempts);

      if (semanticRepair.refined) {
        const recompiled = compileCurrent(semanticRepair.content);
        if (recompiled.quality.valid || qualityScore(recompiled.quality) >= bestScore) {
          compiled = recompiled;
          bestScore = Math.max(bestScore, qualityScore(recompiled.quality));
          semanticRepairApplied = true;
          verification = await runSemanticVerifier();
        }
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
  };
}
