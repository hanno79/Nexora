/*
Author: rahn
Datum: 14.03.2026
Version: 1.1
Beschreibung: Service fuer die gezielte Reparatur einzelner semantischer Blocking-Issues
              in einem bestehenden PRD. Nutzt applySemanticPatchRefinement fuer den
              LLM-gestuetzten Repair und den Semantic Verifier zur Erfolgskontrolle.
*/

import { compilePrdDocument } from './prdCompiler';
import { assembleStructureToMarkdown } from './prdAssembler';
import { applySemanticPatchRefinement, type ReviewerRefineResult } from './prdContentReviewer';
import { toSemanticContentIssues } from './prdCompilerFinalizer';
import {
  buildSemanticVerificationPrompt,
  parseSemanticVerificationResponse,
  type SemanticBlockingIssue,
  type SemanticVerificationResult,
} from './prdSemanticVerifier';
import { createClientWithUserPreferences } from './openrouter';
import { getLanguageInstruction } from './dualAiPrompts';
import { CONTENT_REVIEW_REFINE, SEMANTIC_VERIFICATION } from './tokenBudgets';
import type { TokenUsage } from '@shared/schema';
import type { SupportedLanguage } from './prdTemplateIntent';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IssueRepairOptions {
  prdContent: string;
  issue: SemanticBlockingIssue;
  language: SupportedLanguage;
  templateCategory?: string;
  originalRequest?: string;
  userId?: string;
  maxAttempts?: number;
}

export interface IssueRepairResult {
  repairedContent: string;
  resolved: boolean;
  remainingIssues: SemanticBlockingIssue[];
  attempts: number;
  model: string;
  tokenUsage: TokenUsage;
}

// ---------------------------------------------------------------------------
// Core repair function
// ---------------------------------------------------------------------------

export async function repairSingleIssue(options: IssueRepairOptions): Promise<IssueRepairResult> {
  const {
    issue,
    language,
    templateCategory,
    originalRequest,
    userId,
    maxAttempts = 3,
  } = options;

  let currentContent = options.prdContent;
  let totalUsage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let lastModel = '';

  const { client, contentLanguage } = await createClientWithUserPreferences(userId);
  const langInstruction = getLanguageInstruction(contentLanguage || language);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 1. Parse current content to structure
    const compiled = compilePrdDocument(currentContent, {
      mode: 'generate',
      language,
      templateCategory,
    });

    // 2. Convert issue to ContentIssue format
    const contentIssues = toSemanticContentIssues([issue]);

    // 3. Apply semantic patch refinement (targeted repair)
    const repairReviewer = async (prompt: string): Promise<ReviewerRefineResult> => {
      const result = await client.callWithFallback(
        'semantic_repair',
        'You are a PRD semantic repair specialist. Return JSON only.' + langInstruction,
        prompt,
        CONTENT_REVIEW_REFINE,
        { type: 'json_object' },
        0.1,
      );
      lastModel = result.model;
      addUsage(totalUsage, result.usage);
      return {
        content: result.content,
        model: result.model,
        usage: result.usage,
        finishReason: result.finishReason,
      };
    };

    const patchResult = await applySemanticPatchRefinement({
      content: currentContent,
      structure: compiled.structure,
      issues: contentIssues,
      language,
      templateCategory,
      originalRequest,
      reviewer: repairReviewer,
    });

    if (!patchResult.refined) {
      // Repair did not change anything — no point retrying with the same content
      return buildResult(currentContent, false, [], attempt, lastModel, totalUsage);
    }

    currentContent = patchResult.content;

    // 4. Verify: run semantic verifier to check if issue is resolved
    const verifyResult = await runVerification({
      client,
      content: currentContent,
      structure: patchResult.structure,
      language,
      templateCategory,
      originalRequest: originalRequest || '',
      langInstruction,
    });

    addUsage(totalUsage, verifyResult.usage);
    lastModel = verifyResult.model;
    const matchingIssue = verifyResult.blockingIssues.find(
      bi => bi.code === issue.code && bi.sectionKey === issue.sectionKey,
    );

    if (!matchingIssue) {
      // Issue resolved
      return buildResult(
        currentContent,
        true,
        verifyResult.blockingIssues,
        attempt,
        lastModel,
        totalUsage,
      );
    }

    // Issue still present — retry with updated content (next iteration)
  }

  // Exhausted all attempts — run final verification to get remaining issues
  const finalCompiled = compilePrdDocument(currentContent, {
    mode: 'generate',
    language,
    templateCategory,
  });
  const finalVerify = await runVerification({
    client,
    content: currentContent,
    structure: finalCompiled.structure,
    language,
    templateCategory,
    originalRequest: originalRequest || '',
    langInstruction,
  });

  addUsage(totalUsage, finalVerify.usage);

  return buildResult(
    currentContent,
    false,
    finalVerify.blockingIssues,
    maxAttempts,
    lastModel,
    totalUsage,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addUsage(target: TokenUsage, source: TokenUsage): void {
  target.prompt_tokens += source.prompt_tokens ?? 0;
  target.completion_tokens += source.completion_tokens ?? 0;
  target.total_tokens += source.total_tokens ?? 0;
}

function buildResult(
  content: string,
  resolved: boolean,
  remainingIssues: SemanticBlockingIssue[],
  attempts: number,
  model: string,
  tokenUsage: TokenUsage,
): IssueRepairResult {
  return { repairedContent: content, resolved, remainingIssues, attempts, model, tokenUsage };
}

async function runVerification(params: {
  client: Awaited<ReturnType<typeof createClientWithUserPreferences>>['client'];
  content: string;
  structure: import('./prdStructure').PRDStructure;
  language: SupportedLanguage;
  templateCategory?: string;
  originalRequest: string;
  langInstruction: string;
}): Promise<SemanticVerificationResult & { usage: TokenUsage }> {
  const { client, content, structure, language, templateCategory, originalRequest, langInstruction } = params;

  const verifierInput = {
    content,
    structure,
    mode: 'generate' as const,
    language,
    templateCategory,
    originalRequest,
  };

  const verifyPrompt = buildSemanticVerificationPrompt(verifierInput);
  const verifyResult = await client.callWithFallback(
    'verifier',
    'You are a strict PRD semantic verifier. Return JSON only.' + langInstruction,
    verifyPrompt,
    SEMANTIC_VERIFICATION,
    { type: 'json_object' },
    0.1,
  );

  const parsed = parseSemanticVerificationResponse({
    content: verifyResult.content,
    model: verifyResult.model,
    usage: verifyResult.usage,
  });

  return { ...parsed, usage: verifyResult.usage };
}
