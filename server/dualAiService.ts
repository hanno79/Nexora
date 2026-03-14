// Dual-AI Service - Orchestrates Generator & Reviewer based on HRP-17
import { createClientWithUserPreferences } from './openrouter';
import type { OpenRouterClient } from './openrouter';
import type { ModelCallAttemptUpdate } from './openrouterFallback';
import { detectContentLanguage } from './prdLanguageDetector';
import { runFeatureExpansionPipeline, extractVisionFromContent } from './prdFeatureExpansion';
import {
  PRD_GENERATION,
  PRD_IMPROVEMENT,
  REVIEW_STANDARD,
  REVIEW_FINAL,
  REPAIR_PASS,
  CONTENT_REVIEW_REFINE,
  SEMANTIC_VERIFICATION,
  ITERATIVE_ANSWERER,
  ITERATIVE_ANSWERER_RETRY,
  ITERATIVE_CLARIFYING_Q,
  ITERATIVE_STRUCTURED_DELTA,
} from './tokenBudgets';
import { runPostCompilerPreservation } from './prdFeaturePreservation';
import type { TokenUsage } from "@shared/schema";
import {
  GENERATOR_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT,
  IMPROVEMENT_SYSTEM_PROMPT,
  ITERATIVE_GENERATOR_PROMPT,
  ITERATIVE_IMPROVE_GENERATOR_PROMPT,
  BEST_PRACTICE_ANSWERER_PROMPT,
  FINAL_REVIEWER_PROMPT,
  getLanguageInstruction,
  type DualAiRequest,
  type DualAiResponse,
  type GeneratorResponse,
  type ReviewerResponse,
  type IterativeResponse,
  type IterationData,
  type CompilerDiagnostics,
  type RunStageTimings,
} from './dualAiPrompts';
import { expandFeature } from './services/llm/expandFeature';
import { parsePRDToStructure, logStructureValidation, normalizeFeatureId } from './prdParser';
import { compareStructures, logStructuralDrift, restoreRemovedFeatures } from './prdStructureDiff';
import { assembleStructureToMarkdown } from './prdAssembler';
import { countFeatureCompleteness, enforceFeatureIntegrity, type IntegrityRestoration } from './prdFeatureValidator';
import { detectTargetSection, regenerateSection } from './prdSectionRegenerator';
import { regenerateSectionAsJson } from './prdSectionJsonRegenerator';
import type { PRDStructure, FeatureSpec } from './prdStructure';
import { mergeExpansionIntoStructure } from './prdStructureMerger';
import {
  finalizeWithCompilerGates,
  PrdCompilerQualityError,
  PrdCompilerRuntimeError,
} from './prdCompilerFinalizer';
import { pickNextFallbackModel, pickBestDegradedResult } from './prdQualityFallback';
import { compilePrdDocument, ensurePrdRequiredSections } from './prdCompiler';
import { isHighConfidenceFeatureDuplicate } from './prdQualitySignals';
import { applySemanticPatchRefinement, type ContentIssue } from './prdContentReviewer';
import {
  collectDeterministicSemanticIssues,
  type DeterministicSemanticIssue,
} from './prdDeterministicSemanticLints';
import { resolvePrdWorkflowMode } from './prdWorkflowMode';
import { buildTemplateInstruction } from './prdTemplateIntent';
import {
  buildSemanticVerificationPrompt,
  parseSemanticVerificationResponse,
  type SemanticVerifierInput,
} from './prdSemanticVerifier';
import type { PrdQualityReport } from './prdCompiler';
import {
  buildCompilerArtifactDiagnostics,
  summarizeFinalizerResult,
} from './compilerArtifact';
import fs from 'fs'; // dev-only: used by writeIterativeArtifacts
import path from 'path';
import { logger } from './logger';

const DUAL_AI_VERBOSE_LOGS = process.env.ENABLE_VERBOSE_LOGS === 'true';

function dualAiLog(...args: unknown[]) {
  if (DUAL_AI_VERBOSE_LOGS) {
    console.log(...args);
  }
}

function dualAiWarn(...args: unknown[]) {
  if (DUAL_AI_VERBOSE_LOGS) {
    console.warn(...args);
  }
}

function dualAiError(...args: unknown[]) {
  console.error(...args);
}

interface StructuredFeatureDelta {
  addedFeatures: Array<{
    featureId?: string;
    name: string;
    shortDescription?: string;
  }>;
  updatedFeatures: Array<{
    featureId: string;
    notes?: string;
  }>;
}

interface StructuredFeatureDeltaParseResult {
  found: boolean;
  valid: boolean;
  delta: StructuredFeatureDelta;
  error?: string;
}

/** Immutable per-request context threaded through all iteration helpers. */
interface IterationOpts {
  iterationCount: number;
  existingContent: string;
  additionalRequirements: string | undefined;
  mode: 'improve' | 'generate';
  templateCategory?: string;
  isImprovement: boolean;
  workflowInputText: string;
  resolvedLanguage: 'en' | 'de';
  langInstruction: string;
  client: OpenRouterClient;
  useFinalReview: boolean;
  throwIfCancelled: (stage: string) => void;
  onProgress: ((event: { type: string; [key: string]: any }) => void) | undefined;
  abortSignal?: AbortSignal;
  onModelAttempt?: (attempt: ModelCallAttemptUpdate) => void;
}

/** Mutable loop state shared across all iteration helpers. */
interface IterationLoopState {
  currentPRD: string;
  previousStructure: PRDStructure | null;
  freezeBaselineStructure: PRDStructure | null;
  featuresFrozen: boolean;
  freezeActivated: boolean;
  blockedRegenerationAttempts: number;
  iterativeEnrichedStructure: PRDStructure | undefined;
  diagnostics: CompilerDiagnostics;
  modelsUsed: Set<string>;
  iterations: IterationData[];
  allDriftWarnings: Map<number, string[]>;
  allPreservationActions: Map<number, string[]>;
  allIntegrityRestorations: Map<number, IntegrityRestoration[]>;
  allSectionRegens: Map<number, { section: string; feedbackSnippet: string; mode?: 'json' | 'markdown' }>;
}

/** Return shape for the generator and answerer AI calls. */
interface IterationCallResult {
  content: string;
  usage: TokenUsage;
  model: string;
  tier: string;
  usedFallback: boolean;
  finishReason?: string;
}

interface ImproveDriftFinding extends ContentIssue {}

interface ImproveDriftEvaluation {
  blockingIssues: ImproveDriftFinding[];
  blockedAddedFeatures: string[];
  semanticLintCodes: string[];
  primaryReason?: string;
}

export class DualAiService {
  async generatePRD(request: DualAiRequest, userId?: string): Promise<DualAiResponse> {
    const startedAt = Date.now();
    const timings: RunStageTimings = {};
    // Create fresh client per request to prevent cross-user contamination
    const { client, contentLanguage } = await createClientWithUserPreferences(userId, dualAiLog);
    dualAiLog(`🎯 Simple run models: generator=${client.getPreferredModel('generator') || '(tier default)'}, reviewer=${client.getPreferredModel('reviewer') || '(tier default)'}, fallback=${client.getPreferredModel('fallback') || '(none)'}`);
    
    const { userInput, existingContent, mode, templateCategory } = request;
    const resolvedLanguage = detectContentLanguage(
      contentLanguage,
      `${userInput || ''}\n${existingContent || ''}`
    );
    const langInstruction = getLanguageInstruction(resolvedLanguage);
    const templateInstruction = buildTemplateInstruction(templateCategory, resolvedLanguage);

    if (mode === 'review-only' && !existingContent) {
      throw new Error('review-only mode requires existingContent');
    }

    const modeResolution = mode === 'review-only'
      ? null
      : resolvePrdWorkflowMode({
        requestedMode: mode === 'improve' ? 'improve' : 'generate',
        existingContent: existingContent || '',
      });
    const effectiveMode: 'generate' | 'improve' | 'review-only' = mode === 'review-only'
      ? 'review-only'
      : (modeResolution?.mode || 'generate');
    if (mode !== 'review-only' && modeResolution?.downgradedFromImprove) {
      dualAiLog('ℹ️ Improve mode downgraded to generate: existing baseline has no feature catalogue.');
    }

    let generatorResponse: GeneratorResponse;
    let reviewerResponse: ReviewerResponse;
    let improvedVersion: GeneratorResponse | undefined;

    // Step 1: Generate initial PRD (skip if review-only)
    // ÄNDERUNG 01.03.2026: generatorPrompt außerhalb definieren für Fallback-Scope
    let generatorPrompt: string | undefined;
    if (effectiveMode !== 'review-only') {
      dualAiLog('🤖 Step 1: Generating PRD with AI Generator...');
      
      if (effectiveMode === 'improve' && existingContent) {
        // IMPROVEMENT MODE: Explicitly instruct to preserve and build upon existing content
        generatorPrompt = `IMPORTANT: You are IMPROVING an existing PRD. Do NOT start from scratch!

CRITICAL RULES:
- PRESERVE the existing structure and all sections
- KEEP all existing content - do not remove or replace it
- ADD new content based on the user's input
- EXPAND existing sections with more details where relevant
- Only MODIFY content if it directly contradicts the new requirements

${templateInstruction}

EXISTING PRD (PRESERVE THIS):
${existingContent}

USER'S ADDITIONAL REQUIREMENTS/IMPROVEMENTS:
${userInput}

Create an improved version that incorporates the new requirements while keeping all existing content intact.`;
      } else {
        // NEW GENERATION MODE: Create from scratch
        generatorPrompt = `Erstelle ein vollständiges PRD basierend auf:\n\n${userInput}\n\n${templateInstruction}`;
      }

      const generatorStartedAt = Date.now();
      const genResult = await client.callWithFallback(
        'generator',
        GENERATOR_SYSTEM_PROMPT + langInstruction,
        generatorPrompt,
        PRD_GENERATION
      );
      timings.generatorDurationMs = Date.now() - generatorStartedAt;

      generatorResponse = {
        content: genResult.content,
        model: genResult.model,
        usage: genResult.usage,
        tier: genResult.tier
      };

      dualAiLog(`✅ Generated ${genResult.usage.completion_tokens} tokens with ${genResult.model}`);
    } else {
      generatorResponse = {
        content: existingContent!,
        model: 'existing',
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        tier: 'n/a'
      };
    }

    // Feature Identification Layer (runs after vision generation, before review)
    // Keep improve-mode deterministic and cheaper by skipping expansive feature discovery.
    let enrichedStructure: PRDStructure | undefined;
    const shouldRunFeatureExpansion = effectiveMode === 'generate';
    if (shouldRunFeatureExpansion) {
      const expansionStartedAt = Date.now();
      const expansion = await runFeatureExpansionPipeline({
        inputText: userInput,
        draftContent: generatorResponse.content,
        client,
        language: resolvedLanguage,
        log: dualAiLog,
        warn: dualAiWarn,
      });
      timings.expansionDurationMs = Date.now() - expansionStartedAt;
      enrichedStructure = expansion.enrichedStructure;
      // Feed enriched structure back into content pipeline so the Reviewer and
      // Compiler Finalizer operate on the full feature set.
      if (expansion.assembledContent && expansion.assembledContent.length > generatorResponse.content.length) {
        dualAiLog(`📝 Replacing generator content with enriched structure (${expansion.expandedFeatureCount} features, ${expansion.assembledContent.length} chars)`);
        generatorResponse.content = expansion.assembledContent;
      }
    } else if (effectiveMode === 'improve' && existingContent) {
      // Improve mode: parse existing content as baseline for post-compiler preservation.
      // Feature Expansion is skipped (too expensive, discovers NEW features instead of protecting
      // existing ones), but we still need a baseline so runPostCompilerPreservation() can detect
      // and restore features lost during compilation.
      enrichedStructure = parsePRDToStructure(existingContent);
      dualAiLog(`🛡️ Improve baseline loaded: ${enrichedStructure.features.length} features as preservation target`);
    } else if (mode !== 'review-only') {
      dualAiLog('🧩 Feature Identification Layer skipped (no baseline available)');
    }

    // Step 2: Review with AI Reviewer
    dualAiLog('🔍 Step 2: Reviewing PRD with AI Reviewer...');
    
    const reviewerPrompt = `Bewerte folgendes PRD kritisch:\n\n${generatorResponse.content}\n\nTemplate-Kontext:\n${templateInstruction}`;

    const reviewerStartedAt = Date.now();
    const reviewResult = await client.callWithFallback(
      'reviewer',
      REVIEWER_SYSTEM_PROMPT + langInstruction,
      reviewerPrompt,
      REVIEW_STANDARD
    );
    timings.reviewerDurationMs = Date.now() - reviewerStartedAt;

    // Parse review response
    const reviewContent = reviewResult.content;
    const questions = this.extractQuestions(reviewContent);

    reviewerResponse = {
      assessment: reviewContent,
      questions,
      model: reviewResult.model,
      usage: reviewResult.usage,
      tier: reviewResult.tier
    };

    dualAiLog(`✅ Review complete with ${reviewResult.usage.completion_tokens} tokens using ${reviewResult.model}`);

    // Step 3: Improve based on review (always run in improve mode, regardless of question extraction)
    if (effectiveMode === 'improve') {
      dualAiLog('🔧 Step 3: Improving PRD based on review feedback...');
      
      const improvementPrompt = `ORIGINAL PRD:\n${generatorResponse.content}\n\nREVIEW FEEDBACK:\n${reviewContent}\n\nTemplate-Kontext:\n${templateInstruction}\n\nVerbessere das PRD und adressiere die kritischen Fragen.`;

      const improvementStartedAt = Date.now();
      const improveResult = await client.callWithFallback(
        'generator',
        IMPROVEMENT_SYSTEM_PROMPT + langInstruction,
        improvementPrompt,
        PRD_IMPROVEMENT
      );
      timings.improvementDurationMs = Date.now() - improvementStartedAt;

      improvedVersion = {
        content: improveResult.content,
        model: improveResult.model,
        usage: improveResult.usage,
        tier: improveResult.tier
      };

      dualAiLog(`✅ Improved version generated with ${improveResult.usage.completion_tokens} tokens`);
    }

    // Apply cleanup to strip any LLM preamble/meta-commentary from final output
    const rawFinalContent = improvedVersion?.content || generatorResponse.content;
    const cleanedFinalContent = this.extractCleanPRD(rawFinalContent);
    const compileMode: 'improve' | 'generate' = effectiveMode === 'improve' ? 'improve' : 'generate';
    const repairSystemPrompt = (compileMode === 'improve'
      ? IMPROVEMENT_SYSTEM_PROMPT
      : GENERATOR_SYSTEM_PROMPT) + langInstruction;

    const primaryGenerator = client.getPreferredModel('generator') || '';
    const finalizerOpts = {
      mode: compileMode,
      existingContent: compileMode === 'improve' ? existingContent : undefined,
      language: resolvedLanguage,
      templateCategory,
      originalRequest: userInput || reviewContent || cleanedFinalContent.slice(0, 400),
      maxRepairPasses: 3,
      repairReviewer: async (repairPrompt: string, _pass: number) => {
        const repairResult = await client.callWithFallback(
          'reviewer',
          repairSystemPrompt,
          repairPrompt,
          REPAIR_PASS
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
          CONTENT_REVIEW_REFINE
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
          'semantic_repair',
          'You are a PRD semantic repair specialist. Return JSON only.' + langInstruction,
          refinePrompt,
          CONTENT_REVIEW_REFINE,
          { type: 'json_object' },
          0.1,
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
            avoidModelFamilies: input.avoidModelFamilies,
            allowSameFamilyFallback: true,
            onSameFamilyFallback: ({ model, family, blockedFamilies }) => {
              sameFamilyFallback = true;
              dualAiWarn(
                `Semantic verifier fell back to blocked family ${family || 'unknown'} ` +
                `with ${model}. Blocked families: ${blockedFamilies.join(', ') || 'none'}`
              );
            },
          }
        );
        const parsed = parseSemanticVerificationResponse({
          content: verifyResult.content,
          model: verifyResult.model,
          usage: verifyResult.usage,
        });
        return sameFamilyFallback
          ? {
              ...parsed,
              sameFamilyFallback: true,
              blockedFamilies: input.avoidModelFamilies || [],
            }
          : parsed;
      },
    } as const;

    let compilerFinalized;
    let qualityFallbackUsed = false;
    const compilerFinalizationStartedAt = Date.now();
    try {
      compilerFinalized = await finalizeWithCompilerGates({
        initialResult: {
          content: cleanedFinalContent,
          model: improvedVersion?.model || generatorResponse.model || 'generator',
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        },
        ...finalizerOpts,
      });
    } catch (error) {
      if (!(error instanceof PrdCompilerQualityError)) throw error;
      if (error.failureStage === 'semantic_verifier') throw error;

      const triedModels = error.repairAttempts.map(a => a.model);
      const fallbackModel = pickNextFallbackModel(client, primaryGenerator, triedModels);
      if (!fallbackModel) throw error;

      dualAiLog(`⚡ Quality fallback: ${primaryGenerator} → ${fallbackModel}`);
      client.setPreferredModel('generator', fallbackModel);
      qualityFallbackUsed = true;

      try {
        // Re-generate draft with stronger fallback model
        const fallbackGenerationStartedAt = Date.now();
        const fallbackDraft = await client.callWithFallback(
          'generator',
          GENERATOR_SYSTEM_PROMPT + langInstruction,
          generatorPrompt || `Erstelle ein vollständiges PRD basierend auf:\n\n${userInput}`,
          PRD_GENERATION
        );
        timings.fallbackGenerationDurationMs = (timings.fallbackGenerationDurationMs || 0) + (Date.now() - fallbackGenerationStartedAt);
        compilerFinalized = await finalizeWithCompilerGates({
          initialResult: {
            content: this.extractCleanPRD(fallbackDraft.content),
            model: fallbackDraft.model,
            usage: fallbackDraft.usage,
            finishReason: fallbackDraft.finishReason,
          },
          ...finalizerOpts,
        });
        dualAiLog(`✅ Quality fallback succeeded with ${fallbackModel}`);
      } catch (fallbackError) {
        if ((fallbackError as any)?.name === 'AbortError' || (fallbackError as any)?.code === 'ERR_CLIENT_DISCONNECT') {
          throw fallbackError;
        }
        if (fallbackError instanceof PrdCompilerQualityError && fallbackError.failureStage === 'semantic_verifier') {
          throw fallbackError;
        }
        const degraded = pickBestDegradedResult(error, fallbackError);
        if (degraded) {
          dualAiLog(`⚠️ Both models failed quality gates — returning best degraded result`);
          compilerFinalized = degraded;
        } else {
          throw error;
        }
      } finally {
        client.setPreferredModel('generator', primaryGenerator);
      }
    }
    timings.compilerFinalizationDurationMs = Date.now() - compilerFinalizationStartedAt;

    const compilerRepairTokens = compilerFinalized.repairAttempts.reduce(
      (sum, attempt) => sum + attempt.usage.total_tokens,
      0
    );
    const compilerRepairModels = compilerFinalized.repairAttempts.map(attempt => attempt.model);
    const reviewerRepairTokens = (compilerFinalized.reviewerAttempts || []).reduce(
      (sum, attempt) => sum + attempt.usage.total_tokens,
      0
    );
    const reviewerRepairModels = (compilerFinalized.reviewerAttempts || []).map(attempt => attempt.model);
    const semanticVerifierTokens = (compilerFinalized.semanticVerificationHistory || []).reduce(
      (sum, result) => sum + result.usage.total_tokens,
      0
    );
    const semanticVerifierModels = (compilerFinalized.semanticVerificationHistory || []).map(result => result.model);
    const compilerArtifact = summarizeFinalizerResult(compilerFinalized);
    const compilerArtifactDiagnostics = buildCompilerArtifactDiagnostics(compilerArtifact);

    // Post-compiler feature preservation (shared helper)
    if (enrichedStructure && compilerFinalized.structure) {
      const preserved = runPostCompilerPreservation(
        enrichedStructure,
        { content: compilerFinalized.content, structure: compilerFinalized.structure },
        dualAiLog,
        dualAiWarn,
      );
      if (preserved.changed) {
        compilerFinalized.content = preserved.content;
        compilerFinalized.structure = preserved.structure;
      }
    }

    // Calculate totals
    const totalTokens =
      generatorResponse.usage.total_tokens +
      reviewerResponse.usage.total_tokens +
      (improvedVersion?.usage.total_tokens || 0) +
      compilerRepairTokens +
      reviewerRepairTokens +
      semanticVerifierTokens;

    const modelsUsed = Array.from(new Set([
      generatorResponse.model,
      reviewerResponse.model,
      improvedVersion?.model,
      ...compilerRepairModels,
      ...reviewerRepairModels,
      ...semanticVerifierModels,
    ].filter(Boolean))) as string[];

    // Structured PRD representation — prefer enriched structure from Feature
    // Expansion Engine when available, as it contains the full feature set with
    // all 10 fields expanded per feature.
    let finalStructuredContent: PRDStructure | undefined = enrichedStructure || compilerFinalized.structure;
    try {
      logStructureValidation(finalStructuredContent);
    } catch (parseError: any) {
      dualAiWarn('⚠️ PRD structure parsing failed (non-blocking):', parseError.message);
      // Safe fallback in case logging/parsing tooling throws unexpectedly.
      finalStructuredContent = enrichedStructure || parsePRDToStructure(compilerFinalized.content);
    }

    return {
      finalContent: compilerFinalized.content,
      generatorResponse,
      reviewerResponse,
      improvedVersion,
      totalTokens,
      modelsUsed,
      structuredContent: finalStructuredContent,
      diagnostics: compilerArtifactDiagnostics as any,
      compilerArtifact,
      timings: {
        ...timings,
        totalDurationMs: Date.now() - startedAt,
      },
    };
  }

  async reviewOnly(prdContent: string, userId?: string): Promise<ReviewerResponse> {
    // Create fresh client per request to prevent cross-user contamination
    const { client, contentLanguage } = await createClientWithUserPreferences(userId, dualAiLog);
    const resolvedLanguage = detectContentLanguage(contentLanguage, prdContent);
    const langInstruction = getLanguageInstruction(resolvedLanguage);
    
    dualAiLog('🔍 Reviewing existing PRD...');
    
    const reviewerPrompt = `Critically evaluate the following PRD:\n\n${prdContent}`;

    const reviewResult = await client.callWithFallback(
      'reviewer',
      REVIEWER_SYSTEM_PROMPT + langInstruction,
      reviewerPrompt,
      REVIEW_STANDARD
    );

    const questions = this.extractQuestions(reviewResult.content);

    return {
      assessment: reviewResult.content,
      questions,
      model: reviewResult.model,
      usage: reviewResult.usage,
      tier: reviewResult.tier
    };
  }

  private emitIterativeProgress(
    opts: IterationOpts,
    event: { type: string; [key: string]: any }
  ): void {
    opts.onProgress?.(event);
  }

  private async callIterativeModel(
    opts: IterationOpts,
    params: {
      role: 'generator' | 'reviewer' | 'verifier';
      systemPrompt: string;
      userPrompt: string;
      maxTokens: number;
      phase: string;
      responseFormat?: { type: 'json_object' };
      temperature?: number;
      constraints?: Record<string, unknown>;
    }
  ) {
    return opts.client.callWithFallback(
      params.role,
      params.systemPrompt,
      params.userPrompt,
      params.maxTokens,
      params.responseFormat,
      params.temperature,
      {
        ...(params.constraints || {}),
        abortSignal: opts.abortSignal,
        phase: params.phase,
        onAttemptUpdate: opts.onModelAttempt,
      },
    );
  }

  async generateIterative(
    existingContent: string,
    additionalRequirements: string | undefined,
    mode: 'improve' | 'generate',
    iterationCount: number = 3,
    useFinalReview: boolean = false,
    userId?: string,
    onProgress?: (event: { type: string; [key: string]: any }) => void,
    isCancelled?: () => boolean,
    abortSignal?: AbortSignal,
    onModelAttempt?: (attempt: ModelCallAttemptUpdate) => void,
    templateCategory?: string
  ): Promise<IterativeResponse> {
    const startedAt = Date.now();
    const timings: RunStageTimings = {};
    // Create fresh client per request to prevent cross-user contamination
    const { client, contentLanguage } = await createClientWithUserPreferences(userId, dualAiLog);
    const workflowInputText = additionalRequirements || existingContent || '';
    const resolvedLanguage = detectContentLanguage(
      contentLanguage,
      `${workflowInputText}\n${existingContent || ''}`
    );
    const langInstruction = getLanguageInstruction(resolvedLanguage);

    // Use explicit mode from client - no heuristics needed
    const modeResolution = resolvePrdWorkflowMode({
      requestedMode: mode === 'improve' ? 'improve' : 'generate',
      existingContent,
    });
    const effectiveMode: 'improve' | 'generate' = modeResolution.mode;
    const isImprovement = effectiveMode === 'improve';
    if (modeResolution.downgradedFromImprove) {
      dualAiLog('ℹ️ Iterative improve mode downgraded to generate: existing baseline has no feature catalogue.');
    }
    const trimmedContent = existingContent?.trim() || '';

    dualAiLog(`🎯 Iterative run models: generator=${client.getPreferredModel('generator') || '(tier default)'}, reviewer=${client.getPreferredModel('reviewer') || '(tier default)'}, fallback=${client.getPreferredModel('fallback') || '(none)'}`);
    dualAiLog(`🔄 Starting iterative workflow: ${iterationCount} iterations, final review: ${useFinalReview}`);
    dualAiLog(`📝 Mode: ${isImprovement ? 'IMPROVEMENT (building upon existing content)' : 'NEW GENERATION'}`);
    dualAiLog(`📄 Existing content length: ${trimmedContent.length} characters`);
    if (additionalRequirements) {
      dualAiLog(`➕ Additional requirements provided (${additionalRequirements.length} chars)`);
    }

    const throwIfCancelled = (stage: string) => {
      if (!isCancelled?.() && !abortSignal?.aborted) return;
      const cancelError: any = new Error(`Iterative generation cancelled during ${stage}`);
      cancelError.name = 'AbortError';
      cancelError.code = 'ERR_CLIENT_DISCONNECT';
      throw cancelError;
    };

    client.setDefaultExecutionContext?.({
      abortSignal,
      phase: 'iterative',
      onAttemptUpdate: onModelAttempt,
    });

    const opts: IterationOpts = {
      iterationCount,
      existingContent,
      additionalRequirements,
      mode: effectiveMode,
      templateCategory,
      isImprovement,
      workflowInputText,
      resolvedLanguage,
      langInstruction,
      client,
      useFinalReview,
      throwIfCancelled,
      onProgress,
      abortSignal,
      onModelAttempt,
    };

    const state: IterationLoopState = {
      currentPRD: existingContent || '',
      previousStructure: null,
      freezeBaselineStructure: null,
      featuresFrozen: false,
      freezeActivated: false,
      blockedRegenerationAttempts: 0,
      iterativeEnrichedStructure: undefined,
      diagnostics: {
        structuredFeatureCount: 0,
        totalFeatureCount: 0,
        jsonSectionUpdates: 0,
        markdownSectionRegens: 0,
        fullRegenerations: 0,
        featurePreservations: 0,
        featureIntegrityRestores: 0,
        featureQualityRegressions: 0,
        autoRecoveredFeatures: 0,
        avgFeatureCompleteness: 0,
        driftEvents: 0,
        featureFreezeActive: false,
        blockedRegenerationAttempts: 0,
        freezeSeedSource: 'none',
        nfrGlobalCategoryAdds: 0,
        nfrFeatureCriteriaAdds: 0,
        jsonRetryAttempts: 0,
        jsonRepairSuccesses: 0,
        aggregatedFeatureCount: 0,
        languageFixRequired: false,
        boilerplateHits: 0,
        metaLeakHits: 0,
        earlyDriftDetected: false,
        earlyDriftCodes: [],
        earlyDriftSections: [],
        blockedAddedFeatures: [],
        earlySemanticLintCodes: [],
        earlyRepairAttempted: false,
        earlyRepairApplied: false,
        primaryEarlyDriftReason: undefined,
      },
      modelsUsed: new Set<string>(),
      iterations: [],
      allDriftWarnings: new Map(),
      allPreservationActions: new Map(),
      allIntegrityRestorations: new Map(),
      allSectionRegens: new Map(),
    };

    dualAiLog("❄️ Feature Freeze Engine initialisiert (wartet auf erste Kompilierung)");

    // Improvement mode: use existing parsed features as authoritative baseline.
    // This prevents first-iteration collapse from redefining the freeze base.
    if (isImprovement && trimmedContent.length > 0) {
      try {
        const baselineStructure = parsePRDToStructure(existingContent);
        if (baselineStructure.features.length > 0) {
          state.previousStructure = baselineStructure;
          state.freezeBaselineStructure = baselineStructure;
          state.featuresFrozen = true;
          state.freezeActivated = true;
          state.diagnostics.freezeSeedSource = 'existingContent';
          dualAiLog("🧊 FEATURE CATALOGUE FROZEN – Baseline loaded from existing content");
          dualAiLog("   " + baselineStructure.features.length + " baseline feature(s) locked");
        }
      } catch (baselineParseError: any) {
        dualAiWarn("⚠️ Failed to parse improvement baseline for freeze seeding:", baselineParseError.message);
      }
    }

    // Iterative Q&A Loop
    for (let i = 1; i <= iterationCount; i++) {
      opts.throwIfCancelled(`iteration ${i} start`);
      dualAiLog(`\n📝 Iteration ${i}/${iterationCount}`);
      this.emitIterativeProgress(opts, { type: 'iteration_start', iteration: i, total: iterationCount });

      const genResult = await this.runIterationGeneratorPhase(i, state, opts);
      await this.runIterationExpansionPhase(i, genResult, state, opts);

      const provisionalCleanPRD = this.extractCleanPRD(genResult.content);
      const structuredDeltaResult = this.extractStructuredFeatureDeltaWithStatus(genResult.content);

      const questions = await this.extractQuestionsWithFallback(i, genResult, provisionalCleanPRD, state, opts);
      const { answerResult, answererOutputTruncated } = await this.runIterationAnswererPhase(i, genResult, questions, state, opts);

      const { shouldContinue, preservedPRD, candidateStructure } =
        await this.validateAndPreserveIterationStructure(i, provisionalCleanPRD, structuredDeltaResult, state, opts);
      if (shouldContinue) continue; // rollback path — iteration record intentionally NOT pushed

      const improvedIteration = await this.enforceImproveModeDriftGuardrails({
        iterationNumber: i,
        preservedPRD,
        candidateStructure,
        state,
        opts,
      });

      if (improvedIteration.candidateStructure) {
        state.previousStructure = improvedIteration.candidateStructure;
      }
      state.currentPRD = improvedIteration.preservedPRD;

      const iterTokens = genResult.usage.total_tokens + answerResult.usage.total_tokens;
      state.iterations.push({
        iterationNumber: i,
        generatorOutput: genResult.content,
        answererOutput: answerResult.content,
        answererOutputTruncated,
        questions,
        mergedPRD: improvedIteration.preservedPRD,
        tokensUsed: iterTokens,
      });
      this.emitIterativeProgress(opts, { type: 'iteration_complete', iteration: i, total: iterationCount, tokensUsed: iterTokens });
    }

    let finalReview: IterativeResponse['finalReview'] = undefined;
    if (opts.useFinalReview) {
      const finalReviewStartedAt = Date.now();
      finalReview = await this.runOptionalFinalReview(state, opts);
      timings.finalReviewDurationMs = Date.now() - finalReviewStartedAt;
    }

    logger.info('Iterative workflow entering compiler finalization', {
      useFinalReview: opts.useFinalReview,
      finalReviewCompleted: !!finalReview,
      lastFinalReviewModel: finalReview?.model || null,
    });
    this.emitIterativeProgress(opts, { type: 'compiler_finalization_start' });
    const compilerFinalizationStartedAt = Date.now();
    const { finalPRD, hardenedStructure, compilerRepairTokens, compilerArtifact } = await this.finalizeIterativeWorkflow(state, opts);
    timings.compilerFinalizationDurationMs = Date.now() - compilerFinalizationStartedAt;

    // Build iteration log document (separate from clean PRD)
    const iterationLog = this.buildIterationLog(
      state.iterations, finalReview,
      state.allDriftWarnings, state.allPreservationActions,
      state.allIntegrityRestorations, state.allSectionRegens
    );

    // Calculate totals
    const totalTokens = state.iterations.reduce((sum, iter) => sum + iter.tokensUsed, 0) +
      (finalReview?.usage.total_tokens || 0) +
      compilerRepairTokens;

    dualAiLog(`\n✅ Iterative workflow complete! Total tokens: ${totalTokens}`);

    // Structured PRD representation - use hardened structure if available, else parse
    try {
      const structured = hardenedStructure || parsePRDToStructure(finalPRD);
      logStructureValidation(structured);
      state.diagnostics.totalFeatureCount = structured.features.length;
      state.diagnostics.structuredFeatureCount = structured.features.filter(f =>
        f.purpose || f.actors || f.mainFlow || f.acceptanceCriteria
      ).length;
      state.diagnostics.avgFeatureCompleteness = structured.features.length > 0
        ? Number((structured.features.reduce((sum, f) => sum + countFeatureCompleteness(f), 0) / structured.features.length).toFixed(2))
        : 0;
    } catch (parseError: any) {
      dualAiWarn('⚠️ PRD structure parsing failed (non-blocking):', parseError.message);
    }

    // FEATURE FREEZE: Set final diagnostic values
    state.diagnostics.featureFreezeActive = state.featuresFrozen;
    state.diagnostics.blockedRegenerationAttempts = state.blockedRegenerationAttempts;

    // FEATURE FREEZE: Final summary logging
    dualAiLog('\n📊 Feature Freeze Engine Summary:');
    dualAiLog('   Freeze Active: ' + state.featuresFrozen);
    dualAiLog('   Blocked Attempts: ' + state.blockedRegenerationAttempts);
    dualAiLog('   Final Feature Count: ' + (state.previousStructure?.features.length || 0));
    dualAiLog('   Avg Feature Completeness: ' + (state.diagnostics.avgFeatureCompleteness || 0));
    dualAiLog('   Quality Regressions Recovered: ' + (state.diagnostics.featureQualityRegressions || 0));

    const validation = this.validateFinalOutputConsistency({
      finalPRD,
      iterations: state.iterations,
      freezeBaselineFeatureCount: state.freezeBaselineStructure?.features.length || 0,
      featuresFrozen: state.featuresFrozen,
    });
    state.diagnostics.finalValidationPassed = validation.errors.length === 0;
    state.diagnostics.finalValidationErrors = validation.errors.length;
    state.diagnostics.finalSanitizerApplied = validation.sanitizerApplied;
    if (validation.errors.length > 0) {
      dualAiWarn('⚠️ Final output consistency issues detected:');
      for (const err of validation.errors) {
        dualAiWarn(`   - ${err}`);
      }
      if (process.env.HARD_FINAL_QUALITY_GATE === 'true') {
        throw new Error(`Final quality gate failed: ${validation.errors.slice(0, 5).join(' | ')}`);
      }
    }

    // Fail-safe: return immediately after workflow completion to avoid
    // long or stuck post-processing in unstable environments.
    const fastFinalizeEnabled = process.env.ITERATIVE_FAST_FINALIZE !== 'false';
    if (fastFinalizeEnabled) {
      dualAiLog('⚡ Iterative fast finalize enabled (skipping deep post-processing)');
      opts.throwIfCancelled('fast finalize');
      this.emitIterativeProgress(opts, { type: 'complete', totalTokens });
      return {
        finalContent: finalPRD,
        mergedPRD: finalPRD,
        iterationLog,
        iterations: state.iterations,
        finalReview,
        totalTokens,
        modelsUsed: Array.from(state.modelsUsed),
        diagnostics: state.diagnostics,
        structuredContent: hardenedStructure,
        compilerArtifact,
        timings: {
          ...timings,
          totalDurationMs: Date.now() - startedAt,
        },
      };
    }

    const canonicalMergedPRD = this.buildCanonicalMergedPRD(finalPRD, state.iterations, {
      mode: opts.isImprovement ? 'improve' : 'generate',
      existingContent: opts.isImprovement ? opts.existingContent : undefined,
      language: opts.resolvedLanguage,
      templateCategory: opts.templateCategory,
      contextHint: opts.workflowInputText,
    });
    let currentPRD = canonicalMergedPRD;
    if (state.iterations.length > 0) {
      state.iterations[state.iterations.length - 1].mergedPRD = canonicalMergedPRD;
    }
    const postCanonicalValidation = this.validateFinalOutputConsistency({
      finalPRD: currentPRD,
      iterations: state.iterations,
      freezeBaselineFeatureCount: state.freezeBaselineStructure?.features.length || 0,
      featuresFrozen: state.featuresFrozen,
    });
    state.diagnostics.finalValidationPassed = postCanonicalValidation.errors.length === 0;
    state.diagnostics.finalValidationErrors = postCanonicalValidation.errors.length;
    state.diagnostics.finalSanitizerApplied = postCanonicalValidation.sanitizerApplied;
    if (postCanonicalValidation.errors.length > 0) {
      dualAiWarn('⚠️ Final output consistency issues detected:');
      for (const err of postCanonicalValidation.errors) {
        dualAiWarn(`   - ${err}`);
      }
    }
    state.diagnostics.artifactWriteConsistency = true;
    state.diagnostics.artifactWriteIssues = 0;
    const shouldWriteArtifacts = process.env.WRITE_ITERATIVE_ARTIFACTS === 'true';
    if (shouldWriteArtifacts) {
      try {
        opts.throwIfCancelled('artifact writing');
        const artifactWriteResult = await this.writeIterativeArtifacts({
          finalContent: canonicalMergedPRD,
          mergedPRD: canonicalMergedPRD,
          iterationLog,
          iterations: state.iterations,
          finalReview,
          totalTokens,
          modelsUsed: Array.from(state.modelsUsed),
          diagnostics: state.diagnostics,
          compilerArtifact,
        });
        state.diagnostics.artifactWriteConsistency = artifactWriteResult.ok;
        state.diagnostics.artifactWriteIssues = artifactWriteResult.issues.length;
        if (!artifactWriteResult.ok) {
          dualAiWarn('⚠️ Service-level artifact write consistency issues detected:');
          for (const issue of artifactWriteResult.issues) {
            dualAiWarn(`   - ${issue}`);
          }
        } else {
          dualAiLog(`🗂️ Service artifacts updated: ${artifactWriteResult.files.join(', ')}`);
        }
      } catch (artifactError: any) {
        state.diagnostics.artifactWriteConsistency = false;
        state.diagnostics.artifactWriteIssues = 1;
        dualAiWarn(`⚠️ Service artifact write failed: ${artifactError.message}`);
      }
    } else {
      dualAiLog('🗂️ Service artifact write skipped (WRITE_ITERATIVE_ARTIFACTS != true)');
    }

    opts.throwIfCancelled('completion');
    this.emitIterativeProgress(opts, { type: 'complete', totalTokens });
    return {
      finalContent: canonicalMergedPRD,
      mergedPRD: canonicalMergedPRD,
      iterationLog,
      iterations: state.iterations,
      finalReview,
      totalTokens,
      modelsUsed: Array.from(state.modelsUsed),
      diagnostics: state.diagnostics,
      structuredContent: hardenedStructure,
      compilerArtifact,
      timings: {
        ...timings,
        totalDurationMs: Date.now() - startedAt,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Iteration helpers extracted from generateIterative
  // -------------------------------------------------------------------------

  /**
   * Helper A: Run the generator phase for one iteration.
   * Tries section-level regeneration first (i >= 2), falls back to full generation.
   */
  private async runIterationGeneratorPhase(
    i: number,
    state: IterationLoopState,
    opts: IterationOpts
  ): Promise<IterationCallResult> {
    const previousIteration = state.iterations[state.iterations.length - 1];

    // Step 1: AI #1 (Generator) - Creates PRD draft + asks questions
    // Try section-level regeneration first (iterations >= 2 only)
    let genResult: IterationCallResult | null = null;

    if (i >= 2 && state.previousStructure) {
      try {
        const feedbackText = previousIteration.answererOutput;
        let targetSection = detectTargetSection(feedbackText, {
          allowFeatureContext: state.featuresFrozen
        });
        if (!targetSection && state.featuresFrozen) {
          targetSection = this.pickFallbackPatchSection(state.previousStructure);
          if (targetSection) {
            dualAiLog(`🎯 Iteration ${i}: Freeze fallback patch section selected: "${String(targetSection)}"`);
          }
        }

        if (targetSection) {
          const currentSectionValue = state.previousStructure[targetSection];
          const hasSectionContent = typeof currentSectionValue === 'string' && currentSectionValue.trim().length > 0;
          if (!hasSectionContent) {
            dualAiLog(`🧱 Iteration ${i}: Target section "${String(targetSection)}" is empty and will be initialized via section regeneration`);
          }
          dualAiLog(`🎯 Iteration ${i}: JSON Mode Triggered for Section: "${String(targetSection)}"`);
          const visionContext = state.previousStructure.systemVision || '';

          let regenContent: string | null = null;
          let usedJsonMode = false;
          const strictMode = process.env.STRICT_JSON_MODE !== 'false'; // Default: true

          try {
            opts.throwIfCancelled(`iteration ${i} json regeneration`);
            const jsonResult = await regenerateSectionAsJson(
              targetSection,
              state.previousStructure,
              feedbackText,
              visionContext,
              opts.client,
              opts.langInstruction
            );
            regenContent = jsonResult.updatedContent;
            usedJsonMode = true;
            state.diagnostics.jsonSectionUpdates++;
            state.diagnostics.jsonRetryAttempts = (state.diagnostics.jsonRetryAttempts || 0) + (jsonResult.diagnostics?.retryAttempts || 1);
            state.diagnostics.jsonRepairSuccesses = (state.diagnostics.jsonRepairSuccesses || 0) + (jsonResult.diagnostics?.repairSuccesses || 0);
            dualAiLog(`✅ Iteration ${i}: JSON structured section update succeeded for "${String(targetSection)}" (attempts: ${jsonResult.diagnostics?.retryAttempts || 1})`);
          } catch (jsonError: any) {
            const retryCount = (jsonError as any).retryCount || 1;
            state.diagnostics.jsonRetryAttempts = (state.diagnostics.jsonRetryAttempts || 0) + retryCount;
            dualAiWarn(`⚠️ Iteration ${i}: JSON Mode failed after ${retryCount} attempts. Falling back to Markdown. Error: ${jsonError.message}`);
            if (strictMode) {
              dualAiError(`🚨 STRICT MODE: JSON failed for "${String(targetSection)}" after all retries. Diagnostic drift event raised.`);
              state.diagnostics.driftEvents++;
            }
          }

          if (!regenContent) {
            opts.throwIfCancelled(`iteration ${i} markdown regeneration`);
            regenContent = await regenerateSection(
              targetSection,
              state.previousStructure,
              feedbackText,
              visionContext,
              opts.client,
              opts.langInstruction
            );
            state.diagnostics.markdownSectionRegens++;
            dualAiLog(`✅ Iteration ${i}: Markdown section regeneration complete for "${String(targetSection)}"`);
          }

          const updatedStructure = { ...state.previousStructure, features: [...state.previousStructure.features] };
          (updatedStructure as any)[targetSection] = regenContent;
          const rebuiltMarkdown = assembleStructureToMarkdown(updatedStructure);

          genResult = {
            content: rebuiltMarkdown,
            usage: { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 },
            model: usedJsonMode ? 'json-section-regen' : 'section-regen',
            tier: 'section',
            usedFallback: false
          };
          state.allSectionRegens.set(i, {
            section: targetSection,
            feedbackSnippet: feedbackText.substring(0, 150),
            mode: usedJsonMode ? 'json' : 'markdown'
          });
          dualAiLog(`✅ Iteration ${i}: Section-level regeneration complete for "${targetSection}" (mode: ${usedJsonMode ? 'json' : 'markdown'})`);
        }
      } catch (sectionRegenError: any) {
        // FEATURE FREEZE: Block full regeneration when frozen
        if (state.featuresFrozen) {
          dualAiWarn('🚫 FULL REGENERATION BLOCKED (freeze active)');
          dualAiWarn('   Section-level regen failed: ' + sectionRegenError.message);
          dualAiWarn('   Using previous iteration instead');
          const prevIteration = state.iterations[state.iterations.length - 1];
          if (prevIteration) {
            genResult = {
              content: prevIteration.mergedPRD,
              usage: { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 },
              model: 'frozen-prev-iteration',
              tier: 'fallback',
              usedFallback: true
            };
          } else {
            const frozenFallbackContent = state.iterations[0]?.mergedPRD || state.currentPRD || '';
            if (!frozenFallbackContent) {
              dualAiWarn(`⚠️ Iteration ${i}: freeze fallback content is empty (no previous mergedPRD/currentPRD available)`);
            }
            genResult = {
              content: frozenFallbackContent,
              usage: { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 },
              model: 'frozen-prev-iteration',
              tier: 'fallback',
              usedFallback: true
            };
          }
        } else {
          dualAiError(`🚨 Iteration ${i}: Section-level regeneration failed. Falling back to FULL regeneration. Error: ${sectionRegenError.message}`);
          genResult = null;
        }
      }
    }

    if (!genResult) {
      if (state.featuresFrozen && i >= 2) {
        dualAiWarn('🚫 FULL REGENERATION BLOCKED (freeze patch mode)');
        const prevIteration = state.iterations[state.iterations.length - 1];
        if (prevIteration) {
          state.blockedRegenerationAttempts++;
          genResult = {
            content: prevIteration.mergedPRD,
            usage: { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 },
            model: 'freeze-patch-fallback',
            tier: 'fallback',
            usedFallback: true
          };
          dualAiLog(`✅ Iteration ${i}: Reused previous PRD because no safe patch target was available`);
        }
      }
    }

    if (!genResult) {
      state.diagnostics.fullRegenerations++;
      dualAiLog(`🤖 AI #1: Generating PRD draft and identifying gaps...`);

      let generatorPrompt: string;
      const templateInstruction = buildTemplateInstruction(opts.templateCategory, opts.resolvedLanguage);
      const improveAnchorContext = opts.isImprovement
        ? this.buildImproveAnchorContext(state.freezeBaselineStructure)
        : '';

      if (i === 1) {
        if (opts.isImprovement) {
          generatorPrompt = `IMPORTANT: You are IMPROVING an EXISTING PRD. Do NOT start from scratch!

EXISTING PRD (PRESERVE THIS STRUCTURE AND CONTENT):
${opts.existingContent}

${improveAnchorContext}

${templateInstruction}

${opts.additionalRequirements ? `ADDITIONAL REQUIREMENTS TO INTEGRATE:
${opts.additionalRequirements}

Your task:
1. KEEP all existing sections and their content
2. ADD the new requirements into the appropriate existing sections
3. ENHANCE and EXPAND existing content where relevant
4. Do NOT remove or replace existing content unless it contradicts the new requirements
5. Do NOT add new features, personas, deployment models, or infrastructure domains unless the user explicitly requested them
6. Ask questions about any unclear aspects of the new requirements` : `Your task:
1. KEEP all existing sections and their content
2. ENHANCE and EXPAND existing content with more details
3. Identify gaps and missing information
4. Do NOT add new features, personas, deployment models, or infrastructure domains
5. Ask questions to improve specific sections inside the existing scope`}`;
        } else {
          generatorPrompt = `INITIAL INPUT:\n${opts.additionalRequirements || opts.existingContent}\n\n${templateInstruction}\n\nCreate an initial PRD draft and ask questions about open points.`;
        }
      } else {
        // FEATURE FREEZE: Add freeze rules to prompt when frozen and iteration >= 2
        let freezeRule = '';
        if (state.featuresFrozen && i >= 2) {
          freezeRule = `

=== CRITICAL SYSTEM RULE ===
The Feature Catalogue is FROZEN.

You are strictly forbidden to:
- Rewrite existing Feature IDs (F-XX)
- Remove existing features
- Change feature numbering
- Replace the full Feature Catalogue section
- Modify compiled feature structures

You may only:
${opts.isImprovement
  ? `- Extend baseline sections without widening product scope
- Improve descriptive content for existing baseline features only
- Preserve the original personas, deployment model, infrastructure assumptions, and excluded scope unless explicitly requested otherwise`
  : `- Add new features using NEW sequential F-XX IDs (e.g., F-03, F-04 if F-01 and F-02 exist)
- Extend non-feature sections
- Improve descriptive content outside compiled features`}

If you modify or remove existing features, your output will be discarded.
=== END CRITICAL RULE ===
`;
          dualAiLog('🔒 Feature Freeze Rule added to generator prompt');
        }

        generatorPrompt = `CURRENT PRD (DO NOT DISCARD - BUILD UPON IT):
${state.currentPRD}

ANSWERS FROM PREVIOUS ITERATION (MUST be incorporated into the PRD):
${previousIteration.answererOutput}

${improveAnchorContext}

${templateInstruction}

Your task:
1. PRESERVE all existing sections and content
2. INCORPORATE all answers from the previous iteration directly into the appropriate PRD sections — do NOT leave them as separate Q&A
3. RESOLVE any Open Points or Gaps by using the expert answers — the information must become part of the PRD content
4. EXPAND sections that are still incomplete
5. ${opts.isImprovement
  ? 'Do NOT widen scope beyond the baseline feature catalogue, personas, deployment model, or infrastructure assumptions'
  : 'Ask questions about remaining gaps only (do NOT repeat already-answered questions)'}
6. The final PRD must be self-contained — a reader should find all information IN the document, not in a separate Q&A section`
      }

      opts.throwIfCancelled(`iteration ${i} generator call`);
      genResult = await this.callIterativeModel(opts, {
        role: 'generator',
        systemPrompt: (opts.isImprovement ? ITERATIVE_IMPROVE_GENERATOR_PROMPT : ITERATIVE_GENERATOR_PROMPT) + opts.langInstruction,
        userPrompt: generatorPrompt,
        maxTokens: PRD_GENERATION,
        phase: 'iteration_generator',
      });

      state.modelsUsed.add(genResult.model);
      dualAiLog(`✅ Generated ${genResult.usage.completion_tokens} tokens with ${genResult.model}`);
      this.emitIterativeProgress(opts, { type: 'generator_done', iteration: i, tokensUsed: genResult.usage.total_tokens, model: genResult.model });
    }

    if (state.featuresFrozen && i >= 2) {
      opts.throwIfCancelled(`iteration ${i} structured delta section`);
          const deltaSection = await this.generateStructuredDeltaSection({
            currentPrd: state.currentPRD,
            generatorOutput: genResult.content,
            reviewerFeedback: previousIteration?.answererOutput || '',
            client: opts.client,
            langInstruction: opts.langInstruction,
            abortSignal: opts.abortSignal,
            onModelAttempt: opts.onModelAttempt,
          });
      if (deltaSection && !/##\s*Feature Delta(?:\s*\(JSON\))?/i.test(genResult.content)) {
        genResult.content = `${genResult.content.trim()}\n\n---\n\n${deltaSection}`;
        dualAiLog(`🧩 Iteration ${i}: Structured Feature Delta appended via delta-only pass`);
      }
    }

    // Validate structured delta; fallback if invalid while frozen
    let structuredDeltaResult = this.extractStructuredFeatureDeltaWithStatus(genResult.content);
    if (state.featuresFrozen && i >= 2 && !structuredDeltaResult.valid) {
      state.blockedRegenerationAttempts++;
      dualAiWarn('🚫 STRICT DELTA JSON REQUIRED (iteration >= 2, freeze active)');
      dualAiWarn(`   Invalid or missing Feature Delta JSON: ${structuredDeltaResult.error || 'not found'}`);
      const prevIteration = state.iterations[state.iterations.length - 1];
      if (prevIteration) {
        genResult = {
          content: `${prevIteration.mergedPRD}\n\n${this.buildEmptyFeatureDeltaSection()}`,
          usage: { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 },
          model: 'strict-delta-fallback',
          tier: 'fallback',
          usedFallback: true
        };
      }
    }

    if (!genResult) {
      throw new Error(`Iteration ${i} generator phase produced no result`);
    }

    return genResult;
  }

  /**
   * Helper B: Run the feature identification + expansion phase (first iteration only).
   */
  private async runIterationExpansionPhase(
    i: number,
    genResult: IterationCallResult,
    state: IterationLoopState,
    opts: IterationOpts
  ): Promise<void> {
    // Feature Identification Layer + Expansion Engine (iterations 1–2 = grow window)
    // Iteration 1: initial feature discovery. Iteration 2: Q&A-informed feature growth.
    // Freeze activates after iteration 2 expansion completes.
    if (i <= 2) {
      let iterationStructure: PRDStructure | null = null;
      try {
        iterationStructure = parsePRDToStructure(this.extractCleanPRD(genResult.content));
      } catch (iterationParseError: any) {
        dualAiWarn(`⚠️ Unable to parse iteration ${i} PRD for freeze seeding:`, iterationParseError.message);
      }

      opts.throwIfCancelled(`iteration ${i} feature expansion`);
      const baselineFeatureIds = (state.freezeBaselineStructure?.features || [])
        .map(feature => normalizeFeatureId(feature.id) || String(feature.id || '').trim().toUpperCase())
        .filter(Boolean);
      const expansion = await runFeatureExpansionPipeline({
        inputText: opts.workflowInputText,
        draftContent: genResult.content,
        client: opts.client,
        language: opts.resolvedLanguage,
        allowedFeatureIds: opts.isImprovement ? baselineFeatureIds : undefined,
        allowFeatureDiscovery: !opts.isImprovement,
        seedFeatures: opts.isImprovement
          ? (state.freezeBaselineStructure?.features || []).map(feature => ({ ...feature }))
          : undefined,
        abortSignal: opts.abortSignal,
        log: dualAiLog,
        warn: dualAiWarn,
      });

      if (opts.isImprovement && expansion.blockedFeatureIds && expansion.blockedFeatureIds.length > 0) {
        state.diagnostics.blockedAddedFeatures = Array.from(new Set([
          ...(state.diagnostics.blockedAddedFeatures || []),
          ...expansion.blockedFeatureIds,
        ]));
        state.diagnostics.earlyDriftDetected = true;
        state.diagnostics.earlyDriftCodes = Array.from(new Set([
          ...(state.diagnostics.earlyDriftCodes || []),
          'improve_new_feature_blocked',
        ]));
        this.emitIterativeProgress(opts, {
          type: 'early_drift_detected',
          iteration: i,
          codes: ['improve_new_feature_blocked'],
          blockedAddedFeatures: expansion.blockedFeatureIds,
        });
        dualAiWarn(`🚫 Iteration ${i}: blocked improve-mode feature additions (${expansion.blockedFeatureIds.join(', ')})`);
      }

      if (expansion.expandedFeatureCount > 0) {
        this.emitIterativeProgress(opts, { type: 'features_expanded', count: expansion.expandedFeatureCount, tokensUsed: expansion.expansionTokens });

        const compiledCount = expansion.expandedFeatures.filter(
          (f: any) => f.compiled === true || f.valid === true
        ).length;
        const expansionBaseline = this.buildFreezeBaselineFromExpansion(
          { expandedFeatures: expansion.expandedFeatures, totalTokens: expansion.expansionTokens },
          iterationStructure || state.previousStructure
        );
        if (expansionBaseline) {
          state.freezeBaselineStructure = expansionBaseline;
        }

        // FEATURE FREEZE: Activate after iteration 2 expansion (grow window closed)
        if (compiledCount > 0 && !state.freezeActivated && i >= 2) {
          state.featuresFrozen = true;
          state.freezeActivated = true;
          state.diagnostics.freezeSeedSource = 'compiledExpansion';
          dualAiLog('🧊 FEATURE CATALOGUE FROZEN – Grow window closed after iteration 2');
          dualAiLog('   ' + compiledCount + ' feature(s) in compiled state');
          if (state.freezeBaselineStructure?.features.length) {
            dualAiLog('   Baseline catalogue size: ' + state.freezeBaselineStructure.features.length);
          }
          dualAiLog('   Full regeneration will be blocked from next iteration');
        } else if (i === 1 && compiledCount > 0) {
          dualAiLog(`📊 Iteration 1: ${compiledCount} features compiled. Grow window open — expansion will run again in iteration 2.`);
        }

        // Merge expansion into structured representation for persistence
        if (expansion.enrichedStructure) {
          state.iterativeEnrichedStructure = expansion.enrichedStructure;
          dualAiLog(`📦 Iterative structure enriched: ${expansion.enrichedStructure.features.length} features with structured fields`);
        } else if (iterationStructure && expansion.expandedFeatures.length > 0) {
          try {
            state.iterativeEnrichedStructure = mergeExpansionIntoStructure(iterationStructure, expansion.expandedFeatures);
            dualAiLog(`📦 Iterative structure enriched: ${state.iterativeEnrichedStructure.features.length} features with structured fields`);
          } catch (mergeError: any) {
            dualAiWarn('⚠️ Iterative structure merge failed (non-blocking):', mergeError.message);
          }
        }
      }
    }
  }

  /**
   * Helper C: Extract questions from generator output with fallback synthesis.
   */
  private async extractQuestionsWithFallback(
    i: number,
    genResult: IterationCallResult,
    provisionalCleanPRD: string,
    state: IterationLoopState,
    opts: IterationOpts
  ): Promise<string[]> {
    // Extract questions from generator output (robust) and synthesize fallback questions if needed
    let questions = this.extractQuestionsFromIterativeOutput(genResult.content);
    const requiredQuestions = i >= 2 ? 2 : (i < opts.iterationCount ? 3 : 0);
    if (requiredQuestions > 0 && questions.length < requiredQuestions) {
      opts.throwIfCancelled(`iteration ${i} clarifying questions`);
      const improveAnchorContext = opts.isImprovement
        ? this.buildImproveAnchorContext(state.freezeBaselineStructure)
        : '';
      const fallbackQuestions = await this.generateClarifyingQuestions(
        provisionalCleanPRD,
        opts.client,
        opts.langInstruction,
        requiredQuestions,
        improveAnchorContext,
        opts.abortSignal,
        opts.onModelAttempt,
      );
      questions = this.mergeQuestions(questions, fallbackQuestions);
      if (fallbackQuestions.length > 0) {
        dualAiLog(`🧭 Synthesized ${fallbackQuestions.length} fallback clarifying question(s)`);
      }
    }
    if (requiredQuestions > 0 && questions.length < requiredQuestions) {
      const deterministicFallback = this.getDeterministicFallbackQuestions(requiredQuestions);
      questions = this.mergeQuestions(questions, deterministicFallback);
      dualAiLog(`🧩 Added deterministic fallback questions to meet minimum (${requiredQuestions})`);
    }
    if (requiredQuestions > 0 && questions.length > 5) {
      questions = questions.slice(0, 5);
    }
    dualAiLog(`📋 Extracted ${questions.length} questions`);
    return questions;
  }

  /**
   * Helper D: Run the answerer phase for one iteration.
   */
  private async runIterationAnswererPhase(
    i: number,
    genResult: IterationCallResult,
    questions: string[],
    state: IterationLoopState,
    opts: IterationOpts
  ): Promise<{ answerResult: IterationCallResult; answererOutputTruncated: boolean }> {
    // Step 2: AI #2 (Answerer) - Answers with best practices
    dualAiLog(`🧠 AI #2: Answering questions with best practices...`);

    const explicitQuestionBlock = questions.length > 0
      ? questions.map((q, idx) => `${idx + 1}. ${q}`).join('\n')
      : '1. Identify the top unresolved product scope risk.\n2. Identify the top unresolved UX risk.\n3. Identify the top unresolved data/operational risk.';
    const improveAnchorContext = opts.isImprovement
      ? this.buildImproveAnchorContext(state.freezeBaselineStructure)
      : '';
    const answererPrompt = `The following PRD is being developed:\n\n${genResult.content}\n\n${improveAnchorContext ? `${improveAnchorContext}\n\n` : ''}Questions to answer explicitly:\n${explicitQuestionBlock}\n\nAnswer ALL questions with best practices. Also identify and resolve any Open Points, Gaps, or unresolved areas in the PRD.${opts.isImprovement ? ' Keep every recommendation inside the existing baseline scope; do not introduce new feature families, personas, runtime models, or infrastructure domains unless explicitly requested.' : ''} Your answers will be incorporated directly into the next PRD revision.`;

    opts.throwIfCancelled(`iteration ${i} answerer call`);
    let answerResult = await this.callIterativeModel(opts, {
      role: 'reviewer',
      systemPrompt: BEST_PRACTICE_ANSWERER_PROMPT + opts.langInstruction,
      userPrompt: answererPrompt,
      maxTokens: ITERATIVE_ANSWERER,
      phase: 'iteration_answerer',
    });

    state.modelsUsed.add(answerResult.model);
    dualAiLog(`✅ Answered with ${answerResult.usage.completion_tokens} tokens using ${answerResult.model}`);
    let answererOutputTruncated = this.looksLikeTruncatedOutput(answerResult.content);
    if (answererOutputTruncated) {
      dualAiWarn(`⚠️ Iteration ${i}: answerer output looks truncated, retrying once with higher token budget...`);
      const retryPrompt = `${answererPrompt}\n\nIMPORTANT: Return a complete final response. Do not end mid-sentence or mid-list.`;
      opts.throwIfCancelled(`iteration ${i} answerer retry`);
      const retryResult = await this.callIterativeModel(opts, {
        role: 'reviewer',
        systemPrompt: BEST_PRACTICE_ANSWERER_PROMPT + opts.langInstruction,
        userPrompt: retryPrompt,
        maxTokens: ITERATIVE_ANSWERER_RETRY,
        phase: 'iteration_answerer_retry',
      });
      state.modelsUsed.add(retryResult.model);
      const retryTruncated = this.looksLikeTruncatedOutput(retryResult.content);
      const shouldUseRetry = !retryTruncated || retryResult.content.length > answerResult.content.length + 120;
      if (shouldUseRetry) {
        answerResult = retryResult;
        answererOutputTruncated = retryTruncated;
        dualAiLog(`✅ Iteration ${i}: using retried answerer output (${retryResult.model})`);
      } else {
        dualAiWarn(`⚠️ Iteration ${i}: retry still appears truncated, keeping original output`);
      }
    }

    this.emitIterativeProgress(opts, { type: 'answerer_done', iteration: i, tokensUsed: answerResult.usage.total_tokens, model: answerResult.model });

    return { answerResult, answererOutputTruncated };
  }

  /**
   * Helper E: Validate structural freeze constraints and apply feature preservation.
   * Returns shouldContinue=true on the rollback/reject paths (replaces `continue`).
   */
  private async validateAndPreserveIterationStructure(
    i: number,
    cleanPRD: string,
    structuredDeltaResult: StructuredFeatureDeltaParseResult,
    state: IterationLoopState,
    opts: IterationOpts
  ): Promise<{ shouldContinue: boolean; preservedPRD: string; candidateStructure: PRDStructure | null }> {
    // Step 3: Extract clean PRD (without Q&A sections) and build iteration log
    const structuredDelta = structuredDeltaResult.delta;

    const rollbackFrozenIteration = (reason: string): boolean => {
      const prevIteration = state.iterations[state.iterations.length - 1];
      if (!prevIteration) {
        dualAiWarn(`⚠️ Iteration ${i}: ${reason}, but no previous iteration to roll back to.`);
        return false;
      }

      state.blockedRegenerationAttempts++;
      state.currentPRD = prevIteration.mergedPRD;
      dualAiWarn(`🚫 Iteration ${i}: ${reason}`);
      dualAiWarn('   Rolled back to previous merged PRD and continuing with next iteration');
      return true;
    };

    // FEATURE FREEZE: Validate no feature loss when frozen
    if (state.featuresFrozen && state.freezeBaselineStructure) {
      const previousIds = state.freezeBaselineStructure.features.map(f => f.id);
      let newStructureForCheck: PRDStructure;
      try {
        newStructureForCheck = parsePRDToStructure(cleanPRD);
      } catch (freezeParseError: any) {
        dualAiWarn(`❌ Iteration ${i}: Freeze validation parse failed: ${freezeParseError.message}`);
        if (rollbackFrozenIteration('freeze validation parse failure')) {
          return { shouldContinue: true, preservedPRD: state.currentPRD, candidateStructure: state.previousStructure };
        }
        newStructureForCheck = state.freezeBaselineStructure;
      }
      const freezeWriteProjectionActive = !!state.freezeBaselineStructure;
      if (freezeWriteProjectionActive) {
        newStructureForCheck = {
          ...newStructureForCheck,
          features: state.freezeBaselineStructure.features.map(f => ({ ...f })),
        };
      }
      const newIds = newStructureForCheck.features.map(f => f.id);

      const lostFeature = previousIds.some(id => !newIds.includes(id));

      if (lostFeature) {
        dualAiWarn('❌ FEATURE LOSS DETECTED WHILE FROZEN');
        dualAiWarn('   Baseline features: ' + previousIds.join(', '));
        dualAiWarn('   New features: ' + newIds.join(', '));
        if (rollbackFrozenIteration('feature loss detected while frozen')) {
          return { shouldContinue: true, preservedPRD: state.currentPRD, candidateStructure: state.previousStructure };
        }
      }

      if (newStructureForCheck.features.length < state.freezeBaselineStructure.features.length) {
        dualAiWarn('❌ FEATURE COUNT DECREASED WHILE FROZEN');
        dualAiWarn('   Baseline: ' + state.freezeBaselineStructure.features.length + ' features');
        dualAiWarn('   New: ' + newStructureForCheck.features.length + ' features');
        if (rollbackFrozenIteration('feature count decreased while frozen')) {
          return { shouldContinue: true, preservedPRD: state.currentPRD, candidateStructure: state.previousStructure };
        }
      }
    }

    // Structural drift detection + feature preservation (non-blocking)
    let preservedPRD = cleanPRD;
    let candidateStructure: PRDStructure | null = null;
    try {
      let currentStructure = parsePRDToStructure(cleanPRD);
      let forceReassembleFromStructure = false;
      const featureWriteLockActive = state.featuresFrozen && !!state.freezeBaselineStructure;

      if (featureWriteLockActive && state.freezeBaselineStructure) {
        currentStructure = {
          ...currentStructure,
          features: state.freezeBaselineStructure.features.map(f => ({ ...f })),
        };
        forceReassembleFromStructure = true;
        dualAiLog(`🔐 Iteration ${i}: Feature write-lock active (direct F-XX rewrites ignored)`);
      }

      const scaffoldResult = this.ensureRequiredSections(currentStructure, {
        workflowInputText: opts.workflowInputText,
        iterationNumber: i,
        contentLanguage: opts.resolvedLanguage,
      });
      currentStructure = scaffoldResult.structure;
      if (scaffoldResult.addedSections.length > 0) {
        forceReassembleFromStructure = true;
        dualAiLog(`🧱 Iteration ${i}: Section scaffold added (${scaffoldResult.addedSections.join(', ')})`);
      }

      if (state.previousStructure) {
        const diff = compareStructures(state.previousStructure, currentStructure);
        const warnings = logStructuralDrift(i, diff);
        if (warnings.length > 0) {
          state.allDriftWarnings.set(i, warnings);
          state.diagnostics.driftEvents += warnings.length;
          if (opts.isImprovement && diff.missingSections.includes('featureCatalogueIntro')) {
            state.diagnostics.earlyDriftDetected = true;
            state.diagnostics.earlyDriftCodes = Array.from(new Set([
              ...(state.diagnostics.earlyDriftCodes || []),
              'section_anchor_mismatch',
            ]));
            state.diagnostics.earlyDriftSections = Array.from(new Set([
              ...(state.diagnostics.earlyDriftSections || []),
              'featureCatalogueIntro',
            ]));
            state.diagnostics.primaryEarlyDriftReason = state.diagnostics.primaryEarlyDriftReason
              || 'Section featureCatalogueIntro drifted away from the baseline anchor during iteration.';
          }
        }

        if (!featureWriteLockActive && diff.removedFeatures.length > 0) {
          dualAiLog(`🔧 Iteration ${i}: Restoring ${diff.removedFeatures.length} lost feature(s)...`);
          currentStructure = restoreRemovedFeatures(state.previousStructure, currentStructure, diff.removedFeatures);
          preservedPRD = assembleStructureToMarkdown(currentStructure);
          forceReassembleFromStructure = true;
          state.allPreservationActions.set(i, [...diff.removedFeatures]);
          state.diagnostics.featurePreservations += diff.removedFeatures.length;
          dualAiLog(`✅ Iteration ${i}: Feature preservation complete, PRD reassembled`);
        }

        if (!featureWriteLockActive) {
          try {
          const integrityResult = enforceFeatureIntegrity(state.previousStructure, currentStructure);
          currentStructure = integrityResult.structure;
          if (integrityResult.restorations.length > 0) {
            preservedPRD = assembleStructureToMarkdown(currentStructure);
            forceReassembleFromStructure = true;
            state.allIntegrityRestorations.set(i, integrityResult.restorations);
            state.diagnostics.featureIntegrityRestores += integrityResult.restorations.length;
            state.diagnostics.autoRecoveredFeatures = (state.diagnostics.autoRecoveredFeatures || 0) + integrityResult.restorations.length;
            state.diagnostics.featureQualityRegressions = (state.diagnostics.featureQualityRegressions || 0) +
              integrityResult.restorations.filter(r => r.qualityRegression).length;
            dualAiLog(`🛡️ Iteration ${i}: Feature integrity enforced, ${integrityResult.restorations.length} feature(s) restored`);
          }
          } catch (integrityError: any) {
            dualAiWarn(`⚠️ Feature integrity check failed for iteration ${i} (non-blocking):`, integrityError.message);
          }
        }
      } else {
        logStructureValidation(currentStructure);
      }

      // Enforce frozen catalogue baseline independently of iterative drift context.
      if (state.featuresFrozen && state.freezeBaselineStructure) {
        const freezeDiff = compareStructures(state.freezeBaselineStructure, currentStructure);
        if (!featureWriteLockActive && freezeDiff.removedFeatures.length > 0) {
          dualAiLog(`🔒 Freeze baseline restore: ${freezeDiff.removedFeatures.length} feature(s)`);
          currentStructure = restoreRemovedFeatures(state.freezeBaselineStructure, currentStructure, freezeDiff.removedFeatures);
          preservedPRD = assembleStructureToMarkdown(currentStructure);
          forceReassembleFromStructure = true;
          const existing = state.allPreservationActions.get(i) || [];
          state.allPreservationActions.set(
            i,
            Array.from(new Set([...existing, ...freezeDiff.removedFeatures]))
          );
          state.diagnostics.featurePreservations += freezeDiff.removedFeatures.length;
        }

        if (!featureWriteLockActive) {
          const freezeIntegrity = enforceFeatureIntegrity(state.freezeBaselineStructure, currentStructure);
          currentStructure = freezeIntegrity.structure;
          if (freezeIntegrity.restorations.length > 0) {
            preservedPRD = assembleStructureToMarkdown(currentStructure);
            forceReassembleFromStructure = true;
            const existing = state.allIntegrityRestorations.get(i) || [];
            state.allIntegrityRestorations.set(i, [...existing, ...freezeIntegrity.restorations]);
            state.diagnostics.featureIntegrityRestores += freezeIntegrity.restorations.length;
            state.diagnostics.autoRecoveredFeatures = (state.diagnostics.autoRecoveredFeatures || 0) + freezeIntegrity.restorations.length;
            state.diagnostics.featureQualityRegressions = (state.diagnostics.featureQualityRegressions || 0) +
              freezeIntegrity.restorations.filter(r => r.qualityRegression).length;
            dualAiLog(`🛡️ Freeze baseline integrity enforced, ${freezeIntegrity.restorations.length} feature(s) restored`);
          }
        }

        // Delta compiler: process only truly new features, block duplicates.
        opts.throwIfCancelled(`iteration ${i} feature delta compile`);
        const deltaResult = await this.compileFeatureDelta({
          currentStructure,
          freezeBaseline: state.freezeBaselineStructure,
          visionContext: extractVisionFromContent(state.currentPRD || cleanPRD),
          workflowInputText: opts.workflowInputText,
          structuredDelta,
          enforceStructuredDeltaOnly: state.featuresFrozen && i >= 2,
          allowNewFeatures: !opts.isImprovement,
          contentLanguage: opts.resolvedLanguage,
          client: opts.client
        });
        currentStructure = deltaResult.structure;
        state.freezeBaselineStructure = deltaResult.freezeBaseline;
        if (deltaResult.addedFeatureIds.length > 0) {
          dualAiLog(`🆕 Iteration ${i}: New feature delta compiled (${deltaResult.addedFeatureIds.join(', ')})`);
          preservedPRD = assembleStructureToMarkdown(currentStructure);
          forceReassembleFromStructure = true;
        }
        if (deltaResult.droppedDuplicates.length > 0) {
          dualAiLog(`🧹 Iteration ${i}: Dropped duplicate feature candidates (${deltaResult.droppedDuplicates.join(', ')})`);
          preservedPRD = assembleStructureToMarkdown(currentStructure);
          forceReassembleFromStructure = true;
        }
        if (deltaResult.blockedAddedFeatures.length > 0) {
          state.diagnostics.blockedAddedFeatures = Array.from(new Set([
            ...(state.diagnostics.blockedAddedFeatures || []),
            ...deltaResult.blockedAddedFeatures,
          ]));
          state.diagnostics.earlyDriftDetected = true;
          state.diagnostics.earlyDriftCodes = Array.from(new Set([
            ...(state.diagnostics.earlyDriftCodes || []),
            'improve_new_feature_blocked',
          ]));
          dualAiWarn(`🚫 Iteration ${i}: blocked improve-mode feature delta additions (${deltaResult.blockedAddedFeatures.join(', ')})`);
        }
      }

      if (forceReassembleFromStructure) {
        preservedPRD = assembleStructureToMarkdown(currentStructure);
      }

      candidateStructure = currentStructure;
    } catch (preserveError: any) {
      dualAiWarn(`⚠️ Feature preservation failed for iteration ${i} (non-blocking, using cleanPRD):`, preserveError.message);
      preservedPRD = cleanPRD;
    }

    // Hard acceptance gates: reject unsafe iteration outputs and keep last stable state.
    if (!candidateStructure) {
      try {
        candidateStructure = parsePRDToStructure(preservedPRD);
      } catch (parseGateError: any) {
        dualAiWarn(`⚠️ Iteration ${i}: Gate parse failed: ${parseGateError.message}`);
      }
    }

    const gateResult = this.validateIterationAcceptance({
      structure: candidateStructure,
      freezeBaseline: state.freezeBaselineStructure,
      featuresFrozen: state.featuresFrozen,
      iterationNumber: i,
      structuredDeltaResult,
    });

    if (!gateResult.accepted) {
      dualAiWarn(`🚫 Iteration ${i}: Rejected by acceptance gates`);
      for (const reason of gateResult.reasons) {
        dualAiWarn(`   - ${reason}`);
      }

      const prevIteration = state.iterations[state.iterations.length - 1];
      if (prevIteration) {
        state.blockedRegenerationAttempts++;
        preservedPRD = prevIteration.mergedPRD;
        try {
          candidateStructure = parsePRDToStructure(preservedPRD);
        } catch {
          candidateStructure = state.previousStructure;
        }
      }
    }

    if (candidateStructure) {
      state.previousStructure = candidateStructure;
    }
    return { shouldContinue: false, preservedPRD, candidateStructure };
  }

  /**
   * Helper F: Run the optional final review (AI #3).
   */
  private async runOptionalFinalReview(
    state: IterationLoopState,
    opts: IterationOpts
  ): Promise<IterativeResponse['finalReview']> {
    let finalReview: IterativeResponse['finalReview'] = undefined;

    // Optional: Final Review with AI #3
    if (opts.useFinalReview) {
      opts.throwIfCancelled('final review start');
      dualAiLog('\n🎯 AI #3: Final review and polish...');
      this.emitIterativeProgress(opts, { type: 'final_review_start' });

      const finalReviewerPrompt = `Review the following PRD at the highest level:\n\n${state.currentPRD}`;

      opts.throwIfCancelled('final reviewer call');
      const reviewResult = await this.callIterativeModel(opts, {
        role: 'reviewer',
        systemPrompt: FINAL_REVIEWER_PROMPT + opts.langInstruction,
        userPrompt: finalReviewerPrompt,
        maxTokens: REVIEW_FINAL,
        phase: 'final_review',
      });

      state.modelsUsed.add(reviewResult.model);
      dualAiLog(`✅ Final review complete with ${reviewResult.usage.completion_tokens} tokens`);
      this.emitIterativeProgress(opts, { type: 'final_review_done', tokensUsed: reviewResult.usage.total_tokens });

      finalReview = {
        content: reviewResult.content,
        model: reviewResult.model,
        usage: reviewResult.usage,
        tier: reviewResult.tier
      };
    }

    return finalReview;
  }

  /**
   * Helper G: Apply final hardening, section scaffolding, NFR coverage, and compiler gates.
   */
  private async finalizeIterativeWorkflow(
    state: IterationLoopState,
    opts: IterationOpts
  ): Promise<{ finalPRD: string; hardenedStructure: PRDStructure | undefined; compilerRepairTokens: number; compilerArtifact?: import('./compilerArtifact').CompilerArtifactSummary }> {
    let currentPRD = state.currentPRD;
    let compilerArtifact: import('./compilerArtifact').CompilerArtifactSummary | undefined;

    // Final hardening: guarantee all required non-feature sections are present in final output.
    let finalHardenedStructure: PRDStructure | undefined;
    try {
      let finalStructure = parsePRDToStructure(currentPRD);

      // Merge enriched expansion data into final structure if available
      if (state.iterativeEnrichedStructure) {
        finalStructure = mergeExpansionIntoStructure(finalStructure,
          state.iterativeEnrichedStructure.features.map(f => ({
            featureId: f.id,
            featureName: f.name,
            content: f.rawContent,
            model: 'merged',
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            retried: false,
            valid: true,
            compiled: true,
          }))
        );
      }

      if (state.featuresFrozen && state.freezeBaselineStructure) {
        finalStructure = this.mergeWithFreezeBaseline(finalStructure, state.freezeBaselineStructure);
      }
      finalStructure = this.normalizeSectionAliases(finalStructure);
      const finalScaffold = this.ensureRequiredSections(finalStructure, {
        workflowInputText: opts.workflowInputText,
        iterationNumber: opts.iterationCount,
        contentLanguage: opts.resolvedLanguage,
      });
      let hardenedStructure = this.enforceCanonicalFeatureStructure(finalScaffold.structure, opts.resolvedLanguage);
      const nfrHardening = this.enforceNfrCoverage(hardenedStructure, opts.resolvedLanguage);
      hardenedStructure = nfrHardening.structure;
      state.diagnostics.nfrGlobalCategoryAdds = (state.diagnostics.nfrGlobalCategoryAdds || 0) + nfrHardening.globalCategoryAdds;
      state.diagnostics.nfrFeatureCriteriaAdds = (state.diagnostics.nfrFeatureCriteriaAdds || 0) + nfrHardening.featureCriteriaAdds;
      hardenedStructure = this.normalizeSectionAliases(hardenedStructure);
      finalHardenedStructure = hardenedStructure;
      currentPRD = assembleStructureToMarkdown(hardenedStructure);
      if (state.iterations.length > 0) {
        state.iterations[state.iterations.length - 1].mergedPRD = currentPRD;
      }
      if (finalScaffold.addedSections.length > 0) {
        dualAiLog(`🧱 Final scaffold added (${finalScaffold.addedSections.join(', ')})`);
      } else {
        dualAiLog('🧱 Final canonical assembly complete');
      }
      if (nfrHardening.globalCategoryAdds > 0 || nfrHardening.featureCriteriaAdds > 0) {
        dualAiLog(`🛡️ NFR hardening: +${nfrHardening.globalCategoryAdds} global categories, +${nfrHardening.featureCriteriaAdds} feature criteria`);
      }
    } catch (finalScaffoldError: any) {
      dualAiWarn(`⚠️ Final scaffold hardening failed (non-blocking): ${finalScaffoldError.message}`);
    }

    let compilerRepairTokens = 0;
    try {
      const repairSystemPrompt = (opts.isImprovement
        ? IMPROVEMENT_SYSTEM_PROMPT
        : GENERATOR_SYSTEM_PROMPT) + opts.langInstruction;
      const initialModel = Array.from(state.modelsUsed).at(-1) || 'iterative-generator';
      const primaryGenerator = opts.client.getPreferredModel('generator') || '';

      const iterFinalizerOpts = {
        mode: (opts.isImprovement ? 'improve' : 'generate') as 'improve' | 'generate',
        existingContent: opts.isImprovement ? opts.existingContent : undefined,
        language: opts.resolvedLanguage,
        templateCategory: opts.templateCategory,
        originalRequest: opts.workflowInputText || currentPRD.slice(0, 400),
        maxRepairPasses: 3,
        cancelCheck: opts.throwIfCancelled,
        repairReviewer: async (repairPrompt: string, _pass: number) => {
          const repairResult = await this.callIterativeModel(opts, {
            role: 'reviewer',
            systemPrompt: repairSystemPrompt,
            userPrompt: repairPrompt,
            maxTokens: 12000,
            phase: 'compiler_repair',
          });
          return {
            content: repairResult.content,
            model: repairResult.model,
            usage: repairResult.usage,
            finishReason: repairResult.finishReason,
          };
        },
      contentRefineReviewer: async (refinePrompt: string) => {
          const refineResult = await this.callIterativeModel(opts, {
            role: 'reviewer',
            systemPrompt: 'You are a PRD content refinement specialist. Follow the instructions precisely.' + opts.langInstruction,
            userPrompt: refinePrompt,
            maxTokens: CONTENT_REVIEW_REFINE,
            phase: 'content_review',
          });
          return {
            content: refineResult.content,
            model: refineResult.model,
            usage: refineResult.usage,
            finishReason: refineResult.finishReason,
          };
        },
        semanticRefineReviewer: async (refinePrompt: string) => {
          const refineResult = await this.callIterativeModel(opts, {
            role: 'reviewer',
            systemPrompt: 'You are a PRD semantic repair specialist. Return JSON only.' + opts.langInstruction,
            userPrompt: refinePrompt,
            maxTokens: CONTENT_REVIEW_REFINE,
            responseFormat: { type: 'json_object' },
            temperature: 0.1,
            phase: 'semantic_repair',
          });
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
          const verifyResult = await this.callIterativeModel(opts, {
            role: 'verifier',
            systemPrompt: 'You are a strict PRD semantic verifier. Return JSON only.' + opts.langInstruction,
            userPrompt: verifyPrompt,
            maxTokens: SEMANTIC_VERIFICATION,
            responseFormat: { type: 'json_object' },
            temperature: 0.1,
            phase: 'semantic_verification',
            constraints: {
              avoidModelFamilies: input.avoidModelFamilies,
              allowSameFamilyFallback: true,
              onSameFamilyFallback: ({ model, family, blockedFamilies }: any) => {
                sameFamilyFallback = true;
                dualAiWarn(
                  `Semantic verifier fell back to blocked family ${family || 'unknown'} ` +
                  `with ${model}. Blocked families: ${blockedFamilies.join(', ') || 'none'}`
                );
              },
            },
          });
          const parsed = parseSemanticVerificationResponse({
            content: verifyResult.content,
            model: verifyResult.model,
            usage: verifyResult.usage,
          });
          return sameFamilyFallback
            ? {
                ...parsed,
                sameFamilyFallback: true,
                blockedFamilies: input.avoidModelFamilies || [],
              }
            : parsed;
        },
        onStageProgress: (event: {
          type: 'content_review_start' | 'semantic_verification_start' | 'semantic_repair_start' | 'semantic_repair_done';
          issueCount?: number;
          sectionKeys?: string[];
          applied?: boolean;
          truncated?: boolean;
        }) =>
          this.emitIterativeProgress(opts, event),
      };

      let compilerFinalized;
      try {
        compilerFinalized = await finalizeWithCompilerGates({
          initialResult: {
            content: currentPRD,
            model: initialModel,
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          },
          ...iterFinalizerOpts,
        });
      } catch (error) {
        if (!(error instanceof PrdCompilerQualityError)) throw error;
        if (error.failureStage === 'semantic_verifier') throw error;

        const triedModels = error.repairAttempts.map(a => a.model);
        const fallbackModel = pickNextFallbackModel(opts.client, primaryGenerator, triedModels);
        if (!fallbackModel) throw error;

        dualAiLog(`⚡ Iterative quality fallback: ${primaryGenerator} → ${fallbackModel}`);
        opts.client.setPreferredModel('generator', fallbackModel);

        try {
          // For iterative mode, retry finalization with fallback repair model
          // (re-generating the full iterative output is too expensive)
          compilerFinalized = await finalizeWithCompilerGates({
            initialResult: {
              content: currentPRD,
              model: initialModel,
              usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            },
            ...iterFinalizerOpts,
          });
          dualAiLog(`✅ Iterative quality fallback succeeded with ${fallbackModel}`);
        } catch (fallbackError) {
          if ((fallbackError as any)?.name === 'AbortError' || (fallbackError as any)?.code === 'ERR_CLIENT_DISCONNECT') {
            throw fallbackError;
          }
          if (fallbackError instanceof PrdCompilerQualityError && fallbackError.failureStage === 'semantic_verifier') {
            throw fallbackError;
          }
          const degraded = pickBestDegradedResult(error, fallbackError);
          if (degraded) {
            dualAiLog(`⚠️ Both models failed quality gates — returning best degraded result`);
            compilerFinalized = degraded;
          } else {
            throw error;
          }
        } finally {
          opts.client.setPreferredModel('generator', primaryGenerator);
        }
      }

      currentPRD = this.sanitizeFinalMarkdown(compilerFinalized.content);
      finalHardenedStructure = compilerFinalized.structure;
      compilerArtifact = summarizeFinalizerResult(compilerFinalized);
      Object.assign(state.diagnostics, buildCompilerArtifactDiagnostics(compilerArtifact));
      compilerRepairTokens = compilerFinalized.repairAttempts.reduce(
        (sum, attempt) => sum + attempt.usage.total_tokens,
        0
      );
      for (const attempt of compilerFinalized.repairAttempts) {
        state.modelsUsed.add(attempt.model);
      }
      for (const attempt of compilerFinalized.reviewerAttempts || []) {
        state.modelsUsed.add(attempt.model);
        compilerRepairTokens += attempt.usage.total_tokens;
      }
      for (const verification of compilerFinalized.semanticVerificationHistory || []) {
        state.modelsUsed.add(verification.model);
        compilerRepairTokens += verification.usage.total_tokens;
      }
      if (compilerFinalized.repairAttempts.length > 0) {
        dualAiLog(`🧱 Unified compiler repair passes: ${compilerFinalized.repairAttempts.length}`);
      }
    } catch (compilerFinalizationError: any) {
      if (compilerFinalizationError instanceof PrdCompilerQualityError) {
        const wrappedQualityError = new PrdCompilerQualityError(
          `Unified compiler finalization failed: ${compilerFinalizationError.message}`,
          compilerFinalizationError.quality,
          compilerFinalizationError.repairAttempts,
          compilerFinalizationError.compiledContent && compilerFinalizationError.compiledStructure
            ? {
                content: compilerFinalizationError.compiledContent,
                structure: compilerFinalizationError.compiledStructure,
              }
            : undefined,
          {
            reviewerAttempts: compilerFinalizationError.reviewerAttempts,
            semanticVerification: compilerFinalizationError.semanticVerification,
            failureStage: compilerFinalizationError.failureStage,
            semanticRepairApplied: compilerFinalizationError.semanticRepairApplied,
            semanticRepairAttempted: compilerFinalizationError.semanticRepairAttempted,
            semanticRepairIssueCodes: compilerFinalizationError.semanticRepairIssueCodes,
            semanticRepairSectionKeys: compilerFinalizationError.semanticRepairSectionKeys,
            semanticRepairTruncated: compilerFinalizationError.semanticRepairTruncated,
            initialSemanticBlockingIssues: compilerFinalizationError.initialSemanticBlockingIssues,
            postRepairSemanticBlockingIssues: compilerFinalizationError.postRepairSemanticBlockingIssues,
            finalSemanticBlockingIssues: compilerFinalizationError.finalSemanticBlockingIssues,
            repairGapReason: compilerFinalizationError.repairGapReason,
            repairCycleCount: compilerFinalizationError.repairCycleCount,
            earlySemanticLintCodes: compilerFinalizationError.earlySemanticLintCodes,
            primaryCapabilityAnchors: compilerFinalizationError.primaryCapabilityAnchors,
            featurePriorityWindow: compilerFinalizationError.featurePriorityWindow,
            coreFeatureIds: compilerFinalizationError.coreFeatureIds,
            supportFeatureIds: compilerFinalizationError.supportFeatureIds,
            canonicalFeatureIds: compilerFinalizationError.canonicalFeatureIds,
            timelineMismatchedFeatureIds: compilerFinalizationError.timelineMismatchedFeatureIds,
            timelineRewrittenFromFeatureMap: compilerFinalizationError.timelineRewrittenFromFeatureMap,
            compilerRepairTruncationCount: compilerFinalizationError.compilerRepairTruncationCount,
            compilerRepairFinishReasons: compilerFinalizationError.compilerRepairFinishReasons,
            repairRejected: compilerFinalizationError.repairRejected,
            repairRejectedReason: compilerFinalizationError.repairRejectedReason,
            repairDegradationSignals: compilerFinalizationError.repairDegradationSignals,
            degradedCandidateAvailable: compilerFinalizationError.degradedCandidateAvailable,
            degradedCandidateSource: compilerFinalizationError.degradedCandidateSource,
            displayedCandidateSource: compilerFinalizationError.displayedCandidateSource,
            diagnosticsAlignedWithDisplayedCandidate: compilerFinalizationError.diagnosticsAlignedWithDisplayedCandidate,
            collapsedFeatureNameIds: compilerFinalizationError.collapsedFeatureNameIds,
            placeholderFeatureIds: compilerFinalizationError.placeholderFeatureIds,
            acceptanceBoilerplateFeatureIds: compilerFinalizationError.acceptanceBoilerplateFeatureIds,
            featureQualityFloorFeatureIds: compilerFinalizationError.featureQualityFloorFeatureIds,
            featureQualityFloorFailedFeatureIds: compilerFinalizationError.featureQualityFloorFailedFeatureIds,
            featureQualityFloorPassed: compilerFinalizationError.featureQualityFloorPassed,
            primaryFeatureQualityReason: compilerFinalizationError.primaryFeatureQualityReason,
            emptyMainFlowFeatureIds: compilerFinalizationError.emptyMainFlowFeatureIds,
            placeholderPurposeFeatureIds: compilerFinalizationError.placeholderPurposeFeatureIds,
            placeholderAlternateFlowFeatureIds: compilerFinalizationError.placeholderAlternateFlowFeatureIds,
            thinAcceptanceCriteriaFeatureIds: compilerFinalizationError.thinAcceptanceCriteriaFeatureIds,
            semanticRepairChangedSections: compilerFinalizationError.semanticRepairChangedSections,
            semanticRepairStructuralChange: compilerFinalizationError.semanticRepairStructuralChange,
            earlyDriftDetected: compilerFinalizationError.earlyDriftDetected,
            earlyDriftCodes: compilerFinalizationError.earlyDriftCodes,
            earlyDriftSections: compilerFinalizationError.earlyDriftSections,
            blockedAddedFeatures: compilerFinalizationError.blockedAddedFeatures,
            earlyRepairAttempted: compilerFinalizationError.earlyRepairAttempted,
            earlyRepairApplied: compilerFinalizationError.earlyRepairApplied,
            primaryEarlyDriftReason: compilerFinalizationError.primaryEarlyDriftReason,
          }
        );
        wrappedQualityError.stack = compilerFinalizationError.stack;
        throw wrappedQualityError;
      }
      if (compilerFinalizationError instanceof PrdCompilerRuntimeError) {
        const wrappedRuntimeError = new PrdCompilerRuntimeError({
          message: `Unified compiler finalization failed: ${compilerFinalizationError.message}`,
          failureStage: compilerFinalizationError.failureStage,
          providerFailureStage: compilerFinalizationError.providerFailureStage,
          runtimeFailureCode: compilerFinalizationError.runtimeFailureCode,
          providerFailureSummary: compilerFinalizationError.providerFailureSummary,
          providerFailureCounts: compilerFinalizationError.providerFailureCounts,
          providerFailedModels: compilerFinalizationError.providerFailedModels,
          compiledResult:
            compilerFinalizationError.compiledContent && compilerFinalizationError.compiledStructure
              ? {
                  content: compilerFinalizationError.compiledContent,
                  structure: compilerFinalizationError.compiledStructure,
                }
              : undefined,
          repairAttempts: compilerFinalizationError.repairAttempts,
          reviewerAttempts: compilerFinalizationError.reviewerAttempts,
          compilerRepairTruncationCount: compilerFinalizationError.compilerRepairTruncationCount,
          compilerRepairFinishReasons: compilerFinalizationError.compilerRepairFinishReasons,
          degradedCandidateAvailable: compilerFinalizationError.degradedCandidateAvailable,
          degradedCandidateSource: compilerFinalizationError.degradedCandidateSource,
        });
        wrappedRuntimeError.stack = compilerFinalizationError.stack;
        throw wrappedRuntimeError;
      }
      if (compilerFinalizationError?.name === 'AbortError' || compilerFinalizationError?.code === 'ERR_CLIENT_DISCONNECT') {
        throw compilerFinalizationError;
      }
      throw new Error(`Unified compiler finalization failed: ${compilerFinalizationError.message}`);
    }

    if (state.iterations.length > 0) {
      state.iterations[state.iterations.length - 1].mergedPRD = currentPRD;
    }

    state.currentPRD = currentPRD;
    return { finalPRD: currentPRD, hardenedStructure: finalHardenedStructure, compilerRepairTokens, compilerArtifact };
  }


  private async writeArtifactAliasAtomically(targetPath: string, serialized: string): Promise<void> {
    const tempPath = path.join(
      path.dirname(targetPath),
      `${path.basename(targetPath)}.${process.pid}.${Date.now()}_${Math.random().toString(36).slice(2, 8)}.tmp`,
    );

    try {
      await fs.promises.writeFile(tempPath, serialized, 'utf8');
      // Same-directory rename keeps the stable alias update atomic for readers.
      await fs.promises.rename(tempPath, targetPath);
    } catch (error) {
      await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async writeIterativeArtifacts(payload: {
    finalContent: string;
    mergedPRD: string;
    iterationLog: string;
    iterations: IterativeResponse['iterations'];
    finalReview?: IterativeResponse['finalReview'];
    totalTokens: number;
    modelsUsed: string[];
    diagnostics?: CompilerDiagnostics;
    compilerArtifact?: import('./compilerArtifact').CompilerArtifactSummary;
  }): Promise<{ ok: boolean; issues: string[]; files: string[] }> {
    const issues: string[] = [];
    const repoRoot = process.cwd();
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const artifacts = [
      {
        timestampedPath: path.join(repoRoot, `.tmp_run_response_${suffix}.json`),
        latestAliasPath: path.join(repoRoot, '.tmp_run_response.json'),
      },
      {
        timestampedPath: path.join(repoRoot, `.tmp_run_final_gate_verify_${suffix}.json`),
        latestAliasPath: path.join(repoRoot, '.tmp_run_final_gate_verify.json'),
      },
    ];

    let serialized: string;
    try {
      serialized = JSON.stringify(payload, null, 2) + '\n';
    } catch (error) {
      logger.error('Dual AI iterative artifact payload serialization failed', {
        error,
      });
      try {
        const seen = new WeakSet<object>();
        serialized = JSON.stringify(payload, (_key, value) => {
          if (typeof value === 'bigint') {
            return value.toString();
          }
          if (value instanceof Error) {
            return {
              name: value.name,
              message: value.message,
              stack: value.stack,
            };
          }
          if (value && typeof value === 'object') {
            const objectValue = value as object;
            if (seen.has(objectValue)) {
              return '[Circular]';
            }
            seen.add(objectValue);
          }
          return value;
        }, 2) + '\n';
      } catch (fallbackError) {
        logger.error('Dual AI iterative artifact fallback serialization failed', {
          error: fallbackError,
        });
        serialized = JSON.stringify({
          _serializationFailed: true,
          error: error instanceof Error ? error.message : String(error),
        }, null, 2) + '\n';
      }
    }

    await Promise.all(
      artifacts.map(async ({ timestampedPath, latestAliasPath }) => {
        await fs.promises.writeFile(timestampedPath, serialized, 'utf8');
        await this.writeArtifactAliasAtomically(latestAliasPath, serialized);
      }),
    );

    const expectedSize = Buffer.byteLength(serialized, 'utf8');
    for (const { timestampedPath, latestAliasPath } of artifacts) {
      for (const target of [timestampedPath, latestAliasPath]) {
        const after = await fs.promises.stat(target);
        if (after.size !== expectedSize) {
          issues.push(`${path.basename(target)} size ${after.size} != expected ${expectedSize}`);
        }
      }
    }

    return {
      ok: issues.length === 0,
      issues,
      files: artifacts.flatMap(({ timestampedPath, latestAliasPath }) => [
        path.basename(timestampedPath),
        path.basename(latestAliasPath),
      ]),
    };
  }

  private extractQuestionsFromIterativeOutput(generatorOutput: string): string[] {
    const questionPatterns = [
      /##\s*(?:Fragen zur Verbesserung|Questions for Improvement|Offene Fragen|Open Questions)\s*([\s\S]*?)(?=##|$)/i,
    ];

    let questionSection = '';
    for (const pattern of questionPatterns) {
      const match = generatorOutput.match(pattern);
      if (match?.[1]) {
        questionSection = match[1];
        break;
      }
    }

    if (!questionSection.trim()) {
      return [];
    }

    const rawLines = questionSection
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    const extracted: string[] = [];
    for (const line of rawLines) {
      const question = this.normalizeQuestionLine(line);
      if (question) {
        extracted.push(question);
      }
    }

    return this.mergeQuestions([], extracted);
  }

  private normalizeQuestionLine(line: string): string | null {
    const stripped = line
      .replace(/^\d+[\.\)]\s+/, '')
      .replace(/^[-*]\s+/, '')
      .replace(/^\*{0,2}(?:Question|Frage)\s*\d*\s*:\*{0,2}\s*/i, '')
      .trim();

    if (stripped.length < 8) return null;
    const looksLikeQuestion =
      stripped.includes('?') ||
      /^(?:how|what|which|why|when|where|wer|wie|was|welche|warum|wann|wo)\b/i.test(stripped);

    if (!looksLikeQuestion) return null;
    return stripped.endsWith('?') ? stripped : `${stripped}?`;
  }

  private mergeQuestions(primary: string[], secondary: string[]): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];

    for (const q of [...primary, ...secondary]) {
      const normalized = q.trim();
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(normalized);
    }

    return merged.slice(0, 5);
  }

  private getDeterministicFallbackQuestions(minCount: number): string[] {
    const pool = [
      'Which requirement is still too ambiguous to implement without assumptions?',
      'What is the highest UX risk that could block user adoption in the first release?',
      'Which data validation or integrity rule is still missing for critical workflows?',
      'What is the biggest operational risk in deployment/monitoring for this scope?',
      'Which acceptance criterion is currently not objectively testable and needs refinement?'
    ];
    return pool.slice(0, Math.max(0, Math.min(minCount, pool.length)));
  }

  private validateIterationAcceptance(params: {
    structure: PRDStructure | null;
    freezeBaseline: PRDStructure | null;
    featuresFrozen: boolean;
    iterationNumber: number;
    structuredDeltaResult: StructuredFeatureDeltaParseResult;
  }): { accepted: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const { structure, freezeBaseline, featuresFrozen, iterationNumber, structuredDeltaResult } = params;

    if (!structure) {
      reasons.push('structure unavailable after preservation step');
      return { accepted: false, reasons };
    }

    const idSeen = new Set<string>();
    const nameSeen = new Set<string>();
    for (const feature of structure.features) {
      const canonicalId = normalizeFeatureId(feature.id) || String(feature.id || '').trim().toUpperCase();
      if (!canonicalId) {
        reasons.push(`invalid feature id detected: ${feature.id}`);
        continue;
      }
      if (idSeen.has(canonicalId)) {
        reasons.push(`duplicate feature id detected: ${canonicalId}`);
      } else {
        idSeen.add(canonicalId);
      }

      const normalizedName = this.normalizeFeatureName(feature.name);
      if (normalizedName.length > 0) {
        if (nameSeen.has(normalizedName)) {
          reasons.push(`duplicate feature name detected: ${feature.name}`);
        } else {
          nameSeen.add(normalizedName);
        }
      }
    }

    if (featuresFrozen && freezeBaseline) {
      if (structure.features.length < freezeBaseline.features.length) {
        reasons.push(`feature count below freeze baseline (${structure.features.length} < ${freezeBaseline.features.length})`);
      }

      const currentIds = new Set(
        structure.features
          .map(f => normalizeFeatureId(f.id) || String(f.id || '').trim().toUpperCase())
          .filter(Boolean)
      );
      for (const frozenFeature of freezeBaseline.features) {
        const frozenId = normalizeFeatureId(frozenFeature.id) || String(frozenFeature.id || '').trim().toUpperCase();
        if (!frozenId) continue;
        if (!currentIds.has(frozenId)) {
          reasons.push(`frozen feature missing: ${frozenId}`);
        }
      }
    }

    if (featuresFrozen && iterationNumber >= 2 && !structuredDeltaResult.valid) {
      reasons.push(`invalid structured feature delta (${structuredDeltaResult.error || 'unknown'})`);
    }

    return {
      accepted: reasons.length === 0,
      reasons,
    };
  }

  private async generateClarifyingQuestions(
    prdContent: string,
    client: OpenRouterClient,
    langInstruction: string,
    minCount: number,
    improveAnchorContext?: string,
    abortSignal?: AbortSignal,
    onModelAttempt?: (attempt: ModelCallAttemptUpdate) => void,
  ): Promise<string[]> {
    try {
      const prompt = `Review this PRD and generate ${minCount} to 5 concrete clarifying questions about unresolved scope, UX, and operational gaps.\n\n${improveAnchorContext ? `${improveAnchorContext}\n\nFor improve mode, stay inside the existing baseline scope and do not widen the product.\n\n` : ''}Return ONLY numbered questions.\n\nPRD:\n${prdContent}`;
      const result = await client.callWithFallback(
        'reviewer',
        REVIEWER_SYSTEM_PROMPT + langInstruction,
        prompt,
        ITERATIVE_CLARIFYING_Q,
        undefined,
        undefined,
        {
          abortSignal,
          phase: 'clarifying_questions',
          onAttemptUpdate: onModelAttempt,
        }
      );
      const lines = result.content.split('\n').map(l => l.trim()).filter(Boolean);
      const parsed: string[] = [];
      for (const line of lines) {
        const question = this.normalizeQuestionLine(line);
        if (question) parsed.push(question);
      }
      return this.mergeQuestions([], parsed).slice(0, Math.max(3, minCount));
    } catch (error: any) {
      dualAiWarn(`⚠️ Fallback question synthesis failed: ${error.message}`);
      return [];
    }
  }

  private buildImproveAnchorContext(baselineStructure: PRDStructure | null | undefined): string {
    if (!baselineStructure) return '';
    const featureIndex = (baselineStructure.features || [])
      .slice(0, 20)
      .map(feature => {
        const featureId = normalizeFeatureId(feature.id) || String(feature.id || '').trim().toUpperCase();
        const featureName = String(feature.name || featureId || '').trim();
        return featureId && featureName ? `- ${featureId}: ${featureName}` : null;
      })
      .filter((entry): entry is string => Boolean(entry))
      .join('\n') || '- (no baseline features)';

    return [
      'BASELINE ANCHORS (DO NOT CONTRADICT OR WIDEN):',
      `- System Vision: ${String(baselineStructure.systemVision || '(missing)').slice(0, 320)}`,
      `- System Boundaries: ${String(baselineStructure.systemBoundaries || '(missing)').slice(0, 320)}`,
      `- Domain Model: ${String(baselineStructure.domainModel || '(missing)').slice(0, 320)}`,
      `- Global Business Rules: ${String(baselineStructure.globalBusinessRules || '(missing)').slice(0, 320)}`,
      `- Out of Scope: ${String(baselineStructure.outOfScope || '(missing)').slice(0, 320)}`,
      '- Baseline Feature IDs and Names:',
      featureIndex,
    ].join('\n');
  }

  private collectImproveMeaningfulTokens(value: unknown): string[] {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9äöüß\s-]/gi, ' ')
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token =>
        token.length >= 4
        && !['feature', 'system', 'scope', 'user', 'users', 'flow', 'flows', 'with', 'that', 'this', 'fuer', 'für', 'oder', 'und'].includes(token)
      );
  }

  private collectImproveTokenOverlap(left: unknown, right: unknown): number {
    const leftTokens = new Set(this.collectImproveMeaningfulTokens(left));
    const rightTokens = new Set(this.collectImproveMeaningfulTokens(right));
    if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

    let overlap = 0;
    for (const token of leftTokens) {
      if (rightTokens.has(token)) overlap++;
    }

    return overlap / Math.min(leftTokens.size, rightTokens.size);
  }

  private normalizeImproveFeatureName(value: unknown): string[] {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9äöüß\s-]/gi, ' ')
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token.length >= 3 && !['the', 'and', 'for', 'mit', 'und', 'fuer', 'für'].includes(token));
  }

  private collectImproveDriftEvaluation(params: {
    baselineStructure: PRDStructure;
    candidateStructure: PRDStructure;
    workflowInputText: string;
    language: 'de' | 'en';
    blockedAddedFeatures?: string[];
  }): ImproveDriftEvaluation {
    const issues: ImproveDriftFinding[] = [];
    const seen = new Set<string>();
    const blockedAddedFeatures = Array.from(new Set((params.blockedAddedFeatures || []).filter(Boolean)));
    const semanticLintCodes = new Set<string>();
    const requestTokens = new Set(this.collectImproveMeaningfulTokens(params.workflowInputText));
    const infraKeywords = [
      'kubernetes',
      'matchmaking',
      'leaderboard',
      'multiplayer',
      'websocket',
      'microservice',
      'microservices',
      'redis',
      'kafka',
      'terraform',
      's3',
      'cicd',
      'pipeline',
      'docker',
    ];

    const pushIssue = (issue: ImproveDriftFinding) => {
      const key = JSON.stringify([
        issue.code,
        issue.sectionKey,
        issue.message,
        issue.suggestedAction || '',
        issue.targetFields || [],
      ]);
      if (seen.has(key)) return;
      seen.add(key);
      issues.push(issue);
    };

    const featureTargetFieldsFromEvidencePath = (evidencePath: string): ContentIssue['targetFields'] => {
      const normalized = String(evidencePath || '').trim();
      if (normalized.includes('.dataImpact')) {
        return ['dataImpact'];
      }
      if (normalized.includes('.preconditions')) {
        return ['preconditions', 'dataImpact'];
      }
      if (normalized.includes('.postconditions')) {
        return ['postconditions', 'dataImpact'];
      }
      if (normalized.includes('.mainFlow')) {
        return ['mainFlow', 'dataImpact'];
      }
      if (normalized.includes('.acceptanceCriteria')) {
        return ['acceptanceCriteria', 'dataImpact'];
      }
      return ['mainFlow', 'preconditions', 'postconditions', 'dataImpact'];
    };

    const featureSectionsFromDeterministicIssue = (issue: DeterministicSemanticIssue): string[] => {
      const candidates = new Set<string>();
      const paths = [
        issue.evidencePath,
        ...(issue.relatedPaths || []),
      ].filter((value): value is string => Boolean(String(value || '').trim()));

      for (const pathValue of paths) {
        const normalized = String(pathValue || '').trim();
        if (normalized.startsWith('feature:')) {
          candidates.add(normalized.split('.')[0]);
        }
      }

      return Array.from(candidates);
    };

    if (blockedAddedFeatures.length > 0) {
      pushIssue({
        code: 'improve_new_feature_blocked',
        sectionKey: 'featureCatalogueIntro',
        message: `Improve mode blocked new feature additions: ${blockedAddedFeatures.join(', ')}.`,
        severity: 'error',
        suggestedAction: 'rewrite',
      });
    }

    const baselineFeatures = new Map(
      (params.baselineStructure.features || [])
        .map(feature => {
          const featureId = normalizeFeatureId(feature.id) || String(feature.id || '').trim().toUpperCase();
          return featureId ? [featureId, feature] as const : null;
        })
        .filter((entry): entry is readonly [string, FeatureSpec] => Boolean(entry))
    );

    for (const feature of params.candidateStructure.features || []) {
      const featureId = normalizeFeatureId(feature.id) || String(feature.id || '').trim().toUpperCase();
      if (!featureId) continue;
      const baselineFeature = baselineFeatures.get(featureId);
      if (!baselineFeature) continue;

      const baselineNameTokens = this.normalizeImproveFeatureName(baselineFeature.name);
      const candidateNameTokens = this.normalizeImproveFeatureName(feature.name);
      const overlap = this.collectImproveTokenOverlap(
        baselineNameTokens.join(' '),
        candidateNameTokens.join(' '),
      );
      if (baselineNameTokens.length > 0 && candidateNameTokens.length > 0 && overlap < 0.34) {
        pushIssue({
          code: 'feature_scope_drift_detected',
          sectionKey: `feature:${featureId}`,
          message: `Baseline feature ${featureId} drifted from "${baselineFeature.name}" to "${feature.name}", which changes the baseline feature family.`,
          severity: 'error',
          suggestedAction: 'enrich',
          targetFields: ['purpose', 'trigger', 'dataImpact', 'uiImpact'] as ContentIssue['targetFields'],
        });
      }
    }

    const comparableSections: Array<keyof PRDStructure> = [
      'systemVision',
      'systemBoundaries',
      'deployment',
      'domainModel',
      'globalBusinessRules',
      'outOfScope',
    ];
    for (const sectionKey of comparableSections) {
      const baselineValue = String((params.baselineStructure as any)[sectionKey] || '').trim();
      const candidateValue = String((params.candidateStructure as any)[sectionKey] || '').trim();
      if (!baselineValue || !candidateValue) continue;

      const overlap = this.collectImproveTokenOverlap(baselineValue, candidateValue);
      const baselineTokenCount = this.collectImproveMeaningfulTokens(baselineValue).length;
      const candidateTokenCount = this.collectImproveMeaningfulTokens(candidateValue).length;
      if (baselineTokenCount >= 5 && candidateTokenCount >= 5 && overlap < 0.16) {
        pushIssue({
          code: 'section_anchor_mismatch',
          sectionKey: String(sectionKey),
          message: `Section ${String(sectionKey)} drifted too far away from the baseline anchor and likely widened product scope.`,
          severity: 'error',
          suggestedAction: 'rewrite',
        });
      }

      const baselineTokens = new Set(this.collectImproveMeaningfulTokens(baselineValue));
      const candidateTokens = new Set(this.collectImproveMeaningfulTokens(candidateValue));
      const unsupportedKeywords = infraKeywords.filter(keyword =>
        candidateTokens.has(keyword)
        && !baselineTokens.has(keyword)
        && !requestTokens.has(keyword)
      );
      if (unsupportedKeywords.length > 0) {
        pushIssue({
          code: 'baseline_scope_contradiction',
          sectionKey: String(sectionKey),
          message: `Section ${String(sectionKey)} introduced unsupported scope keywords not present in the baseline or user request: ${unsupportedKeywords.join(', ')}.`,
          severity: 'error',
          suggestedAction: 'rewrite',
        });
      }
    }

    const deterministicIssues = collectDeterministicSemanticIssues(params.candidateStructure, {
      language: params.language,
    });
    for (const issue of deterministicIssues) {
      if (issue.severity !== 'error') continue;
      semanticLintCodes.add(issue.code);
      if (issue.code.startsWith('schema_field_')) {
        pushIssue({
          code: issue.code,
          sectionKey: 'domainModel',
          message: issue.message,
          severity: 'error',
          suggestedAction: 'rewrite',
        });

        for (const featureSectionKey of featureSectionsFromDeterministicIssue(issue)) {
          pushIssue({
            code: issue.code,
            sectionKey: featureSectionKey,
            message: issue.message,
            severity: 'error',
            suggestedAction: 'enrich',
            targetFields: featureTargetFieldsFromEvidencePath(issue.evidencePath || ''),
          });
        }
        continue;
      }
      if (issue.code === 'rule_schema_property_coverage_missing') {
        pushIssue({
          code: issue.code,
          sectionKey: 'domainModel',
          message: issue.message,
          severity: 'warning',
          suggestedAction: 'rewrite',
        });
        pushIssue({
          code: issue.code,
          sectionKey: 'globalBusinessRules',
          message: issue.message,
          severity: 'warning',
          suggestedAction: 'rewrite',
        });
        continue;
      }
      if (issue.code === 'business_rule_constraint_conflict') {
        pushIssue({
          code: issue.code,
          sectionKey: 'globalBusinessRules',
          message: issue.message,
          severity: 'error',
          suggestedAction: 'rewrite',
        });
        continue;
      }
      if (issue.code === 'deployment_runtime_contradiction') {
        const evidencePath = String(issue.evidencePath || '').trim();
        pushIssue({
          code: issue.code,
          sectionKey: evidencePath.split('.')[0] || 'deployment',
          message: issue.message,
          severity: 'error',
          suggestedAction: 'rewrite',
        });
        continue;
      }
      if (issue.code === 'feature_core_semantic_gap') {
        const evidencePath = String(issue.evidencePath || '').trim();
        const sectionKey = evidencePath.startsWith('feature:')
          ? evidencePath.split('.')[0]
          : 'feature:F-01';
        pushIssue({
          code: issue.code,
          sectionKey,
          message: issue.message,
          severity: 'error',
          suggestedAction: 'enrich',
          targetFields: ['preconditions', 'postconditions', 'dataImpact'] as ContentIssue['targetFields'],
        });
        continue;
      }
      if (issue.code === 'vision_capability_coverage_missing' || issue.code === 'support_features_overweight') {
        const featureSections = featureSectionsFromDeterministicIssue(issue);
        for (const sectionKey of featureSections) {
          pushIssue({
            code: issue.code,
            sectionKey,
            message: issue.message,
            severity: 'error',
            suggestedAction: 'enrich',
            targetFields: ['purpose', 'trigger', 'mainFlow', 'preconditions', 'postconditions', 'dataImpact', 'acceptanceCriteria'] as ContentIssue['targetFields'],
          });
        }
        pushIssue({
          code: issue.code,
          sectionKey: 'systemVision',
          message: issue.message,
          severity: 'error',
          suggestedAction: 'rewrite',
        });
        continue;
      }
      if (issue.code === 'out_of_scope_reintroduced' || issue.code === 'out_of_scope_future_leakage') {
        const evidencePath = String(issue.evidencePath || '').trim();
        const sectionKey = evidencePath.startsWith('feature:')
          ? evidencePath.split('.')[0]
          : (evidencePath.split('.')[0] || 'outOfScope');
        pushIssue({
          code: issue.code,
          sectionKey,
          message: issue.message,
          severity: 'error',
          suggestedAction: sectionKey.startsWith('feature:') ? 'enrich' : 'rewrite',
          ...(sectionKey.startsWith('feature:')
            ? { targetFields: ['purpose', 'trigger', 'dataImpact', 'uiImpact'] as ContentIssue['targetFields'] }
            : {}),
        });
      }
    }

    const blockingIssues = issues.filter(issue => issue.code !== 'improve_new_feature_blocked');
    const primaryReason = blockingIssues.length > 0
      ? (() => {
          const first = blockingIssues[0];
          const sections = Array.from(new Set(blockingIssues.map(issue => issue.sectionKey)));
          const suffix = sections.length > 0 ? ` Affected sections: ${sections.join(', ')}.` : '';
          return `${first.message}${suffix}`;
        })()
      : (blockedAddedFeatures.length > 0
        ? `Improve mode blocked new feature additions: ${blockedAddedFeatures.join(', ')}.`
        : undefined);

    return {
      blockingIssues,
      blockedAddedFeatures,
      semanticLintCodes: Array.from(semanticLintCodes),
      primaryReason,
    };
  }

  private buildEarlyDriftQualityReport(structure: PRDStructure, issues: ImproveDriftFinding[]): PrdQualityReport {
    return {
      valid: false,
      truncatedLikely: false,
      missingSections: [],
      featureCount: structure.features.length,
      fallbackSections: [],
      issues: issues.map(issue => ({
        code: issue.code,
        message: issue.message,
        severity: 'error' as const,
      })),
    };
  }

  private applyImproveDriftDiagnostics(
    state: IterationLoopState,
    evaluation: ImproveDriftEvaluation,
    repairAttempted?: boolean,
    repairApplied?: boolean,
  ): void {
    state.diagnostics.earlyDriftDetected =
      !!state.diagnostics.earlyDriftDetected
      || evaluation.blockingIssues.length > 0
      || evaluation.blockedAddedFeatures.length > 0;
    state.diagnostics.earlyDriftCodes = Array.from(new Set([
      ...(state.diagnostics.earlyDriftCodes || []),
      ...evaluation.blockingIssues.map(issue => issue.code),
      ...(evaluation.blockedAddedFeatures.length > 0 ? ['improve_new_feature_blocked'] : []),
    ]));
    state.diagnostics.earlyDriftSections = Array.from(new Set([
      ...(state.diagnostics.earlyDriftSections || []),
      ...evaluation.blockingIssues.map(issue => issue.sectionKey),
    ]));
    state.diagnostics.blockedAddedFeatures = Array.from(new Set([
      ...(state.diagnostics.blockedAddedFeatures || []),
      ...evaluation.blockedAddedFeatures,
    ]));
    state.diagnostics.earlySemanticLintCodes = Array.from(new Set([
      ...(state.diagnostics.earlySemanticLintCodes || []),
      ...evaluation.semanticLintCodes,
    ]));
    if (repairAttempted !== undefined) {
      state.diagnostics.earlyRepairAttempted = repairAttempted;
    }
    if (repairApplied !== undefined) {
      state.diagnostics.earlyRepairApplied = repairApplied;
    }
    if (evaluation.primaryReason) {
      state.diagnostics.primaryEarlyDriftReason = evaluation.primaryReason;
    }
  }

  private async enforceImproveModeDriftGuardrails(params: {
    iterationNumber: number;
    preservedPRD: string;
    candidateStructure: PRDStructure | null;
    state: IterationLoopState;
    opts: IterationOpts;
  }): Promise<{ preservedPRD: string; candidateStructure: PRDStructure | null }> {
    const { iterationNumber, preservedPRD, candidateStructure, state, opts } = params;
    if (!opts.isImprovement || !candidateStructure || !state.freezeBaselineStructure) {
      return { preservedPRD, candidateStructure };
    }

    const initialEvaluation = this.collectImproveDriftEvaluation({
      baselineStructure: state.freezeBaselineStructure,
      candidateStructure,
      workflowInputText: opts.workflowInputText,
      language: opts.resolvedLanguage,
      blockedAddedFeatures: state.diagnostics.blockedAddedFeatures,
    });
    this.applyImproveDriftDiagnostics(state, initialEvaluation);

    if (initialEvaluation.blockingIssues.length === 0) {
      return { preservedPRD, candidateStructure };
    }

    this.emitIterativeProgress(opts, {
      type: 'early_drift_detected',
      iteration: iterationNumber,
      codes: initialEvaluation.blockingIssues.map(issue => issue.code),
      sections: initialEvaluation.blockingIssues.map(issue => issue.sectionKey),
      blockedAddedFeatures: initialEvaluation.blockedAddedFeatures,
    });
    dualAiWarn(`🚫 Iteration ${iterationNumber}: early improve-mode drift detected`);
    for (const issue of initialEvaluation.blockingIssues) {
      dualAiWarn(`   - [${issue.code}] ${issue.sectionKey}: ${issue.message}`);
    }

    let repairedContent = preservedPRD;
    let repairedStructure = candidateStructure;
    let finalEvaluation = initialEvaluation;

    if (!state.diagnostics.earlyRepairAttempted) {
      state.diagnostics.earlyRepairAttempted = true;
      this.emitIterativeProgress(opts, {
        type: 'early_drift_repair_start',
        iteration: iterationNumber,
        codes: initialEvaluation.blockingIssues.map(issue => issue.code),
        sections: initialEvaluation.blockingIssues.map(issue => issue.sectionKey),
      });

      const repairResult = await applySemanticPatchRefinement({
        content: preservedPRD,
        structure: candidateStructure,
        issues: initialEvaluation.blockingIssues,
        language: opts.resolvedLanguage,
        templateCategory: opts.templateCategory,
        originalRequest: opts.workflowInputText,
        reviewer: async (refinePrompt: string) => {
          const refineResult = await this.callIterativeModel(opts, {
            role: 'reviewer',
            systemPrompt: 'You are a PRD semantic repair specialist. Return JSON only.' + opts.langInstruction,
            userPrompt: refinePrompt,
            maxTokens: CONTENT_REVIEW_REFINE,
            responseFormat: { type: 'json_object' },
            temperature: 0.1,
            phase: 'early_drift_repair',
          });
          return {
            content: refineResult.content,
            model: refineResult.model,
            usage: refineResult.usage,
            finishReason: refineResult.finishReason,
          };
        },
      });

      for (const attempt of repairResult.reviewerAttempts || []) {
        if (attempt.model) {
          state.modelsUsed.add(attempt.model);
          state.diagnostics.reviewerModelIds = Array.from(new Set([
            ...(state.diagnostics.reviewerModelIds || []),
            attempt.model,
          ]));
        }
      }

      if (repairResult.refined) {
        repairedContent = repairResult.content;
        try {
          repairedStructure = parsePRDToStructure(repairedContent);
        } catch (repairParseError: any) {
          dualAiWarn(`⚠️ Early drift repair parse failed: ${repairParseError.message}`);
        }
      }

      finalEvaluation = repairedStructure
        ? this.collectImproveDriftEvaluation({
            baselineStructure: state.freezeBaselineStructure,
            candidateStructure: repairedStructure,
            workflowInputText: opts.workflowInputText,
            language: opts.resolvedLanguage,
            blockedAddedFeatures: state.diagnostics.blockedAddedFeatures,
          })
        : initialEvaluation;

      this.applyImproveDriftDiagnostics(
        state,
        finalEvaluation,
        true,
        repairResult.refined && finalEvaluation.blockingIssues.length === 0,
      );
      this.emitIterativeProgress(opts, {
        type: 'early_drift_repair_done',
        iteration: iterationNumber,
        applied: repairResult.refined && finalEvaluation.blockingIssues.length === 0,
        codes: finalEvaluation.blockingIssues.map(issue => issue.code),
        sections: finalEvaluation.blockingIssues.map(issue => issue.sectionKey),
      });

      if (repairResult.refined && finalEvaluation.blockingIssues.length === 0) {
        return {
          preservedPRD: repairedContent,
          candidateStructure: repairedStructure,
        };
      }
    }

    throw new PrdCompilerQualityError(
      `Improve-mode drift blocked iteration ${iterationNumber}: ${finalEvaluation.primaryReason || initialEvaluation.primaryReason || 'Baseline scope drift remained after targeted repair.'}`,
      this.buildEarlyDriftQualityReport(repairedStructure || candidateStructure, finalEvaluation.blockingIssues),
      [],
      { content: repairedContent, structure: repairedStructure || candidateStructure },
      {
        failureStage: 'early_drift',
        earlyDriftDetected: true,
        earlyDriftCodes: finalEvaluation.blockingIssues.map(issue => issue.code),
        earlyDriftSections: finalEvaluation.blockingIssues.map(issue => issue.sectionKey),
        blockedAddedFeatures: finalEvaluation.blockedAddedFeatures,
        earlySemanticLintCodes: finalEvaluation.semanticLintCodes,
        earlyRepairAttempted: !!state.diagnostics.earlyRepairAttempted,
        earlyRepairApplied: !!state.diagnostics.earlyRepairApplied,
        primaryEarlyDriftReason: finalEvaluation.primaryReason || initialEvaluation.primaryReason,
      }
    );
  }

  private extractCleanPRD(generatorOutput: string): string {
    let cleanContent = generatorOutput;
    
    // Step 1: If output is wrapped in "## Revised PRD" / "## Überarbeitetes PRD", extract inner content
    const revisedMatch = cleanContent.match(/##\s*(?:Revised PRD|Überarbeitetes PRD)\s*\n([\s\S]*?)(?=\n---\s*\n## (?:Questions|Fragen|Open|Offene)|$)/i);
    if (revisedMatch) {
      cleanContent = revisedMatch[1].trim();
    }
    
    // Step 2: Remove Q&A and meta sections (at end of document, after --- divider or without)
    const qaSections = [
      /\n---\s*\n+## (?:Questions for Improvement|Fragen zur Verbesserung)[\s\S]*/i,
      /\n---\s*\n+## (?:Feature Delta(?:\s*\(JSON\))?)[\s\S]*/i,
      /\n---\s*\n+## (?:Open Points|Offene Punkte)[\s\S]*/i,
      /\n---\s*\n+## Best Practice Empfehlungen[\s\S]*/i,
      /\n---\s*\n+## Final Review Feedback[\s\S]*/i,
      /\n## (?:Questions for Improvement|Fragen zur Verbesserung)[\s\S]*?(?=\n## (?!Questions|Fragen)|$)/i,
      /\n## (?:Feature Delta(?:\s*\(JSON\))?)[\s\S]*?(?=\n## (?!Feature Delta)|$)/i,
      /\n## (?:Open Points(?: & Gaps)?|Offene Punkte(?: (?:&|und) Lücken)?)[\s\S]*?(?=\n## (?!Open|Offene)|$)/i,
      /\n## (?:Open Questions|Offene Fragen)[\s\S]*?(?=\n## (?!Open|Offene)|$)/i,
    ];
    
    for (const pattern of qaSections) {
      cleanContent = cleanContent.replace(pattern, '');
    }
    
    // Step 3: Strip LLM preamble text before the actual PRD content
    // These are introductory sentences the LLM adds before the document
    const preamblePatterns = [
      /^(?:Hier ist (?:die|das|eine)[\s\S]*?(?:PRD|Dokument|Version)[\s\S]*?[:.]\s*\n+)/i,
      /^(?:Here is (?:the|a|an)[\s\S]*?(?:PRD|document|version)[\s\S]*?[:.]\s*\n+)/i,
      /^(?:I've (?:updated|revised|improved|created|generated)[\s\S]*?[:.]\s*\n+)/i,
      /^(?:Ich habe (?:das|die|den)[\s\S]*?(?:überarbeitet|erstellt|aktualisiert|verbessert)[\s\S]*?[:.]\s*\n+)/i,
      /^(?:Below is (?:the|a|an)[\s\S]*?[:.]\s*\n+)/i,
      /^(?:The following is[\s\S]*?[:.]\s*\n+)/i,
      /^(?:Im Folgenden[\s\S]*?[:.]\s*\n+)/i,
    ];
    
    for (const pattern of preamblePatterns) {
      cleanContent = cleanContent.replace(pattern, '');
    }
    
    // Step 4: Final safety net — strip any remaining non-heading text before the first markdown heading
    // This catches multi-line preambles that the specific patterns above might miss
    const firstHeadingIndex = cleanContent.search(/^#{1,3}\s+/m);
    if (firstHeadingIndex > 0) {
      const beforeHeading = cleanContent.substring(0, firstHeadingIndex).trim();
      // Only strip if the text before the heading doesn't contain markdown structure (just plain text preamble)
      if (!beforeHeading.includes('#') && beforeHeading.length < 500) {
        cleanContent = cleanContent.substring(firstHeadingIndex);
      }
    }
    
    // Step 5: Strip trailing --- divider if document ends with one
    cleanContent = cleanContent.replace(/\n---\s*$/, '');
    
    return cleanContent.trim();
  }

  private extractOpenPoints(generatorOutput: string): string[] {
    const openPoints: string[] = [];
    const openPointsMatch = generatorOutput.match(/## (?:Open Points(?: & Gaps)?|Offene Punkte(?: (?:&|und) Lücken)?)([\s\S]*?)(?=\n## |$)/i);
    
    if (openPointsMatch) {
      const lines = openPointsMatch[1].split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.match(/^[-*]\s+/) || trimmed.match(/^\d+\.\s+/)) {
          const point = trimmed.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim();
          if (point.length > 5) {
            openPoints.push(point);
          }
        }
      }
    }
    
    return openPoints;
  }

  private buildIterationLog(iterations: IterationData[], finalReview?: IterativeResponse['finalReview'], driftWarnings?: Map<number, string[]>, preservationActions?: Map<number, string[]>, integrityRestorations?: Map<number, IntegrityRestoration[]>, sectionRegens?: Map<number, { section: string; feedbackSnippet: string; mode?: 'json' | 'markdown' }>): string {
    const lines: string[] = [];
    lines.push('# Iteration Protocol');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Total Iterations: ${iterations.length}`);
    lines.push('');
    
    for (const iter of iterations) {
      lines.push(`---`);
      lines.push('');
      lines.push(`## Iteration ${iter.iterationNumber}`);
      lines.push('');
      
      const iterSectionRegen = sectionRegens?.get(iter.iterationNumber);
      if (iterSectionRegen) {
        if (iterSectionRegen.mode === 'json') {
          lines.push('### JSON Structured Section Update Applied');
        } else {
          lines.push('### Section-Level Regeneration Applied');
        }
        lines.push('');
        lines.push(`- Mode: ${iterSectionRegen.mode === 'json' ? 'JSON Structured Update' : 'Markdown Regeneration'}`);
        lines.push(`- Section: ${iterSectionRegen.section}`);
        lines.push(`- Feedback: ${iterSectionRegen.feedbackSnippet}...`);
        lines.push('');
      }

      // Extract and log open points from this iteration
      const openPoints = this.extractOpenPoints(iter.generatorOutput);
      if (openPoints.length > 0) {
        lines.push('### Open Points & Gaps Identified');
        lines.push('');
        for (let p = 0; p < openPoints.length; p++) {
          lines.push(`${p + 1}. ${openPoints[p]}`);
        }
        lines.push('');
      }
      
      if (iter.questions.length > 0) {
        lines.push('### Questions Identified');
        lines.push('');
        for (let q = 0; q < iter.questions.length; q++) {
          lines.push(`${q + 1}. ${iter.questions[q]}`);
        }
        lines.push('');
      }
      
      const iterWarnings = driftWarnings?.get(iter.iterationNumber);
      if (iterWarnings && iterWarnings.length > 0) {
        lines.push('### Structural Drift Warnings');
        lines.push('');
        for (const warning of iterWarnings) {
          lines.push(`- ${warning}`);
        }
        lines.push('');
      }

      const iterPreservations = preservationActions?.get(iter.iterationNumber);
      if (iterPreservations && iterPreservations.length > 0) {
        lines.push('### Feature Preservation Actions');
        lines.push('');
        for (const featureId of iterPreservations) {
          lines.push(`- Restored: ${featureId}`);
        }
        lines.push('');
      }

      const iterIntegrity = integrityRestorations?.get(iter.iterationNumber);
      if (iterIntegrity && iterIntegrity.length > 0) {
        lines.push('### Feature Integrity Restorations');
        lines.push('');
        for (const restoration of iterIntegrity) {
          lines.push(`- ${restoration.featureId}: ${restoration.reasons.join('; ')}`);
        }
        lines.push('');
      }

      lines.push('### Best Practice Recommendations');
      lines.push('');
      lines.push(iter.answererOutput);
      lines.push('');
    }
    
    if (finalReview) {
      lines.push('---');
      lines.push('');
      lines.push('## Final Review');
      lines.push('');
      lines.push(finalReview.content);
      lines.push('');
    }
    
    return lines.join('\n');
  }

  private ensureRequiredSections(
    structure: PRDStructure,
    context: { workflowInputText: string; iterationNumber: number; contentLanguage?: string | null }
  ): { structure: PRDStructure; addedSections: string[] } {
    const language = detectContentLanguage(context.contentLanguage, context.workflowInputText);
    return ensurePrdRequiredSections(structure, language, {
      contextHint: this.safeTruncateAtWord(context.workflowInputText, 260),
    });
  }

  // resolveScaffoldLanguage replaced by shared detectContentLanguage() from prdLanguageDetector.ts

  private pickFallbackPatchSection(structure: PRDStructure): keyof PRDStructure | null {
    const orderedCandidates: (keyof PRDStructure)[] = [
      'outOfScope',
      'timelineMilestones',
      'successCriteria',
      'globalBusinessRules',
      'errorHandling',
      'deployment',
      'definitionOfDone',
      'systemBoundaries',
      'nonFunctional',
      'domainModel',
      'systemVision',
    ];

    for (const key of orderedCandidates) {
      const value = structure[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return key;
      }
    }

    return null;
  }

  private async compileFeatureDelta(params: {
    currentStructure: PRDStructure;
    freezeBaseline: PRDStructure;
    visionContext: string;
    workflowInputText: string;
    structuredDelta?: StructuredFeatureDelta;
    enforceStructuredDeltaOnly?: boolean;
    allowNewFeatures?: boolean;
    contentLanguage?: string | null;
    client: OpenRouterClient;
  }): Promise<{
    structure: PRDStructure;
    freezeBaseline: PRDStructure;
    addedFeatureIds: string[];
    droppedDuplicates: string[];
    blockedAddedFeatures: string[];
  }> {
    const {
      currentStructure,
      freezeBaseline,
      visionContext,
      workflowInputText,
      structuredDelta,
      enforceStructuredDeltaOnly,
      allowNewFeatures = true,
      contentLanguage,
      client
    } = params;
    const resolvedLanguage = detectContentLanguage(
      contentLanguage,
      `${workflowInputText || ''}\n${visionContext || ''}`
    );
    const baselineIds = new Set(
      freezeBaseline.features
        .map(f => normalizeFeatureId(f.id) || String(f.id || '').trim().toUpperCase())
        .filter(Boolean)
    );
    const baselineFeatures = freezeBaseline.features
      .map(f => {
        const canonicalId = normalizeFeatureId(f.id) || String(f.id || '').trim().toUpperCase();
        if (!canonicalId) return null;
        return { ...f, id: canonicalId };
      })
      .filter((feature): feature is FeatureSpec => Boolean(feature));
    const currentAdditions = currentStructure.features.filter(f => {
      const canonicalId = normalizeFeatureId(f.id) || String(f.id || '').trim().toUpperCase();
      return canonicalId.length > 0 && !baselineIds.has(canonicalId);
    });
    const structuredAdditions = this.toFeatureCandidatesFromDelta(structuredDelta);

    const candidatePool = enforceStructuredDeltaOnly
      ? structuredAdditions
      : (structuredAdditions.length > 0 ? structuredAdditions : currentAdditions);

    if (candidatePool.length === 0) {
      return {
        structure: currentStructure,
        freezeBaseline,
        addedFeatureIds: [],
        droppedDuplicates: [],
        blockedAddedFeatures: [],
      };
    }

    if (!allowNewFeatures) {
      const blockedAddedFeatures = candidatePool.map(candidate => `${candidate.id}:${candidate.name}`);
      return {
        structure: {
          ...currentStructure,
          features: currentStructure.features
            .filter(f => {
              const canonicalId = normalizeFeatureId(f.id) || String(f.id || '').trim().toUpperCase();
              return canonicalId.length > 0 && baselineIds.has(canonicalId);
            })
            .map(f => ({
              ...f,
              id: normalizeFeatureId(f.id) || String(f.id || '').trim().toUpperCase(),
            })),
        },
        freezeBaseline,
        addedFeatureIds: [],
        droppedDuplicates: [],
        blockedAddedFeatures,
      };
    }

    const dedupeResult = this.filterDuplicateNewFeatures(candidatePool, baselineFeatures);
    const droppedDuplicates = dedupeResult.dropped.map(f => `${f.id}:${f.name}`);
    const acceptedCandidates = dedupeResult.accepted;

    const compiledNewFeatures: FeatureSpec[] = [];
    const usedIds = new Set(
      currentStructure.features
        .map(f => normalizeFeatureId(f.id) || String(f.id || '').trim().toUpperCase())
        .filter(Boolean)
    );
    for (const candidate of acceptedCandidates) {
      const resolvedId = this.nextAvailableFeatureId(candidate.id, usedIds);
      usedIds.add(resolvedId);

      let compiledRaw = candidate.rawContent;
      try {
        const expansion = await expandFeature(
          workflowInputText,
          visionContext,
          resolvedId,
          candidate.name,
          this.deriveShortDescription(candidate),
          client,
          resolvedLanguage
        );
        compiledRaw = expansion.content || candidate.rawContent;
      } catch (deltaCompileError: any) {
        dualAiWarn(`⚠️ Delta compile failed for ${candidate.id} (${candidate.name}): ${deltaCompileError.message}`);
        const isGerman = resolvedLanguage === 'de';
        compiledRaw = [
          `Feature ID: ${resolvedId}`,
          `Feature Name: ${candidate.name}`,
          ``,
          `1. Purpose`,
          isGerman
            ? `${candidate.name} liefert ein deterministisches, testbares Feature-Ergebnis.`
            : `${candidate.name} provides a deterministic, testable feature outcome.`,
          ``,
          `2. Actors`,
          isGerman ? `- Primaer: Endnutzer` : `- Primary: End user`,
          isGerman ? `- Sekundaer: Systemprozess` : `- Secondary: System process`,
          ``,
          `3. Trigger`,
          isGerman
            ? `Ausgeloest durch eine Benutzeraktion oder ein relevantes Systemereignis.`
            : `Triggered by user interaction or a system event relevant to this feature.`,
          ``,
          `4. Preconditions`,
          isGerman ? `- Erforderliche Eingaben sind vorhanden.` : `- Required input is available.`,
          isGerman ? `- Laufzeitabhaengigkeiten sind verfuegbar.` : `- Runtime dependencies are available.`,
          ``,
          `5. Main Flow`,
          isGerman
            ? `1. Eingabe und Kontext fuer ${candidate.name} validieren.`
            : `1. Validate input and context for ${candidate.name}.`,
          isGerman
            ? `2. Kernlogik deterministisch ausfuehren und Zustand konsistent aktualisieren.`
            : `2. Execute core feature logic and update state consistently.`,
          isGerman
            ? `3. Erfolgsergebnis zurueckgeben und UI-relevanten Zustand aktualisieren.`
            : `3. Return success result and update UI-facing state.`,
          ``,
          `6. Alternate Flows`,
          isGerman
            ? `- Validierungsfehler: kein Schreibzugriff, klare Fehlermeldung.`
            : `- Validation error: no write performed and error message returned.`,
          isGerman
            ? `- Laufzeitfehler: Anfrage bricht sicher ab, Ursache wird protokolliert.`
            : `- Runtime error: request fails safely with logged reason.`,
          ``,
          `7. Postconditions`,
          isGerman
            ? `Der Feature-Zustand ist nach Abschluss konsistent und beobachtbar.`
            : `Feature state is consistent and observable after completion.`,
          ``,
          `8. Data Impact`,
          isGerman
            ? `Nur erforderliche Entitaeten werden gelesen/aktualisiert; keine unzusammenhaengenden Daten werden geaendert.`
            : `Only required entities are read/updated; no unrelated data is changed.`,
          ``,
          `9. UI Impact`,
          isGerman
            ? `Die UI zeigt Erfolgs-/Fehlerstatus und aktualisierte Daten.`
            : `UI reflects success/error state and any changed data.`,
          ``,
          `10. Acceptance Criteria`,
          isGerman
            ? `- Das Feature laeuft Ende-zu-Ende mit deterministischem Verhalten.`
            : `- Feature executes end-to-end with deterministic behavior.`,
          isGerman
            ? `- Fehler- und Validierungspfade sind explizit und testbar.`
            : `- Error and validation paths are explicit and testable.`,
          isGerman
            ? `- Der Endzustand ist konsistent ueber UI- und Persistenzschichten.`
            : `- Final state is consistent across UI and persistence layers.`,
        ].join('\n');
      }

      compiledNewFeatures.push({
        id: resolvedId,
        name: candidate.name,
        rawContent: compiledRaw,
      });
    }

    const rebuiltFeatures = [
      ...currentStructure.features.filter(f => {
        const canonicalId = normalizeFeatureId(f.id) || String(f.id || '').trim().toUpperCase();
        return canonicalId.length > 0 && baselineIds.has(canonicalId);
      }).map(f => ({
        ...f,
        id: normalizeFeatureId(f.id) || String(f.id || '').trim().toUpperCase(),
      })),
      ...compiledNewFeatures
    ];

    const mergedBaseline = {
      ...freezeBaseline,
      features: [
        ...baselineFeatures,
        ...compiledNewFeatures
      ]
    };
    mergedBaseline.features.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

    return {
      structure: { ...currentStructure, features: rebuiltFeatures },
      freezeBaseline: mergedBaseline,
      addedFeatureIds: compiledNewFeatures.map(f => f.id),
      droppedDuplicates,
      blockedAddedFeatures: [],
    };
  }

  private toFeatureCandidatesFromDelta(delta?: StructuredFeatureDelta): FeatureSpec[] {
    if (!delta || !Array.isArray(delta.addedFeatures) || delta.addedFeatures.length === 0) {
      return [];
    }

    const features: FeatureSpec[] = [];
    for (const entry of delta.addedFeatures) {
      const name = String(entry?.name || '').trim();
      if (!name) continue;
      if (this.isSectionLikeFeatureName(name)) {
        continue;
      }
      const shortDescription = String(entry?.shortDescription || '').trim();
      const rawId = String(entry?.featureId || '').trim();
      const id = normalizeFeatureId(rawId);
      if (rawId.length > 0 && !id) {
        continue;
      }
      features.push({
        id: id || 'F-XX',
        name,
        rawContent: `${name}\n${shortDescription}`.trim()
      });
    }

    return features;
  }

  private filterDuplicateNewFeatures(
    candidates: FeatureSpec[],
    baseline: FeatureSpec[]
  ): { accepted: FeatureSpec[]; dropped: FeatureSpec[] } {
    const accepted: FeatureSpec[] = [];
    const dropped: FeatureSpec[] = [];

    for (const candidate of candidates) {
      const duplicateInBaseline = baseline.some(existing => this.isDuplicateFeature(existing, candidate));
      const duplicateInAccepted = accepted.some(existing => this.isDuplicateFeature(existing, candidate));
      if (duplicateInBaseline || duplicateInAccepted) {
        dropped.push(candidate);
        continue;
      }
      accepted.push(candidate);
    }

    return { accepted, dropped };
  }

  private isDuplicateFeature(a: FeatureSpec, b: FeatureSpec): boolean {
    const aId = normalizeFeatureId(a.id);
    const bId = normalizeFeatureId(b.id);
    if (aId && bId && aId === bId) return true;

    const aName = this.normalizeFeatureName(a.name);
    const bName = this.normalizeFeatureName(b.name);
    if (aName && bName && aName === bName) return true;
    const language: 'de' | 'en' = /[äöüß]|\b(?:und|mit|fuer|für|nutzer|aufgabe|funktion)\b/i.test(
      `${a.name} ${b.name} ${a.rawContent} ${b.rawContent}`
    )
      ? 'de'
      : 'en';

    return isHighConfidenceFeatureDuplicate(a, b, 'feature', language);
  }

  private normalizeFeatureName(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\b(feature|todo|item|app|webapp|system|module)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isSectionLikeFeatureName(value: string): boolean {
    const normalized = String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9äöüß\s&-]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) return true;

    const sectionLikePatterns = [
      /^system\s*vision$/,
      /^problem\s*statement$/,
      /^goals?(?:\s*&\s*success\s*metrics?)?$/,
      /^target\s*audience$/,
      /^user\s*stories$/,
      /^system\s*(?:boundaries|grenzen)$/,
      /^domain\s*model$/,
      /^dom[aä]nen\s*modell$/,
      /^global\s*business\s*rules$/,
      /^gesch[aä]fts\s*regeln$/,
      /^functional\s*feature\s*catalog(?:ue)?$/,
      /^feature\s*catalog(?:ue)?$/,
      /^non[\s-]*functional(?:\s*requirements)?$/,
      /^nicht[\s-]*funktionale?\s*anforderungen$/,
      /^error\s*handling(?:\s*&\s*recovery)?$/,
      /^fehler\s*behandlung(?:\s*&\s*wiederherstellung)?$/,
      /^deployment(?:\s*&\s*infrastructure)?$/,
      /^bereitstellung(?:\s*&\s*infrastruktur)?$/,
      /^definition\s*of\s*done$/,
      /^out\s*of\s*scope$/,
      /^au[ßs]erhalb\s*(?:des|vom)?\s*scope$/,
      /^timeline(?:\s*&\s*milestones?)?$/,
      /^zeitplan(?:\s*&\s*meilensteine?)?$/,
      /^success\s*criteria(?:\s*&\s*acceptance\s*testing)?$/,
      /^erfolgs\s*kriterien(?:\s*&\s*akzeptanz\s*tests?)?$/,
    ];

    return sectionLikePatterns.some(pattern => pattern.test(normalized));
  }

  private nextAvailableFeatureId(preferredId: string, usedIds: Set<string>): string {
    const preferredCanonical = normalizeFeatureId(preferredId);
    if (preferredCanonical && !usedIds.has(preferredCanonical)) {
      return preferredCanonical;
    }

    let maxNum = 0;
    for (const id of Array.from(usedIds)) {
      const canonical = normalizeFeatureId(id);
      if (!canonical) continue;
      const match = canonical.match(/^F-(\d{2,})$/i);
      if (match) {
        maxNum = Math.max(maxNum, Number(match[1]));
      }
    }

    let candidateNum = maxNum + 1;
    const maxAttempts = usedIds.size + 100;
    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      const candidate = `F-${String(candidateNum).padStart(2, '0')}`;
      if (!usedIds.has(candidate)) return candidate;
      candidateNum++;
    }
    throw new Error(`nextAvailableFeatureId: no free feature ID found after ${maxAttempts} attempts (usedIds.size=${usedIds.size})`);
  }

  private deriveShortDescription(feature: FeatureSpec): string {
    const oneLine = feature.rawContent
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
    return oneLine || feature.name;
  }

  private mergeWithFreezeBaseline(current: PRDStructure, freezeBaseline: PRDStructure): PRDStructure {
    const byId = new Map<string, FeatureSpec>();
    for (const feature of freezeBaseline.features) {
      const canonicalId = normalizeFeatureId(feature.id);
      if (!canonicalId) continue;
      byId.set(canonicalId, { ...feature, id: canonicalId });
    }
    for (const feature of current.features) {
      const canonicalId = normalizeFeatureId(feature.id);
      if (!canonicalId) continue;
      const existing = byId.get(canonicalId);
      if (!existing) {
        byId.set(canonicalId, { ...feature, id: canonicalId });
        continue;
      }
      // Keep the richer version while preserving frozen IDs.
      if ((feature.rawContent || '').length > (existing.rawContent || '').length) {
        byId.set(canonicalId, { ...feature, id: canonicalId });
      }
    }

    return {
      ...current,
      featureCatalogueIntro: current.featureCatalogueIntro || freezeBaseline.featureCatalogueIntro,
      features: Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })),
    };
  }

  private normalizeSectionAliases(structure: PRDStructure): PRDStructure {
    const normalized: PRDStructure = {
      ...structure,
      otherSections: { ...structure.otherSections },
      features: [...structure.features],
    };

    const aliasMatchers: Array<{ key: keyof PRDStructure; patterns: RegExp[] }> = [
      { key: 'systemVision', patterns: [/system\s*vision/i, /executive\s*summary/i, /systemkontext/i, /system\s*kontext/i, /vision/i] },
      { key: 'systemBoundaries', patterns: [/system\s*boundar/i, /operating\s*model/i, /systemgrenzen/i, /system\s*grenzen/i, /betriebsmodell/i] },
      { key: 'domainModel', patterns: [/domain\s*model/i, /data\s*model/i, /dom[aä]nenmodell/i] },
      { key: 'globalBusinessRules', patterns: [/global\s*business\s*rules/i, /business\s*rules/i, /gesch[aä]ftsregeln/i] },
      { key: 'nonFunctional', patterns: [/non[\s-]*functional/i, /quality\s*attributes/i, /nicht[\s-]*funktionale/i] },
      { key: 'errorHandling', patterns: [/error\s*handling/i, /recovery/i, /fehlerbehandlung/i, /fehlermanagement/i] },
      { key: 'deployment', patterns: [/deployment/i, /infrastructure/i, /bereitstellung/i, /infrastruktur/i] },
      { key: 'definitionOfDone', patterns: [/definition\s*of\s*done/i, /done\s*criteria/i, /abnahmekriterien/i, /akzeptanzkriterien/i] },
      { key: 'outOfScope', patterns: [/out\s*of\s*scope/i, /au[ßs]erhalb\s*des\s*scopes/i] },
      { key: 'timelineMilestones', patterns: [/timeline/i, /milestones?/i, /zeitplan/i, /meilensteine?/i] },
      { key: 'successCriteria', patterns: [/success\s*criteria/i, /acceptance\s*testing/i, /erfolgskriterien/i, /abnahmetests?/i] },
    ];

    const normalizeHeading = (heading: string): string =>
      heading
        .replace(/^\s*teil\s+[a-z0-9ivx]+\s*[—:-]\s*/i, '')
        .replace(/^\s*part\s+[a-z0-9ivx]+\s*[—:-]\s*/i, '')
        .replace(/^\d+[\.\)]\s*/, '')
        .replace(/\*+/g, '')
        .trim();

    for (const [heading, content] of Object.entries(structure.otherSections || {})) {
      if (!content || !content.trim()) continue;
      const cleanHeading = normalizeHeading(heading);
      for (const alias of aliasMatchers) {
        const currentVal = normalized[alias.key];
        const alreadySet = typeof currentVal === 'string' && currentVal.trim().length > 0;
        if (alreadySet) continue;
        if (alias.patterns.some(p => p.test(cleanHeading))) {
          (normalized as any)[alias.key] = content;
          delete normalized.otherSections[heading];
          break;
        }
      }
    }

    return normalized;
  }

  private enforceCanonicalFeatureStructure(structure: PRDStructure, contentLanguage?: string | null): PRDStructure {
    const lang = detectContentLanguage(contentLanguage, structure.systemVision || structure.systemBoundaries || '');
    const isGerman = lang === 'de';
    const deduped = new Map<string, FeatureSpec>();

    for (const rawFeature of structure.features) {
      const feature = { ...rawFeature };
      const id = normalizeFeatureId(feature.id);
      if (!id) continue;
      const rawName = String(feature.name || '').replace(/^#+\s*/, '').replace(/^feature\s*name\s*:\s*/i, '').trim();
      const name = rawName || id;

      const existing = deduped.get(id);
      if (!existing || (feature.rawContent || '').length > (existing.rawContent || '').length) {
        deduped.set(id, { ...feature, id, name });
      }
    }

    const canonicalFeatures: FeatureSpec[] = [];
    // Rotate through variant pools so each feature gets distinct default text
    const pick = <T>(variants: T[], idx: number): T => variants[idx % variants.length];
    let featureIndex = 0;
    for (const feature of Array.from(deduped.values()).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) {
      const normalizedFeature = { ...feature, id: feature.id.toUpperCase() };
      const n = normalizedFeature.name;
      const fi = featureIndex;

      // --- Preserve AI-generated content; do NOT inject generic boilerplate ---
      // String fields: keep existing value or leave empty (no generic template)
      normalizedFeature.purpose = normalizedFeature.purpose?.trim() || '';
      normalizedFeature.actors = normalizedFeature.actors?.trim() || '';
      normalizedFeature.trigger = normalizedFeature.trigger?.trim() || '';
      normalizedFeature.preconditions = normalizedFeature.preconditions?.trim() || '';
      normalizedFeature.postconditions = normalizedFeature.postconditions?.trim() || '';
      normalizedFeature.dataImpact = normalizedFeature.dataImpact?.trim() || '';
      normalizedFeature.uiImpact = normalizedFeature.uiImpact?.trim() || '';

      // --- mainFlow: preserve existing steps, do not pad with generic steps ---
      const mainFlow = Array.isArray(normalizedFeature.mainFlow) ? normalizedFeature.mainFlow.filter(Boolean) : [];
      normalizedFeature.mainFlow = mainFlow;

      // --- alternateFlows: preserve existing, do not inject generic fallback ---
      const altFlows = Array.isArray(normalizedFeature.alternateFlows) ? normalizedFeature.alternateFlows.filter(Boolean) : [];
      normalizedFeature.alternateFlows = altFlows;

      // --- acceptanceCriteria: preserve existing, do not pad with generic criteria ---
      const acceptance = Array.isArray(normalizedFeature.acceptanceCriteria) ? normalizedFeature.acceptanceCriteria.filter(Boolean) : [];
      normalizedFeature.acceptanceCriteria = acceptance;
      this.applyFeatureLengthGuardrails(normalizedFeature);

      normalizedFeature.rawContent = this.renderCanonicalFeatureRaw(normalizedFeature);
      canonicalFeatures.push(normalizedFeature);
      featureIndex++;
    }

    return {
      ...structure,
      features: canonicalFeatures,
    };
  }

  private renderCanonicalFeatureRaw(feature: FeatureSpec): string {
    const lines: string[] = [];
    lines.push(`### ${feature.id}: ${feature.name}`);
    lines.push('');
    lines.push(`**1. Purpose**`);
    lines.push(feature.purpose || '');
    lines.push('');
    lines.push(`**2. Actors**`);
    lines.push(feature.actors || '');
    lines.push('');
    lines.push(`**3. Trigger**`);
    lines.push(feature.trigger || '');
    lines.push('');
    lines.push(`**4. Preconditions**`);
    lines.push(feature.preconditions || '');
    lines.push('');
    lines.push(`**5. Main Flow**`);
    for (const step of feature.mainFlow || []) {
      lines.push(step);
    }
    lines.push('');
    lines.push(`**6. Alternate Flows**`);
    for (const flow of feature.alternateFlows || []) {
      lines.push(`- ${flow.replace(/^-+\s*/, '')}`);
    }
    lines.push('');
    lines.push(`**7. Postconditions**`);
    lines.push(feature.postconditions || '');
    lines.push('');
    lines.push(`**8. Data Impact**`);
    lines.push(feature.dataImpact || '');
    lines.push('');
    lines.push(`**9. UI Impact**`);
    lines.push(feature.uiImpact || '');
    lines.push('');
    lines.push(`**10. Acceptance Criteria**`);
    for (const ac of feature.acceptanceCriteria || []) {
      lines.push(`- ${ac.replace(/^-+\s*/, '')}`);
    }
    return lines.join('\n').trim();
  }

  private applyFeatureLengthGuardrails(feature: FeatureSpec): void {
    feature.purpose = this.clampText(feature.purpose, 700);
    feature.actors = this.clampText(feature.actors, 420);
    feature.trigger = this.clampText(feature.trigger, 360);
    feature.preconditions = this.clampText(feature.preconditions, 700);
    feature.postconditions = this.clampText(feature.postconditions, 700);
    feature.dataImpact = this.clampText(feature.dataImpact, 800);
    feature.uiImpact = this.clampText(feature.uiImpact, 800);

    const mainFlow = Array.isArray(feature.mainFlow) ? feature.mainFlow : [];
    feature.mainFlow = mainFlow
      .filter(Boolean)
      .slice(0, 8)
      .map(step => this.clampText(String(step), 240));

    const alternateFlows = Array.isArray(feature.alternateFlows) ? feature.alternateFlows : [];
    feature.alternateFlows = alternateFlows
      .filter(Boolean)
      .slice(0, 6)
      .map(flow => this.clampText(String(flow), 220));

    const acceptance = Array.isArray(feature.acceptanceCriteria) ? feature.acceptanceCriteria : [];
    feature.acceptanceCriteria = acceptance
      .filter(Boolean)
      .slice(0, 8)
      .map(ac => this.clampText(String(ac), 220));

    this.enforceFeatureContentBudget(feature, 5200);
  }

  private clampText(value: string | undefined, maxLen: number): string {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return this.safeTruncateAtWord(text, maxLen);
  }

  private safeTruncateAtWord(value: string, maxLen: number): string {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    if (!text || text.length <= maxLen) return text;
    const hardSlice = text.slice(0, Math.max(0, maxLen)).trim();
    const lastSpace = hardSlice.lastIndexOf(' ');
    if (lastSpace > Math.max(20, Math.floor(maxLen * 0.5))) {
      return hardSlice.slice(0, lastSpace).trim();
    }
    return hardSlice;
  }

  private enforceFeatureContentBudget(feature: FeatureSpec, maxChars: number): void {
    const estimate = () => {
      const parts = [
        feature.purpose,
        feature.actors,
        feature.trigger,
        feature.preconditions,
        feature.postconditions,
        feature.dataImpact,
        feature.uiImpact,
        ...(feature.mainFlow || []),
        ...(feature.alternateFlows || []),
        ...(feature.acceptanceCriteria || []),
      ];
      return parts.map(p => String(p || '').length).reduce((a, b) => a + b, 0);
    };

    if (estimate() <= maxChars) return;

    feature.mainFlow = (feature.mainFlow || []).slice(0, 6);
    feature.alternateFlows = (feature.alternateFlows || []).slice(0, 4);
    feature.acceptanceCriteria = (feature.acceptanceCriteria || []).slice(0, 6);
    feature.purpose = this.clampText(feature.purpose, 280);
    feature.preconditions = this.clampText(feature.preconditions, 300);
    feature.postconditions = this.clampText(feature.postconditions, 300);
    feature.dataImpact = this.clampText(feature.dataImpact, 360);
    feature.uiImpact = this.clampText(feature.uiImpact, 360);

    if (estimate() <= maxChars) return;

    feature.mainFlow = (feature.mainFlow || []).map(step => this.clampText(step, 130));
    feature.alternateFlows = (feature.alternateFlows || []).map(flow => this.clampText(flow, 120));
    feature.acceptanceCriteria = (feature.acceptanceCriteria || []).map(ac => this.clampText(ac, 120));
  }

  private buildCanonicalMergedPRD(
    currentPRD: string,
    iterations: IterativeResponse['iterations'],
    options: {
      mode: 'generate' | 'improve';
      existingContent?: string;
      language: 'de' | 'en';
      templateCategory?: string;
      contextHint?: string;
    }
  ): string {
    const latestMerged = iterations.length > 0 ? iterations[iterations.length - 1].mergedPRD : '';
    let canonical = (latestMerged && latestMerged.trim()) ? latestMerged : currentPRD;
    canonical = this.sanitizeFinalMarkdown(canonical);

    try {
      const compiled = compilePrdDocument(canonical, {
        mode: options.mode,
        existingContent: options.existingContent,
        language: options.language,
        strictCanonical: true,
        templateCategory: options.templateCategory,
        contextHint: options.contextHint,
      });
      canonical = compiled.content;
    } catch {
      // Keep raw content if parser fails; dedupe still applies below.
    }

    return this.sanitizeFinalMarkdown(canonical);
  }

  private sanitizeFinalMarkdown(markdown: string): string {
    const noTruncationMarkers = this.stripTruncationMarkers(markdown);
    const headingFixed = this.normalizeInlineHeadings(noTruncationMarkers);
    const numberingFixed = this.normalizeListNumberingArtifacts(headingFixed);
    return this.deduplicateMarkdownContent(numberingFixed);
  }

  private stripTruncationMarkers(markdown: string): string {
    return String(markdown || '').replace(/\s*\[truncated\]/gi, '');
  }

  private normalizeListNumberingArtifacts(markdown: string): string {
    return String(markdown || '').replace(/^(\s*)(\d+)\.\s+\d+\.\s+/gm, '$1$2. ');
  }

  private deduplicateMarkdownContent(markdown: string): string {
    const lines = markdown.split('\n');
    const seenH2 = new Set<string>();
    const out: string[] = [];
    let currentSection = '__root__';
    const seenListItemPerSection = new Map<string, Set<string>>();

    const getSeenListItems = (section: string): Set<string> => {
      const existing = seenListItemPerSection.get(section);
      if (existing) return existing;
      const created = new Set<string>();
      seenListItemPerSection.set(section, created);
      return created;
    };

    for (const line of lines) {
      const trimmed = line.trim();

      if (/^#{2,3}\s+/.test(trimmed)) {
        const headingKey = trimmed.toLowerCase().replace(/\s+/g, ' ');
        // Only deduplicate H2 headings; H3 feature headings (### F-01, ### F-02, ...)
        // are always unique and serve as section boundaries for list-item dedup.
        if (/^##\s+[^#]/.test(trimmed)) {
          if (seenH2.has(headingKey)) continue;
          seenH2.add(headingKey);
        }
        currentSection = headingKey;
        out.push(line);
        continue;
      }

      if (!trimmed) {
        if (out.length > 0 && out[out.length - 1].trim() === '') continue;
        out.push(line);
        continue;
      }

      if (/^(?:[-*]\s|\d+\.\s)/.test(trimmed)) {
        const listKey = trimmed.toLowerCase().replace(/\s+/g, ' ');
        const seen = getSeenListItems(currentSection);
        if (seen.has(listKey)) continue;
        seen.add(listKey);
      }

      out.push(line);
    }

    return `${out.join('\n').trim()}\n`;
  }

  private normalizeInlineHeadings(markdown: string): string {
    let normalized = markdown;
    // Only fix inline headings separated by spaces/tabs, never by newlines.
    const headingTestPattern = /([^\n])[ \t]+(##\s+(?:System Vision|System Boundaries|Domain Model|Global Business Rules|Functional Feature Catalogue|Non-Functional Requirements|Error Handling & Recovery|Deployment & Infrastructure|Definition of Done|Out of Scope|Timeline(?:\s*&\s*Milestones)?|Success Criteria(?:\s*&\s*Acceptance Testing)?)\b)/;
    const headingReplacePattern = /([^\n])[ \t]+(##\s+(?:System Vision|System Boundaries|Domain Model|Global Business Rules|Functional Feature Catalogue|Non-Functional Requirements|Error Handling & Recovery|Deployment & Infrastructure|Definition of Done|Out of Scope|Timeline(?:\s*&\s*Milestones)?|Success Criteria(?:\s*&\s*Acceptance Testing)?)\b)/g;
    let safetyCounter = 0;
    while (headingTestPattern.test(normalized)) {
      const next = normalized.replace(headingReplacePattern, '$1\n\n$2');
      // Stop if replacement converges to a fixed point.
      if (next === normalized) break;
      normalized = next;
      safetyCounter++;
      if (safetyCounter > 1000) {
        dualAiWarn('⚠️ normalizeInlineHeadings safety break triggered');
        break;
      }
    }
    return normalized;
  }

  private looksLikeTruncatedOutput(text: string): boolean {
    const trimmed = String(text || '').trim();
    if (trimmed.length < 80) return false;
    if (/\[TRUNCATED\]\s*$/i.test(trimmed)) return true;
    const lastChar = trimmed[trimmed.length - 1];
    if (/[.!?)]/.test(lastChar)) return false;
    if (/\n\s*[-*]\s*$/.test(trimmed)) return true;
    if (/\n\s*\d+\.\s*$/.test(trimmed)) return true;
    if (/[*_`#:\-,(]$/.test(trimmed)) return true;
    return false;
  }

  private validateFinalOutputConsistency(params: {
    finalPRD: string;
    iterations: IterativeResponse['iterations'];
    freezeBaselineFeatureCount: number;
    featuresFrozen: boolean;
  }): { errors: string[]; sanitizerApplied: boolean } {
    const { finalPRD, iterations, freezeBaselineFeatureCount, featuresFrozen } = params;
    const errors: string[] = [];
    const requiredHeadings: { label: string; pattern: RegExp }[] = [
      { label: 'System Vision', pattern: /^## (?:System Vision|Executive Summary|Vision)\s*$/m },
      { label: 'System Boundaries', pattern: /^## (?:System Boundaries|Boundaries|Scope|System Scope)\s*$/m },
      { label: 'Domain Model', pattern: /^## (?:Domain Model|Data Model|Domain)\s*$/m },
      { label: 'Global Business Rules', pattern: /^## (?:Global Business Rules|Business Rules)\s*$/m },
      { label: 'Functional Feature Catalogue', pattern: /^## (?:Functional Feature Catalogue|Feature Catalogue|Features|Functional Requirements|Feature Specifications|Core Features|Required Features)\s*$/m },
      { label: 'Non-Functional Requirements', pattern: /^## (?:Non-?Functional Requirements|NFR|Quality Attributes)\s*$/m },
      { label: 'Error Handling & Recovery', pattern: /^## (?:Error Handling(?: (?:&|and) Recovery)?)\s*$/m },
      { label: 'Deployment & Infrastructure', pattern: /^## (?:Deployment(?: (?:&|and) Infrastructure)?|Infrastructure)\s*$/m },
      { label: 'Definition of Done', pattern: /^## (?:Definition of Done|Done Criteria)\s*$/m },
      { label: 'Out of Scope', pattern: /^## (?:Out of Scope)\s*$/m },
      { label: 'Timeline & Milestones', pattern: /^## (?:Timeline(?: (?:&|and) Milestones)?)\s*$/m },
      { label: 'Success Criteria', pattern: /^## (?:Success Criteria(?: (?:&|and) Acceptance Testing)?)\s*$/m },
    ];

    for (const { label, pattern } of requiredHeadings) {
      const matches = finalPRD.match(new RegExp(pattern.source, 'gm')) || [];
      if (matches.length !== 1) {
        errors.push(`## ${label} expected exactly once, found ${matches.length}`);
      }
    }

    if (/[^\n]\s##\s(?:System Vision|Executive Summary|Vision|System Boundaries|Boundaries|Scope|System Scope|Domain Model|Data Model|Domain|Global Business Rules|Business Rules|Functional Feature Catalogue|Feature Catalogue|Features|Non-?Functional Requirements|NFR|Quality Attributes|Error Handling|Deployment|Infrastructure|Definition of Done|Done Criteria|Out of Scope|Timeline|Milestones|Success Criteria|Acceptance Testing)\b/.test(finalPRD)) {
      errors.push('Inline section heading token detected');
    }

    if (/\[truncated\]/i.test(finalPRD)) {
      errors.push('Truncation marker detected in final PRD content');
    }

    const badNumberingMatches = finalPRD.match(/^\s*\d+\.\s+\d+\.\s+/gm) || [];
    if (badNumberingMatches.length > 0) {
      errors.push(`Malformed list numbering detected (${badNumberingMatches.length} line(s), e.g. "1. 1.")`);
    }

    const templatePhrases = [
      /liefert den zentralen nutzerwert/i,
      /system verarbeitet den schritt deterministisch/i,
      /reproduzierbar testbar/i,
      /core user value as a clearly bounded feature/i,
      /processes the step deterministically/i,
      /reproducibly testable by end users/i,
    ];
    const templateHits = templatePhrases
      .map((pattern) => (finalPRD.match(new RegExp(pattern.source, 'gi')) || []).length)
      .reduce((sum, count) => sum + count, 0);
    if (templateHits >= 12) {
      errors.push(`High template repetition detected (${templateHits} generic phrase hits)`);
    }

    const repeatedLineCheck = this.detectExcessiveRepeatedLines(finalPRD);
    if (repeatedLineCheck.excessive) {
      errors.push(`Repeated line pattern detected (${repeatedLineCheck.count}x): "${repeatedLineCheck.sample}"`);
    }

    const truncatedIterations = iterations
      .filter(iter => iter.answererOutputTruncated)
      .map(iter => iter.iterationNumber);
    if (truncatedIterations.length > 0) {
      errors.push(`Truncated answerer output in iteration(s): ${truncatedIterations.join(', ')}`);
    }

    if (featuresFrozen && freezeBaselineFeatureCount > 0) {
      try {
        const parsed = parsePRDToStructure(finalPRD);
        if (parsed.features.length < freezeBaselineFeatureCount) {
          errors.push(`Final feature count below freeze baseline (${parsed.features.length} < ${freezeBaselineFeatureCount})`);
        }
      } catch (e: any) {
        errors.push(`Final PRD parse failed during consistency validation: ${e.message}`);
      }
    }

    return {
      errors,
      sanitizerApplied: this.normalizeInlineHeadings(finalPRD) !== finalPRD
    };
  }

  private detectExcessiveRepeatedLines(markdown: string): { excessive: boolean; sample: string; count: number } {
    const lines = String(markdown || '')
      .split('\n')
      .map(line => line.trim())
      .filter(line =>
        line.length >= 45 &&
        !line.startsWith('#') &&
        !line.startsWith('- ') &&
        !/^\d+\.\s/.test(line)
      );

    const counts = new Map<string, number>();
    for (const line of lines) {
      const normalized = line.toLowerCase().replace(/\s+/g, ' ');
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }

    let maxLine = '';
    let maxCount = 0;
    counts.forEach((count, line) => {
      if (count > maxCount) {
        maxCount = count;
        maxLine = line;
      }
    });

    return {
      excessive: maxCount >= 8,
      sample: maxLine.slice(0, 120),
      count: maxCount,
    };
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private enforceNfrCoverage(
    structure: PRDStructure,
    contentLanguage?: string | null
  ): { structure: PRDStructure; globalCategoryAdds: number; featureCriteriaAdds: number } {
    const lang = detectContentLanguage(contentLanguage, structure.nonFunctional || structure.systemVision || '');
    const isGerman = lang === 'de';
    const updated: PRDStructure = {
      ...structure,
      features: structure.features.map(f => ({ ...f })),
      otherSections: { ...structure.otherSections },
    };

    const categories = [
      {
        key: 'reliability',
        match: /(reliab|zuverlaess|zuverläss)/i,
        line: isGerman
          ? '- Reliability: Das System bleibt bei Fehlern stabil und stellt konsistente Zustände wieder her.'
          : '- Reliability: The system remains stable during faults and restores consistent state.'
      },
      {
        key: 'performance',
        match: /(perform|latency|throughput|response time|antwortzeit)/i,
        line: isGerman
          ? '- Performance: Kritische Nutzeraktionen liefern in akzeptabler Antwortzeit reproduzierbare Ergebnisse.'
          : '- Performance: Critical user actions return reproducible results within acceptable response time.'
      },
      {
        key: 'security',
        match: /(security|secure|auth|xss|csrf|injection|sicherheit|datenschutz)/i,
        line: isGerman
          ? '- Security: Eingaben werden validiert/sanitized und sensible Daten sind gegen Missbrauch abgesichert.'
          : '- Security: Inputs are validated/sanitized and sensitive data is protected against misuse.'
      },
      {
        key: 'accessibility',
        match: /(accessib|wcag|aria|barriere)/i,
        line: isGerman
          ? '- Accessibility: Kernabläufe sind tastaturbedienbar und erfüllen mindestens WCAG-2.1-AA-Anforderungen.'
          : '- Accessibility: Core flows are keyboard-operable and meet at least WCAG 2.1 AA requirements.'
      },
      {
        key: 'observability',
        match: /(observab|monitor|logging|metrics|telemetr|beobacht)/i,
        line: isGerman
          ? '- Observability: Fehler, Performance und Laufzeitereignisse sind über Logs/Metriken nachvollziehbar.'
          : '- Observability: Errors, performance, and runtime events are traceable via logs/metrics.'
      },
    ];

    let nonFunctionalText = String(updated.nonFunctional || '').trim();
    let globalCategoryAdds = 0;
    for (const cat of categories) {
      if (!cat.match.test(nonFunctionalText)) {
        nonFunctionalText = [nonFunctionalText, cat.line].filter(Boolean).join('\n');
        globalCategoryAdds++;
      }
    }
    updated.nonFunctional = nonFunctionalText.trim();

    // NFR criterion injection removed: the generic "meets defined performance..."
    // line was identical across all features and added no project-specific value.
    // Features that already have NFR-relevant acceptance criteria keep them.
    const featureCriteriaAdds = 0;

    return { structure: updated, globalCategoryAdds, featureCriteriaAdds };
  }

  private async generateStructuredDeltaSection(params: {
    currentPrd: string;
    generatorOutput: string;
    reviewerFeedback: string;
    client: OpenRouterClient;
    langInstruction: string;
    abortSignal?: AbortSignal;
    onModelAttempt?: (attempt: ModelCallAttemptUpdate) => void;
  }): Promise<string | null> {
    const { currentPrd, generatorOutput, reviewerFeedback, client, langInstruction } = params;
    const systemPrompt = `You are part of the Nexora Requirements Compiler.
Return ONLY valid JSON with this schema:
{
  "addedFeatures": [
    { "featureId": "F-XX", "name": "string", "shortDescription": "string" }
  ],
  "updatedFeatures": [
    { "featureId": "F-XX", "notes": "string" }
  ]
}

Rules:
- No markdown, no explanations, JSON only
- Use empty arrays if no changes
- Do not duplicate existing features in addedFeatures
- Add features that were discussed in the Q&A or reviewer feedback but are missing from the current PRD catalogue
- Each distinct capability mentioned in the feedback should be a separate feature
- Aim for completeness — if the reviewer or generator mentions a screen, endpoint, or interaction not yet in the catalogue, add it`;

    const userPrompt = `CURRENT PRD:
${currentPrd}

LATEST GENERATOR OUTPUT:
${generatorOutput}

LATEST REVIEWER FEEDBACK:
${reviewerFeedback}

Extract only the feature delta between CURRENT PRD and LATEST GENERATOR OUTPUT.
Return JSON only.`;

    try {
      const result = await client.callWithFallback(
        'reviewer',
        systemPrompt + langInstruction,
        userPrompt,
        ITERATIVE_STRUCTURED_DELTA,
        undefined,
        undefined,
        {
          abortSignal: params.abortSignal,
          phase: 'structured_delta',
          onAttemptUpdate: params.onModelAttempt,
        }
      );

      const parsed = this.parseLooseJsonObject(result.content);
      if (!parsed) return null;

      const addedRaw = Array.isArray(parsed.addedFeatures) ? parsed.addedFeatures : [];
      const updatedRaw = Array.isArray(parsed.updatedFeatures) ? parsed.updatedFeatures : [];
      const normalized = {
        addedFeatures: addedRaw
          .map((f: any) => ({
            featureId: normalizeFeatureId(String(f?.featureId || '').trim()) || 'F-XX',
            name: String(f?.name || '').trim(),
            shortDescription: String(f?.shortDescription || '').trim(),
          }))
          .filter((f: any) => f.name.length > 0),
        updatedFeatures: updatedRaw
          .map((f: any) => ({
            featureId: normalizeFeatureId(String(f?.featureId || '').trim()) || '',
            notes: typeof f?.notes === 'string' ? f.notes.trim() : '',
          }))
          .filter((f: any) => /^F-\d{2,}$/i.test(f.featureId)),
      };

      const json = JSON.stringify(normalized, null, 2);
      return `## Feature Delta (JSON)\n\`\`\`json\n${json}\n\`\`\``;
    } catch (error: any) {
      dualAiWarn(`⚠️ Delta-only extraction failed: ${error.message}`);
      return null;
    }
  }

  private parseLooseJsonObject(raw: string): any | null {
    const trimmed = raw.trim();
    const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = codeBlock ? codeBlock[1].trim() : trimmed;

    try {
      return JSON.parse(candidate);
    } catch {
    }

    const objectMatch = candidate.match(/\{[\s\S]*\}/);
    if (!objectMatch) return null;

    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }

  private buildEmptyFeatureDeltaSection(): string {
    return `---\n\n## Feature Delta (JSON)\n\`\`\`json\n{\n  "addedFeatures": [],\n  "updatedFeatures": []\n}\n\`\`\`\n`;
  }

  private extractStructuredFeatureDelta(generatorOutput: string): StructuredFeatureDelta {
    return this.extractStructuredFeatureDeltaWithStatus(generatorOutput).delta;
  }

  private extractStructuredFeatureDeltaWithStatus(generatorOutput: string): StructuredFeatureDeltaParseResult {
    const empty: StructuredFeatureDelta = { addedFeatures: [], updatedFeatures: [] };
    const sectionPattern = /##\s*Feature Delta(?:\s*\(JSON\))?\s*([\s\S]*?)(?=\n##\s|$)/i;
    const sectionMatch = generatorOutput.match(sectionPattern);
    if (!sectionMatch) {
      return { found: false, valid: false, delta: empty, error: 'Feature Delta section missing' };
    }

    const sectionBody = sectionMatch[1];
    const fencedJson = sectionBody.match(/```json\s*([\s\S]*?)```/i) || sectionBody.match(/```\s*([\s\S]*?)```/i);
    const rawJson = (fencedJson ? fencedJson[1] : sectionBody).trim();
    if (!rawJson) {
      return { found: true, valid: false, delta: empty, error: 'Feature Delta JSON content missing' };
    }

    try {
      const parsed = JSON.parse(rawJson);
      const added = Array.isArray(parsed?.addedFeatures) ? parsed.addedFeatures : [];
      const updated = Array.isArray(parsed?.updatedFeatures) ? parsed.updatedFeatures : [];
      const delta: StructuredFeatureDelta = {
        addedFeatures: added
          .map((f: any) => ({
            featureId: normalizeFeatureId(String(f?.featureId || '').trim()) || undefined,
            name: String(f?.name || '').trim(),
            shortDescription: typeof f?.shortDescription === 'string' ? f.shortDescription : undefined,
          }))
          .filter((f: any) => f.name.length > 0),
        updatedFeatures: updated
          .map((f: any) => ({
            featureId: normalizeFeatureId(String(f?.featureId || '').trim()) || '',
            notes: typeof f?.notes === 'string' ? f.notes : undefined,
          }))
          .filter((f: any) => /^F-\d{2,}$/i.test(f.featureId)),
      };
      return { found: true, valid: true, delta };
    } catch (error: any) {
      dualAiWarn(`⚠️ Structured feature delta parse failed: ${error.message}`);
      return { found: true, valid: false, delta: empty, error: error.message };
    }
  }

  private buildFreezeBaselineFromExpansion(
    expansionResult: any,
    anchor?: PRDStructure | null
  ): PRDStructure | null {
    const expanded = expansionResult?.expandedFeatures;
    if (!Array.isArray(expanded) || expanded.length === 0) {
      return null;
    }

    const compiledFeatures = expanded
      .filter((f: any) => f && (f.compiled === true || f.valid === true))
      .map((f: any): FeatureSpec | null => {
        const canonicalId = normalizeFeatureId(String(f.featureId || '').trim());
        if (!canonicalId) return null;
        return {
          id: canonicalId,
          name: String(f.featureName || f.featureId || '').trim(),
          rawContent: String(f.content || '').trim(),
        };
      })
      .filter((f): f is FeatureSpec => Boolean(f))
      .filter((f: FeatureSpec) => f.id.length > 0 && f.rawContent.length > 0);

    const anchorFeatures = Array.isArray(anchor?.features)
      ? anchor!.features
        .map((f: FeatureSpec): FeatureSpec | null => {
          const canonicalId = normalizeFeatureId(String(f.id || '').trim());
          if (!canonicalId) return null;
          return {
            id: canonicalId,
            name: String(f.name || f.id || '').trim(),
            rawContent: String(f.rawContent || '').trim(),
          };
        })
        .filter((f): f is FeatureSpec => Boolean(f))
        .map((f: FeatureSpec) => ({
          id: f.id,
          name: String(f.name || f.id || '').trim(),
          rawContent: String(f.rawContent || '').trim(),
        }))
        .filter((f: FeatureSpec) => f.id.length > 0 && f.rawContent.length > 0)
      : [];

    if (compiledFeatures.length === 0 && anchorFeatures.length === 0) {
      return null;
    }

    const mergedById = new Map<string, FeatureSpec>();
    for (const f of anchorFeatures) {
      mergedById.set(f.id, f);
    }
    for (const f of compiledFeatures) {
      // Prefer compiled expansion output for overlapping IDs.
      mergedById.set(f.id, f);
    }

    const mergedFeatures = Array.from(mergedById.values());
    mergedFeatures.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

    return {
      systemVision: anchor?.systemVision,
      systemBoundaries: anchor?.systemBoundaries,
      domainModel: anchor?.domainModel,
      globalBusinessRules: anchor?.globalBusinessRules,
      featureCatalogueIntro: anchor?.featureCatalogueIntro,
      features: mergedFeatures,
      nonFunctional: anchor?.nonFunctional,
      errorHandling: anchor?.errorHandling,
      deployment: anchor?.deployment,
      definitionOfDone: anchor?.definitionOfDone,
      outOfScope: anchor?.outOfScope,
      timelineMilestones: anchor?.timelineMilestones,
      successCriteria: anchor?.successCriteria,
      otherSections: anchor?.otherSections ? { ...anchor.otherSections } : {},
    };
  }

  // extractVisionFromContent replaced by shared extractVisionFromContent() from prdFeatureExpansion.ts
  // createClientWithUserPreferences replaced by shared createClientWithUserPreferences() from openrouter.ts

  private extractQuestions(reviewText: string): string[] {
    const questions: string[] = [];
    
    // Extract lines that are questions (contain ?)
    const lines = reviewText.split('\n');
    for (const line of lines) {
      if (line.trim().includes('?')) {
        // Remove markdown list markers
        const cleaned = line.trim().replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '');
        if (cleaned.length > 10) {  // Avoid very short questions
          questions.push(cleaned);
        }
      }
    }

    return questions;
  }
}

// Singleton instance
let dualAiService: DualAiService | null = null;

export function getDualAiService(): DualAiService {
  if (!dualAiService) {
    dualAiService = new DualAiService();
  }
  return dualAiService;
}

