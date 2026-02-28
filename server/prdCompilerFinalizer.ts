import type { TokenUsage } from '@shared/schema';
import type { PRDStructure } from './prdStructure';
import {
  CANONICAL_PRD_HEADINGS,
  compilePrdDocument,
  looksLikeTruncatedOutput,
  type CompilePrdDocumentFn,
  type PrdQualityReport,
} from './prdCompiler';
import { buildTemplateInstruction } from './prdTemplateIntent';

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
}

export interface FinalizeWithCompilerGatesResult {
  content: string;
  structure: PRDStructure;
  quality: PrdQualityReport;
  repairAttempts: CompilerModelResult[];
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
  templateCategory?: string;
  language?: SupportedLanguage;
}): string {
  const {
    mode,
    issueSummary,
    existingContent,
    currentContent,
    originalRequest,
    templateCategory,
    language,
  } = params;
  const canonicalHeadings = CANONICAL_PRD_HEADINGS.map(h => `- ## ${h}`).join('\n');
  const templateInstruction = buildTemplateInstruction(templateCategory, language || 'en');

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
- Follow this template context:
${templateInstruction}
- Do not add any extra top-level sections.
- Keep existing feature IDs stable and preserve baseline content unless directly improved.
- Resolve repeated boilerplate phrasing so each feature spec stays concrete and unique.
- Remove prompt/meta artifacts (e.g., Iteration X, Questions Identified, Answer:, Reasoning:, ORIGINAL PRD, REVIEW FEEDBACK).
- Keep complete body content in target language except canonical H2 headings and allowed technical terms.
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
- Follow this template context:
${templateInstruction}
- Do not add any extra top-level sections.
- Resolve repeated boilerplate phrasing so each feature spec stays concrete and unique.
- Remove prompt/meta artifacts (e.g., Iteration X, Questions Identified, Answer:, Reasoning:, ORIGINAL PRD, REVIEW FEEDBACK).
- Keep complete body content in target language except canonical H2 headings and allowed technical terms.
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

  for (let pass = 1; pass <= maxRepairPasses && needsRepair; pass++) {
    const issueSummary = compiled.quality.issues.map(i => `- ${i.message}`).join('\n') || '- Unknown quality issue';
    const repairPrompt = buildRepairPrompt({
      mode,
      issueSummary,
      existingContent,
      currentContent: current.content,
      originalRequest,
      templateCategory,
      language,
    });

    current = await repairGenerator(repairPrompt, pass);
    repairAttempts.push(current);
    compiled = compileCurrent(current.content);
    needsRepair = shouldRepair(current, compiled.quality);
  }

  if (needsRepair) {
    const details = compiled.quality.issues.map(i => i.message).join(' | ') || 'Unknown quality issue.';
    throw new PrdCompilerQualityError(
      `PRD compiler quality gate failed after ${repairAttempts.length} repair attempt(s): ${details}`,
      compiled.quality,
      repairAttempts
    );
  }

  return {
    content: compiled.content,
    structure: compiled.structure,
    quality: compiled.quality,
    repairAttempts,
  };
}
