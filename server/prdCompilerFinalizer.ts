import type { TokenUsage } from '@shared/schema';
import type { PRDStructure } from './prdStructure';
import {
  CANONICAL_PRD_HEADINGS,
  compilePrdDocument,
  type CompilePrdDocumentFn,
  type PrdQualityReport,
} from './prdCompiler';
import { buildTemplateInstruction } from './prdTemplateIntent';
import { reviewAndRefineContent, type ContentReviewResult } from './prdContentReviewer';

type SupportedLanguage = 'de' | 'en';

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
  repairGenerator: (repairPrompt: string, pass: number) => Promise<CompilerModelResult>;
  compileDocument?: CompilePrdDocumentFn;
  /** Enable post-compiler content review to detect and fix filler/repetition. Default: true. */
  enableContentReview?: boolean;
  /** Generator for the content-refine AI call. If not provided, content review runs
   *  in analysis-only mode (issues reported but no AI refinement). */
  contentRefineGenerator?: (prompt: string) => Promise<{ content: string; model: string; usage: any }>;
}

export interface FinalizeWithCompilerGatesResult {
  content: string;
  structure: PRDStructure;
  quality: PrdQualityReport;
  qualityScore: number;
  repairAttempts: CompilerModelResult[];
  /** Content review results (populated when enableContentReview is true). */
  contentReview?: ContentReviewResult;
  /** Whether the content was refined by AI after content review. */
  contentRefined?: boolean;
}

export class PrdCompilerQualityError extends Error {
  readonly quality: PrdQualityReport;
  readonly repairAttempts: CompilerModelResult[];

  constructor(message: string, quality: PrdQualityReport, repairAttempts: CompilerModelResult[]) {
    super(message);
    this.name = 'PrdCompilerQualityError';
    this.quality = quality;
    this.repairAttempts = repairAttempts;
  }
}

export function qualityScore(quality: PrdQualityReport): number {
  let score = 100;
  for (const issue of quality.issues) {
    score -= issue.severity === 'error' ? 10 : 3;
  }
  if (quality.truncatedLikely) score -= 15;
  score -= (quality.missingSections?.length || 0) * 5;
  score += Math.min(20, (quality.featureCount || 0) * 2);
  return score;
}

function shouldRepair(
  _result: CompilerModelResult,
  quality: PrdQualityReport
): boolean {
  if (!quality.valid) return true;
  if (quality.truncatedLikely) return true;

  // If the compiler produced a valid, non-truncated structure, accept it even
  // when the raw model output looked syntactically incomplete (finish_reason='length').
  return false;
}

export interface RepairHistoryEntry {
  pass: number;
  score: number;
  issueCount: number;
  topIssues: string[];
}

function formatRepairHistory(history: RepairHistoryEntry[]): string {
  if (history.length === 0) return '';
  const lines = history.map(h =>
    `- Pass ${h.pass}: score ${h.score}, ${h.issueCount} issue(s): ${h.topIssues.join(', ') || 'none'}`
  );
  // Identify persistent issues (present in every pass)
  const allIssueSets = history.map(h => new Set(h.topIssues));
  const persistent = history[0].topIssues.filter(code =>
    allIssueSets.every(s => s.has(code))
  );
  const focusHint = persistent.length > 0
    ? `\nFocus on fixing the persistent issue(s): ${persistent.join(', ')}`
    : '';
  return `\nREPAIR HISTORY (do NOT repeat failed approaches):
${lines.join('\n')}${focusHint}\n`;
}

function buildRepairPrompt(params: {
  mode: 'generate' | 'improve';
  issueSummary: string;
  existingContent?: string;
  currentContent: string;
  originalRequest: string;
  templateCategory?: string;
  language?: SupportedLanguage;
  repairHistory?: RepairHistoryEntry[];
}): string {
  const {
    mode,
    issueSummary,
    existingContent,
    currentContent,
    originalRequest,
    templateCategory,
    language,
    repairHistory,
  } = params;
  const canonicalHeadings = CANONICAL_PRD_HEADINGS.map(h => `- ## ${h}`).join('\n');
  const templateInstruction = buildTemplateInstruction(templateCategory, language || 'en');
  const historyBlock = formatRepairHistory(repairHistory || []);

  if (mode === 'improve') {
    return `The previous PRD output failed quality gates and must be repaired.

QUALITY ISSUES:
${issueSummary}
${historyBlock}
BASELINE PRD (must remain intact unless directly improved):
${existingContent || '(no baseline provided)'}

CURRENT INCOMPLETE OUTPUT:
${currentContent}

ORIGINAL REQUEST:
${originalRequest}

Return a COMPLETE corrected PRD in Markdown.

STRICT OUTPUT RULES:
- Use only this top-level heading set exactly once each (H2):
${canonicalHeadings}
- Follow this template context:
${templateInstruction}
- Do not add any extra top-level sections.
- Keep existing feature IDs stable and preserve baseline content unless directly improved.
- Resolve repeated boilerplate phrasing so each feature spec stays concrete and unique.
- Remove prompt/meta artifacts (e.g., Iteration X, Questions Identified, Answer:, Reasoning:, ORIGINAL PRD, REVIEW FEEDBACK).
- Target language: ${language || 'en'}. Write ALL body content in this language. Keep only the canonical H2 headings in English.
- No truncation, placeholders, or unfinished bullets/sentences.`;
  }

  return `The previous PRD output failed quality gates and must be repaired.

QUALITY ISSUES:
${issueSummary}
${historyBlock}
CURRENT INCOMPLETE OUTPUT:
${currentContent}

ORIGINAL REQUEST:
${originalRequest}

Return a COMPLETE corrected PRD in Markdown.

STRICT OUTPUT RULES:
- Use only this top-level heading set exactly once each (H2):
${canonicalHeadings}
- Follow this template context:
${templateInstruction}
- Do not add any extra top-level sections.
- Resolve repeated boilerplate phrasing so each feature spec stays concrete and unique.
- Remove prompt/meta artifacts (e.g., Iteration X, Questions Identified, Answer:, Reasoning:, ORIGINAL PRD, REVIEW FEEDBACK).
- Target language: ${language || 'en'}. Write ALL body content in this language. Keep only the canonical H2 headings in English.
- No truncation, placeholders, or unfinished bullets/sentences.`;
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
    repairGenerator,
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
  let needsRepair = shouldRepair(current, compiled.quality);
  const repairAttempts: CompilerModelResult[] = [];

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
      originalRequest,
      templateCategory,
      language,
      repairHistory,
    });

    const repairResult = await repairGenerator(repairPrompt, pass);
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
    needsRepair = shouldRepair(current, compiled.quality);
  }

  if (needsRepair) {
    const errorIssues = compiled.quality.issues.filter(i => i.severity === 'error');
    const details = errorIssues.map(i => i.message).join(' | ') || 'Unknown quality issue.';
    throw new PrdCompilerQualityError(
      `PRD compiler quality gate failed after ${repairAttempts.length} repair attempt(s): ${details}`,
      compiled.quality,
      repairAttempts
    );
  }

  // --- Content Review & Refine (post-compiler pass) ---
  const enableContentReview = options.enableContentReview !== false;
  let contentReview: ContentReviewResult | undefined;
  let contentRefined = false;

  if (enableContentReview) {
    const refineResult = await reviewAndRefineContent({
      content: compiled.content,
      structure: compiled.structure,
      language: language || 'en',
      templateCategory,
      fallbackSections: compiled.quality.fallbackSections,
      refineGenerator: options.contentRefineGenerator,
    });

    contentReview = refineResult.reviewResult;
    contentRefined = refineResult.refined;

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

  return {
    content: compiled.content,
    structure: compiled.structure,
    quality: compiled.quality,
    qualityScore: bestScore,
    repairAttempts,
    contentReview,
    contentRefined,
  };
}
