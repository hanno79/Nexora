/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Guided-AI-Service fuer nutzergefuehrte PRD-Erstellung und Finalisierung
*/

// ÄNDERUNG 08.03.2026: Compiler-Gates-, Prompt-, Fragen-, Session- und Preference-Helfer in kleine Guided-Module ausgelagert.
import { createClientWithUserPreferences } from './openrouter';
import {
  FEATURE_ANALYSIS_PROMPT,
  USER_QUESTION_PROMPT,
  FEATURE_REFINEMENT_PROMPT,
  GENERATE_FOLLOWUP_QUESTIONS_PROMPT,
  FINAL_PRD_GENERATION_PROMPT,
  FINAL_PRD_REFINEMENT_PROMPT,
  type GuidedQuestion,
  type GuidedStartResponse,
  type GuidedAnswerInput,
  type GuidedAnswerResponse,
  type GuidedFinalizeResponse,
} from './guidedAiPrompts';
import { getLanguageInstruction } from './dualAiPrompts';
import { DbGuidedSessionStore, type GuidedSessionStorePort } from './guidedSessionStore';
import { logger } from './logger';
import { resolvePrdWorkflowMode } from './prdWorkflowMode';
import { detectContentLanguage } from './prdLanguageDetector';
import {
  FEATURE_ANALYSIS,
  GUIDED_QUESTIONS,
  GUIDED_REFINEMENT,
  GUIDED_FOLLOWUP,
} from './tokenBudgets';
import {
  buildGuidedAnalysisInput,
  buildGuidedQuestionContext,
  buildGuidedRefinementInput,
  buildGuidedFinalizeUserPrompt,
  buildGuidedDirectFinalizeAnalysisInput,
  buildGuidedDirectFinalizeUserPrompt,
} from './guidedPromptBuilders';
import { parseQuestionsResponse, formatAnswerText } from './guidedQuestionUtils';
import { generateWithCompilerGates } from './guidedCompilerGates';
import {
  consumeGuidedSessionContextOrThrow,
  generateGuidedSessionId,
  getGuidedSessionContextOrThrow,
  getGuidedSessionState,
  getGuidedUserPreferences,
  requireAuthenticatedUserId,
  type ConversationContext,
} from './guidedAiServiceSupport';

export class GuidedAiService {
  private conversationContexts: GuidedSessionStorePort<ConversationContext>;

  constructor(store?: GuidedSessionStorePort<ConversationContext>) {
    this.conversationContexts = store ?? new DbGuidedSessionStore();
  }

  async getSessionState(sessionId: string, userId: string): Promise<ConversationContext | null> {
    return getGuidedSessionState(this.conversationContexts, sessionId, userId);
  }

  async cleanupExpiredSessions(): Promise<number> {
    return this.conversationContexts.cleanupExpired();
  }

  async startGuidedWorkflow(
    projectIdea: string,
    userId: string,
    options?: {
      aiPreferenceUserId?: string;
      existingContent?: string;
      mode?: 'improve' | 'generate';
      templateCategory?: string;
    }
  ): Promise<GuidedStartResponse & { sessionId: string }> {
    const authenticatedUserId = requireAuthenticatedUserId(userId);
    const { client, contentLanguage } = await createClientWithUserPreferences(options?.aiPreferenceUserId ?? authenticatedUserId);
    const normalizedExistingContent = typeof options?.existingContent === 'string'
      ? options.existingContent.trim()
      : '';
    const resolvedLanguage = detectContentLanguage(
      contentLanguage,
      `${projectIdea || ''}\n${normalizedExistingContent}`
    );
    const langInstruction = getLanguageInstruction(resolvedLanguage);
    const modeResolution = resolvePrdWorkflowMode({
      requestedMode: options?.mode === 'improve' ? 'improve' : 'generate',
      existingContent: normalizedExistingContent,
    });
    const workflowMode: 'generate' | 'improve' = modeResolution.mode;
    
    logger.debug('Guided workflow started', {
      projectIdeaLength: projectIdea.length,
      workflowMode,
      hasExistingContent: normalizedExistingContent.length > 0,
      baselineFeatureCount: modeResolution.assessment.featureCount,
      downgradedFromImprove: modeResolution.downgradedFromImprove,
    });

    // Step 1: Analyze project idea or improvement request and create initial feature overview
    logger.debug('Guided workflow analyzing input');
    const analysisInput = buildGuidedAnalysisInput({
      workflowMode,
      projectIdea,
      existingContent: normalizedExistingContent,
      templateCategory: options?.templateCategory,
      language: resolvedLanguage,
    });
    
    const analysisResult = await client.callWithFallback(
      'generator',
      FEATURE_ANALYSIS_PROMPT + langInstruction,
      analysisInput,
      FEATURE_ANALYSIS
    );

    const featureOverview = analysisResult.content;
    logger.debug('Guided workflow feature analysis complete', {
      completionTokens: analysisResult.usage.completion_tokens,
    });

    // Step 2: Generate initial questions for the user
    logger.debug('Guided workflow generating clarifying questions');
    const questionContext = buildGuidedQuestionContext({
      workflowMode,
      featureOverview,
      projectIdea,
      existingContent: normalizedExistingContent,
      templateCategory: options?.templateCategory,
      language: resolvedLanguage,
    });
    
    const questionsResult = await client.callWithFallback(
      'reviewer',
      USER_QUESTION_PROMPT + langInstruction,
      questionContext,
      GUIDED_QUESTIONS
    );

    logger.debug('Guided workflow questions generated', {
      completionTokens: questionsResult.usage.completion_tokens,
    });

    // Parse the JSON response
    const parsedQuestions = parseQuestionsResponse(questionsResult.content);

    // Create session ID and store context
    const sessionId = generateGuidedSessionId();
    await this.conversationContexts.create(sessionId, authenticatedUserId, {
      projectIdea,
      featureOverview,
      answers: [],
      roundNumber: 1,
      workflowMode,
      existingContent: normalizedExistingContent || undefined,
      templateCategory: options?.templateCategory,
      // ÄNDERUNG 02.03.2025: Initiale Fragen in Session speichern
      lastQuestions: parsedQuestions.questions,
    });

    return {
      sessionId,
      preliminaryPlan: parsedQuestions.preliminaryPlan || featureOverview.substring(0, 500),
      featureOverview,
      questions: parsedQuestions.questions,
    };
  }

  async processAnswers(
    sessionId: string,
    answers: GuidedAnswerInput[],
    questions: GuidedQuestion[],
    userId: string,
    aiPreferenceUserId?: string,
  ): Promise<GuidedAnswerResponse> {
    const authenticatedUserId = requireAuthenticatedUserId(userId);
    const context = await getGuidedSessionContextOrThrow(this.conversationContexts, sessionId, authenticatedUserId);

    const { client, contentLanguage } = await createClientWithUserPreferences(aiPreferenceUserId ?? authenticatedUserId);
    const resolvedLanguage = detectContentLanguage(
      contentLanguage,
      `${context.projectIdea || ''}\n${context.featureOverview || ''}`
    );
    const langInstruction = getLanguageInstruction(resolvedLanguage);

    logger.debug('Guided workflow processing answers', { answerCount: answers.length });

    // SECURITY: Client-provided questions are untrusted.
    // We store trusted questions from AI responses in the session context.
    // If none exist, we use the client-provided ones as fallback (first round only).
    // ÄNDERUNG 02.03.2025: Sicherheitsfix - Fragen aus Session laden wenn verfügbar
    const trustedQuestions = context.lastQuestions || questions;

    // Validate that answer questionIds match the trusted questions
    const validQuestionIds = new Set(trustedQuestions.map(q => q.id));
    const invalidAnswers = answers.filter(a => !validQuestionIds.has(a.questionId));
    if (invalidAnswers.length > 0) {
      logger.warn('Invalid answers received - question IDs not in trusted set', {
        invalidQuestionIds: invalidAnswers.map(a => a.questionId),
      });
      throw new Error('Invalid question references in answers');
    }

    // Create a map of questions for lookup
    const questionMap = new Map(trustedQuestions.map(q => [q.id, q]));

    // Format answers for the AI with proper labels, not just IDs
    const formattedAnswers = answers.map(a => {
      const question = questionMap.get(a.questionId);
      const questionText = question?.question || a.questionId;
      const answerText = formatAnswerText(a, question);
      return `Q: ${questionText}\nA: ${answerText}`;
    }).join('\n\n');

    // Store answers in context with full question text
    answers.forEach(a => {
      const question = questionMap.get(a.questionId);
      context.answers.push({
        questionId: a.questionId,
        question: question?.question || a.questionId,
        answer: formatAnswerText(a, question),
      });
    });

    // Refine the plan based on answers
    logger.debug('Guided workflow refining product vision');
    const refinementInput = buildGuidedRefinementInput({
      workflowMode: context.workflowMode,
      existingContent: context.existingContent,
      projectIdea: context.projectIdea,
      featureOverview: context.featureOverview,
      formattedAnswers,
      templateCategory: context.templateCategory,
      language: resolvedLanguage,
    });
    
    const refinementResult = await client.callWithFallback(
      'generator',
      FEATURE_REFINEMENT_PROMPT + langInstruction,
      refinementInput,
      GUIDED_REFINEMENT
    );

    context.featureOverview = refinementResult.content;
    logger.debug('Guided workflow refinement complete', {
      completionTokens: refinementResult.usage.completion_tokens,
    });

    // Decide if we need more questions (use user's configured max rounds)
    const userPrefs = await getGuidedUserPreferences(authenticatedUserId);
    const maxRounds = userPrefs?.guidedQuestionRounds || 3;
    context.roundNumber++;

    // Persist mutated context back to store (answers, featureOverview, roundNumber)
    await this.conversationContexts.update(sessionId, authenticatedUserId, context);

    if (context.roundNumber <= maxRounds) {
      // Generate follow-up questions
      logger.debug('Guided workflow generating follow-up questions');
      
      const followUpResult = await client.callWithFallback(
        'reviewer',
        GENERATE_FOLLOWUP_QUESTIONS_PROMPT + langInstruction,
        `Current refined plan:\n${refinementResult.content}\n\nPrevious answers:\n${formattedAnswers}\n\nGenerate 2-3 follow-up questions to further refine the product.`,
        GUIDED_FOLLOWUP
      );

      const parsedFollowUp = parseQuestionsResponse(followUpResult.content);
      logger.debug('Guided workflow follow-up questions generated', {
        completionTokens: followUpResult.usage.completion_tokens,
      });

      // ÄNDERUNG 02.03.2025: Fragen in Session speichern für Security-Validierung
      if (parsedFollowUp.questions && parsedFollowUp.questions.length > 0) {
        context.lastQuestions = parsedFollowUp.questions;
        await this.conversationContexts.update(sessionId, authenticatedUserId, context);
      }

      // If no valid questions, mark as complete
      if (!parsedFollowUp.questions || parsedFollowUp.questions.length === 0) {
        return {
          refinedPlan: refinementResult.content,
          isComplete: true,
          roundNumber: context.roundNumber,
        };
      }

      return {
        refinedPlan: refinementResult.content,
        followUpQuestions: parsedFollowUp.questions,
        isComplete: false,
        roundNumber: context.roundNumber,
      };
    }

    // Max rounds reached, ready to finalize
    return {
      refinedPlan: refinementResult.content,
      isComplete: true,
      roundNumber: context.roundNumber,
    };
  }

  async finalizePRD(
    sessionId: string,
    userId: string,
    options?: {
      aiPreferenceUserId?: string;
      templateCategory?: string;
      signal?: AbortSignal;
    }
  ): Promise<GuidedFinalizeResponse> {
    const finalizeStartedAt = Date.now();
    const authenticatedUserId = requireAuthenticatedUserId(userId);
    const context = await consumeGuidedSessionContextOrThrow(this.conversationContexts, sessionId, authenticatedUserId);

    const { client, contentLanguage } = await createClientWithUserPreferences(options?.aiPreferenceUserId ?? authenticatedUserId);
    const resolvedLanguage = detectContentLanguage(
      contentLanguage,
      `${context.projectIdea || ''}\n${context.featureOverview || ''}\n${context.existingContent || ''}`
    );
    const langInstruction = getLanguageInstruction(resolvedLanguage);

    logger.debug('Guided workflow generating final PRD');

    // Compile all context for final PRD generation
    const allAnswers = context.answers.map(a =>
      `- ${a.questionId}: ${a.answer}`
    ).join('\n');

    try {
      const isImproveWorkflow = context.workflowMode === 'improve' && !!context.existingContent?.trim();
      const effectiveTemplateCategory = options?.templateCategory || context.templateCategory;
      const systemPrompt = isImproveWorkflow
        ? FINAL_PRD_REFINEMENT_PROMPT + langInstruction
        : FINAL_PRD_GENERATION_PROMPT + langInstruction;
      const userPrompt = buildGuidedFinalizeUserPrompt({
        isImproveWorkflow,
        existingContent: context.existingContent,
        projectIdea: context.projectIdea,
        featureOverview: context.featureOverview,
        allAnswers,
        templateCategory: effectiveTemplateCategory,
        language: resolvedLanguage,
      });

      const compiled = await generateWithCompilerGates({
        client,
        systemPrompt,
        userPrompt,
        mode: isImproveWorkflow ? 'improve' : 'generate',
        existingContent: isImproveWorkflow ? context.existingContent : undefined,
        contentLanguage: resolvedLanguage,
        templateCategory: effectiveTemplateCategory,
        abortSignal: options?.signal,
      });

      logger.debug('Guided workflow final PRD compiled', {
        totalTokens: compiled.totalTokens,
      });

      return {
        prdContent: compiled.content,
        tokensUsed: compiled.totalTokens,
        modelsUsed: compiled.modelsUsed,
        workflowMode: isImproveWorkflow ? 'improve' : 'generate',
        existingContent: isImproveWorkflow ? context.existingContent : undefined,
        diagnostics: compiled.diagnostics as any,
        compilerArtifact: compiled.compilerArtifact,
        generationStage: compiled.generationStage,
        timings: {
          ...(compiled.timings || {}),
          totalDurationMs: Date.now() - finalizeStartedAt,
        },
      };
    } catch (error) {
      // Restore session context on failure so users can retry finalize.
      await this.conversationContexts.create(sessionId, authenticatedUserId, context);
      throw error;
    }
  }

  async skipToFinalize(
    projectIdea: string,
    userId?: string,
    options?: {
      aiPreferenceUserId?: string;
      existingContent?: string;
      mode?: 'improve' | 'generate';
      templateCategory?: string;
    }
  ): Promise<GuidedFinalizeResponse> {
    const startedAt = Date.now();
    const authenticatedUserId = requireAuthenticatedUserId(userId);
    const { client, contentLanguage } = await createClientWithUserPreferences(
      options?.aiPreferenceUserId ?? authenticatedUserId
    );
    const normalizedExistingContent = typeof options?.existingContent === 'string'
      ? options.existingContent.trim()
      : '';
    const resolvedLanguage = detectContentLanguage(
      contentLanguage,
      `${projectIdea || ''}\n${normalizedExistingContent}`
    );
    const langInstruction = getLanguageInstruction(resolvedLanguage);
    const modeResolution = resolvePrdWorkflowMode({
      requestedMode: options?.mode === 'improve' ? 'improve' : 'generate',
      existingContent: normalizedExistingContent,
    });
    const isImproveWorkflow = modeResolution.mode === 'improve';
    logger.debug('Guided workflow skipped directly to finalize');

    // First do a quick feature analysis
    const analysisInput = buildGuidedDirectFinalizeAnalysisInput({
      isImproveWorkflow,
      projectIdea,
      existingContent: normalizedExistingContent,
      templateCategory: options?.templateCategory,
      language: resolvedLanguage,
    });
    const analysisStartedAt = Date.now();
    const analysisResult = await client.callWithFallback(
      'generator',
      FEATURE_ANALYSIS_PROMPT + langInstruction,
      analysisInput,
      FEATURE_ANALYSIS
    );
    const analysisDurationMs = Date.now() - analysisStartedAt;

    // Then generate the full PRD
    const finalSystemPrompt = isImproveWorkflow
      ? FINAL_PRD_REFINEMENT_PROMPT + langInstruction
      : FINAL_PRD_GENERATION_PROMPT + langInstruction;
    const finalUserPrompt = buildGuidedDirectFinalizeUserPrompt({
      isImproveWorkflow,
      projectIdea,
      analysisContent: analysisResult.content,
      existingContent: normalizedExistingContent,
      templateCategory: options?.templateCategory,
      language: resolvedLanguage,
    });
    const generationStartedAt = Date.now();
    const compiled = await generateWithCompilerGates({
      client,
      systemPrompt: finalSystemPrompt,
      userPrompt: finalUserPrompt,
      mode: isImproveWorkflow ? 'improve' : 'generate',
      existingContent: isImproveWorkflow ? normalizedExistingContent : undefined,
      contentLanguage: resolvedLanguage,
      templateCategory: options?.templateCategory,
    });
    const finalizeGenerationDurationMs = Date.now() - generationStartedAt;

    logger.debug('Guided direct finalize complete', {
      totalTokens: analysisResult.usage.total_tokens + compiled.totalTokens,
    });

    return {
      prdContent: compiled.content,
      tokensUsed: analysisResult.usage.total_tokens + compiled.totalTokens,
      modelsUsed: [analysisResult.model, ...compiled.modelsUsed],
      workflowMode: isImproveWorkflow ? 'improve' : 'generate',
      existingContent: isImproveWorkflow ? normalizedExistingContent : undefined,
      diagnostics: compiled.diagnostics as any,
      compilerArtifact: compiled.compilerArtifact,
      analysisStage: {
        content: analysisResult.content,
        model: analysisResult.model,
        usage: analysisResult.usage,
        finishReason: analysisResult.finishReason,
        tier: analysisResult.tier,
      },
      generationStage: compiled.generationStage,
      timings: {
        analysisDurationMs,
        finalizeGenerationDurationMs,
        ...(compiled.timings || {}),
        totalDurationMs: Date.now() - startedAt,
      },
    };
  }

}

// Singleton instance
let guidedAiService: GuidedAiService | null = null;

export function getGuidedAiService(): GuidedAiService {
  if (!guidedAiService) {
    guidedAiService = new GuidedAiService();
  }
  return guidedAiService;
}
