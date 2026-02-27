import type { TokenUsage } from '@shared/schema';
import type { PRDStructure } from './prdStructure';
import { logger } from './logger';
import {
  CANONICAL_PRD_HEADINGS,
  compilePrdDocument,
  looksLikeTruncatedOutput,
  type CompilePrdDocumentFn,
  type CompilePrdResult,
  type PrdQualityReport,
} from './prdCompiler';

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
  originalRequest: string;
  maxRepairPasses?: number;
  repairGenerator: (repairPrompt: string, pass: number) => Promise<CompilerModelResult>;
  compileDocument?: CompilePrdDocumentFn;
}

export interface FinalizeWithCompilerGatesResult {
  content: string;
  structure: PRDStructure;
  quality: PrdQualityReport;
  repairAttempts: CompilerModelResult[];
}

const FINALIZER_IMPROVE_MAX_NEW_FEATURES: number = (() => {
  const raw = process.env.PRD_FINALIZER_IMPROVE_MAX_NEW_FEATURES;
  if (raw === undefined || raw.trim() === '') return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    logger.warn('Invalid PRD_FINALIZER_IMPROVE_MAX_NEW_FEATURES value; defaulting to 0', { raw });
    return 0;
  }
  return Math.floor(parsed);
})();

function shouldRepair(
  result: CompilerModelResult,
  quality: PrdQualityReport
): boolean {
  const sourceLooksTruncated = looksLikeTruncatedOutput(result.content);
  const finishReasonSuggestsCutoff = result.finishReason === 'length' &&
    (sourceLooksTruncated || quality.truncatedLikely || !quality.valid);

  if (!quality.valid) return true;
  if (quality.truncatedLikely) return true;
  if (finishReasonSuggestsCutoff) return true;

  // If the compiler produced a valid, non-truncated structure, accept it even
  // when the raw model output looked syntactically incomplete.
  return false;
}

function buildRepairPrompt(params: {
  mode: 'generate' | 'improve';
  issueSummary: string;
  existingContent?: string;
  currentContent: string;
  originalRequest: string;
}): string {
  const { mode, issueSummary, existingContent, currentContent, originalRequest } = params;
  const canonicalHeadings = CANONICAL_PRD_HEADINGS.map(h => `- ## ${h}`).join('\n');

  if (mode === 'improve') {
    return `The previous PRD output failed quality gates and must be repaired.

QUALITY ISSUES:
${issueSummary}

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
- Do not add any extra top-level sections.
- Keep existing feature IDs stable and preserve baseline content unless directly improved.
- No truncation, placeholders, or unfinished bullets/sentences.`;
  }

  return `The previous PRD output failed quality gates and must be repaired.

QUALITY ISSUES:
${issueSummary}

CURRENT INCOMPLETE OUTPUT:
${currentContent}

ORIGINAL REQUEST:
${originalRequest}

Return a COMPLETE corrected PRD in Markdown.

STRICT OUTPUT RULES:
- Use only this top-level heading set exactly once each (H2):
${canonicalHeadings}
- Do not add any extra top-level sections.
- No truncation, placeholders, or unfinished bullets/sentences.`;
}

function countErrors(result: CompilePrdResult): number {
  return result.quality.issues.filter(issue => issue.severity === 'error').length;
}

function shouldRelaxImproveDeltaLimit(
  mode: 'generate' | 'improve',
  result: CompilePrdResult
): boolean {
  if (mode !== 'improve') return false;
  const codes = new Set(result.quality.issues.map(issue => issue.code));
  return codes.has('missing_feature_catalogue') && codes.has('improve_new_feature_limit_applied');
}

function maybeRelaxImproveLimit(params: {
  mode: 'generate' | 'improve';
  baseResult: CompilePrdResult;
  compile: (improveMaxNewFeatures?: number) => CompilePrdResult;
}): CompilePrdResult {
  const { mode, baseResult, compile } = params;
  if (!shouldRelaxImproveDeltaLimit(mode, baseResult)) {
    return baseResult;
  }

  const relaxed = compile(Number.MAX_SAFE_INTEGER);
  const baseErrors = countErrors(baseResult);
  const relaxedErrors = countErrors(relaxed);

  if (relaxed.quality.featureCount > baseResult.quality.featureCount) {
    return relaxed;
  }
  if (relaxedErrors < baseErrors) {
    return relaxed;
  }
  if (baseResult.quality.truncatedLikely && !relaxed.quality.truncatedLikely) {
    return relaxed;
  }

  return baseResult;
}

export async function finalizeWithCompilerGates(
  options: FinalizeWithCompilerGatesOptions
): Promise<FinalizeWithCompilerGatesResult> {
  const {
    initialResult,
    mode,
    existingContent,
    language,
    originalRequest,
    repairGenerator,
    maxRepairPasses = 2,
    compileDocument = compilePrdDocument,
  } = options;

  let current = initialResult;
  const compileCurrent = (content: string, improveMaxNewFeatures?: number) =>
    compileDocument(content, {
      mode,
      existingContent,
      language,
      strictCanonical: true,
      improveMaxNewFeatures: mode === 'improve'
        ? (improveMaxNewFeatures ?? FINALIZER_IMPROVE_MAX_NEW_FEATURES)
        : undefined,
    });

  let compiled = maybeRelaxImproveLimit({
    mode,
    baseResult: compileCurrent(current.content),
    compile: (improveMaxNewFeatures?: number) =>
      compileCurrent(current.content, improveMaxNewFeatures),
  });
  let needsRepair = shouldRepair(current, compiled.quality);
  const repairAttempts: CompilerModelResult[] = [];

  for (let pass = 1; pass <= maxRepairPasses && needsRepair; pass++) {
    const issueSummary = compiled.quality.issues.map(i => `- ${i.message}`).join('\n') || '- Unknown quality issue';
    const repairPrompt = buildRepairPrompt({
      mode,
      issueSummary,
      existingContent,
      currentContent: current.content,
      originalRequest,
    });

    current = await repairGenerator(repairPrompt, pass);
    repairAttempts.push(current);
    compiled = maybeRelaxImproveLimit({
      mode,
      baseResult: compileCurrent(current.content),
      compile: (improveMaxNewFeatures?: number) =>
        compileCurrent(current.content, improveMaxNewFeatures),
    });
    needsRepair = shouldRepair(current, compiled.quality);
  }

  if (needsRepair) {
    const details = compiled.quality.issues.map(i => i.message).join(' | ') || 'Unknown quality issue.';
    throw new Error(`PRD compiler quality gate failed after ${repairAttempts.length} repair attempt(s): ${details}`);
  }

  return {
    content: compiled.content,
    structure: compiled.structure,
    quality: compiled.quality,
    repairAttempts,
  };
}
