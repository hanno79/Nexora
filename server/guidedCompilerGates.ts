/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Extrahierte Compiler-, Finalizer- und Fallback-Orchestrierung fuer Guided-PRD-Generierung
*/

// ÄNDERUNG 08.03.2026: Compiler-Gates-, Fallback- und Artefakt-Orchestrierung aus `guidedAiService.ts` ausgelagert.
import { getOpenRouterClient } from './openrouter';
import { getLanguageInstruction, type RunStageTimings } from './dualAiPrompts';
import { logger } from './logger';
import {
  finalizeWithCompilerGates,
  PrdCompilerQualityError,
  type FinalizeWithCompilerGatesOptions,
} from './prdCompilerFinalizer';
import { pickNextFallbackModel, pickBestDegradedResult, shouldRejectDegradedResult } from './prdQualityFallback';
import { detectContentLanguage } from './prdLanguageDetector';
import { runFeatureExpansionPipeline } from './prdFeatureExpansion';
import { runPostCompilerPreservation } from './prdFeaturePreservation';
import { parsePRDToStructure } from './prdParser';
import type { PRDStructure } from './prdStructure';
import {
  buildSemanticVerificationPrompt,
  parseSemanticVerificationResponse,
  type SemanticVerifierInput,
} from './prdSemanticVerifier';
import {
  buildCompilerArtifactDiagnostics,
  summarizeFinalizerResult,
  type CompilerArtifactSummary,
  type ModelStageArtifact,
} from './compilerArtifact';
import {
  PRD_FINAL_GENERATION,
  REPAIR_PASS,
  CONTENT_REVIEW_REFINE,
  SEMANTIC_VERIFICATION,
} from './tokenBudgets';

export interface GuidedGenerationResult {
  content: string;
  totalTokens: number;
  modelsUsed: string[];
  enrichedStructure?: PRDStructure;
  diagnostics?: Record<string, unknown>;
  compilerArtifact?: CompilerArtifactSummary;
  generationStage?: ModelStageArtifact;
  timings?: RunStageTimings;
}

export async function generateWithCompilerGates(params: {
  client: ReturnType<typeof getOpenRouterClient>;
  systemPrompt: string;
  userPrompt: string;
  mode: 'generate' | 'improve';
  existingContent?: string;
  contentLanguage?: string | null;
  templateCategory?: string;
  abortSignal?: AbortSignal;
}): Promise<GuidedGenerationResult> {
  const startedAt = Date.now();
  const { client, systemPrompt, userPrompt, mode, existingContent, contentLanguage, templateCategory, abortSignal } = params;
  const language = detectContentLanguage(contentLanguage, `${userPrompt}\n${existingContent || ''}`);
  const langInstruction = getLanguageInstruction(language);
  const modelsUsed = new Set<string>();
  let totalTokens = 0;
  const timings: RunStageTimings = {};

  const throwIfAborted = (stage: string) => {
    if (!abortSignal?.aborted) return;
    const abortError: any = new Error(`Guided generation aborted during ${stage}`);
    abortError.name = 'AbortError';
    abortError.code = 'ERR_CLIENT_DISCONNECT';
    throw abortError;
  };

  const generationStartedAt = Date.now();
  const generationResult = await client.callWithFallback(
    'generator',
    systemPrompt,
    userPrompt,
    PRD_FINAL_GENERATION,
    undefined,
    undefined,
    { abortSignal },
  );
  timings.generationDurationMs = Date.now() - generationStartedAt;
  modelsUsed.add(generationResult.model);
  totalTokens += generationResult.usage.total_tokens;

  let enrichedStructure: PRDStructure | undefined;
  if (mode === 'generate') {
    const expansionStartedAt = Date.now();
    throwIfAborted('feature_expansion');
    const expansion = await runFeatureExpansionPipeline({
      inputText: userPrompt,
      draftContent: generationResult.content,
      client,
      language,
      abortSignal,
      log: (message) => logger.debug(message),
      warn: (message) => logger.warn(message),
    });
    timings.expansionDurationMs = Date.now() - expansionStartedAt;
    enrichedStructure = expansion.enrichedStructure;
    totalTokens += expansion.expansionTokens;
    if (expansion.featureListModel) modelsUsed.add(expansion.featureListModel);
    if (expansion.assembledContent && expansion.assembledContent.length > generationResult.content.length) {
      logger.debug(`📝 Guided: Replacing generator content with enriched structure (${expansion.expandedFeatureCount} features)`);
      generationResult.content = expansion.assembledContent;
    }
  } else if (mode === 'improve' && existingContent) {
    enrichedStructure = parsePRDToStructure(existingContent);
    logger.debug(`🛡️ Guided improve baseline: ${enrichedStructure.features.length} features as preservation target`);
  }

  const primaryGenerator = client.getPreferredModel('generator') || '';
  const guidedFinalizerOptions: Omit<FinalizeWithCompilerGatesOptions, 'initialResult'> = {
    mode,
    existingContent,
    language,
    templateCategory,
    originalRequest: userPrompt,
    maxRepairPasses: 3,
    enableQualityAutoRepair: true,
    cancelCheck: throwIfAborted,
    repairReviewer: async (repairPrompt: string, _pass: number) => {
      logger.warn('Guided compiler quality gate failed; starting repair pass');
      const repairResult = await client.callWithFallback(
        'reviewer',
        systemPrompt,
        repairPrompt,
        REPAIR_PASS,
        undefined,
        undefined,
        { abortSignal },
      );
      return {
        content: repairResult.content,
        model: repairResult.model,
        usage: repairResult.usage,
        finishReason: repairResult.finishReason,
      };
    },
    contentRefineReviewer: async (refinePrompt: string) => {
      const refineResult = await client.callWithFallback(
        'reviewer',
        'You are a PRD content refinement specialist. Follow the instructions precisely.' + langInstruction,
        refinePrompt,
        CONTENT_REVIEW_REFINE,
        undefined,
        undefined,
        { abortSignal },
      );
      return {
        content: refineResult.content,
        model: refineResult.model,
        usage: refineResult.usage,
        finishReason: refineResult.finishReason,
      };
    },
    semanticRefineReviewer: async (refinePrompt: string) => {
      const refineResult = await client.callWithFallback(
        'reviewer',
        'You are a PRD semantic repair specialist. Return JSON only.' + langInstruction,
        refinePrompt,
        CONTENT_REVIEW_REFINE,
        { type: 'json_object' },
        0.1,
        { abortSignal },
      );
      return {
        content: refineResult.content,
        model: refineResult.model,
        usage: refineResult.usage,
        finishReason: refineResult.finishReason,
      };
    },
    semanticVerifier: async (input: SemanticVerifierInput) => {
      const verifyPrompt = buildSemanticVerificationPrompt(input);
      let sameFamilyFallback = false;
      const verifyResult = await client.callWithFallback(
        'verifier',
        'You are a strict PRD semantic verifier. Return JSON only.' + langInstruction,
        verifyPrompt,
        SEMANTIC_VERIFICATION,
        { type: 'json_object' },
        0.1,
        {
          abortSignal,
          avoidModelFamilies: input.avoidModelFamilies,
          allowSameFamilyFallback: true,
          onSameFamilyFallback: ({ model, family, blockedFamilies }) => {
            sameFamilyFallback = true;
            logger.warn('Semantic verifier fell back to a blocked model family', {
              model,
              family: family || 'unknown',
              blockedFamilies,
              workflow: 'guided',
            });
          },
        },
      );
      const parsed = parseSemanticVerificationResponse({
        content: verifyResult.content,
        model: verifyResult.model,
        usage: verifyResult.usage,
      });
      return sameFamilyFallback
        ? { ...parsed, sameFamilyFallback: true, blockedFamilies: input.avoidModelFamilies || [] }
        : parsed;
    },
  };

  let finalized;
  const compilerFinalizationStartedAt = Date.now();
  try {
    finalized = await finalizeWithCompilerGates({
      initialResult: {
        content: generationResult.content,
        model: generationResult.model,
        usage: generationResult.usage,
        finishReason: generationResult.finishReason,
      },
      ...guidedFinalizerOptions,
    });
  } catch (error) {
    if (!(error instanceof PrdCompilerQualityError)) throw error;
    if (error.failureStage === 'semantic_verifier') throw error;

    const triedModels = error.repairAttempts.map((attempt) => attempt.model);
    const fallbackModel = pickNextFallbackModel(client, primaryGenerator, triedModels);
    if (!fallbackModel) throw error;

    logger.warn(`Guided quality fallback: ${primaryGenerator} → ${fallbackModel}`);
    client.setPreferredModel('generator', fallbackModel);

    try {
      const fallbackGenerationStartedAt = Date.now();
      const fallbackDraft = await client.callWithFallback(
        'generator',
        systemPrompt,
        userPrompt,
        PRD_FINAL_GENERATION,
        undefined,
        undefined,
        { abortSignal },
      );
      timings.fallbackGenerationDurationMs = (timings.fallbackGenerationDurationMs || 0) + (Date.now() - fallbackGenerationStartedAt);
      modelsUsed.add(fallbackDraft.model);
      totalTokens += fallbackDraft.usage.total_tokens;

      finalized = await finalizeWithCompilerGates({
        initialResult: {
          content: fallbackDraft.content,
          model: fallbackDraft.model,
          usage: fallbackDraft.usage,
          finishReason: fallbackDraft.finishReason,
        },
        ...guidedFinalizerOptions,
      });
      logger.info(`Guided quality fallback succeeded with ${fallbackModel}`);
    } catch (fallbackError) {
      if (fallbackError instanceof PrdCompilerQualityError && fallbackError.failureStage === 'semantic_verifier') {
        throw fallbackError;
      }
      const degraded = pickBestDegradedResult(error, fallbackError);
      if (degraded) {
        if (shouldRejectDegradedResult(degraded, ['content_review_blocked_excessive_fallback', 'excessive_fallback_sections'])) {
          logger.warn('Both models failed quality gates and still produced excessive compiler fallback sections; rejecting degraded result');
          throw fallbackError instanceof PrdCompilerQualityError ? fallbackError : error;
        }
        logger.warn('Both models failed quality gates — returning best degraded result');
        finalized = degraded;
      } else {
        throw error;
      }
    } finally {
      client.setPreferredModel('generator', primaryGenerator);
    }
  }
  timings.compilerFinalizationDurationMs = Date.now() - compilerFinalizationStartedAt;

  for (const attempt of finalized.repairAttempts) {
    modelsUsed.add(attempt.model);
    totalTokens += attempt.usage.total_tokens;
  }
  for (const attempt of finalized.reviewerAttempts || []) {
    modelsUsed.add(attempt.model);
    totalTokens += attempt.usage.total_tokens;
  }
  for (const verification of finalized.semanticVerificationHistory || []) {
    modelsUsed.add(verification.model);
    totalTokens += verification.usage.total_tokens;
  }
  const compilerArtifact = summarizeFinalizerResult(finalized);
  const compilerArtifactDiagnostics = buildCompilerArtifactDiagnostics(compilerArtifact);

  let finalContent = finalized.content;
  if (enrichedStructure && finalized.structure) {
    const preserved = runPostCompilerPreservation(
      enrichedStructure,
      { content: finalized.content, structure: finalized.structure },
      (message) => logger.debug(message),
      (message) => logger.warn(message),
    );
    if (preserved.changed) {
      finalContent = preserved.content;
      enrichedStructure = preserved.structure;
    }
  }

  return {
    content: finalContent,
    totalTokens,
    modelsUsed: Array.from(modelsUsed),
    enrichedStructure,
    diagnostics: compilerArtifactDiagnostics,
    compilerArtifact,
    generationStage: {
      content: generationResult.content,
      model: generationResult.model,
      usage: generationResult.usage,
      finishReason: generationResult.finishReason,
      tier: generationResult.tier,
    },
    timings: { ...timings, totalDurationMs: Date.now() - startedAt },
  };
}
