// Guided AI Service - User-involved PRD Generation Workflow
import { getOpenRouterClient, createClientWithUserPreferences } from './openrouter';
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
import { db } from './db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { DbGuidedSessionStore, type GuidedSessionStorePort } from './guidedSessionStore';
import { logger } from './logger';
import { finalizeWithCompilerGates, PrdCompilerQualityError } from './prdCompilerFinalizer';
import { pickNextFallbackModel, pickBestDegradedResult } from './prdQualityFallback';
import { resolvePrdWorkflowMode } from './prdWorkflowMode';
import { buildTemplateInstruction } from './prdTemplateIntent';
import { detectContentLanguage } from './prdLanguageDetector';
import { runFeatureExpansionPipeline } from './prdFeatureExpansion';
import { runPostCompilerPreservation } from './prdFeaturePreservation';
import { parsePRDToStructure } from './prdParser';
import type { PRDStructure } from './prdStructure';
import {
  FEATURE_ANALYSIS,
  GUIDED_QUESTIONS,
  GUIDED_REFINEMENT,
  GUIDED_FOLLOWUP,
  PRD_FINAL_GENERATION,
  REPAIR_PASS,
} from './tokenBudgets';

interface ConversationContext {
  projectIdea: string;
  featureOverview: string;
  answers: { questionId: string; question: string; answer: string }[];
  roundNumber: number;
  workflowMode: 'generate' | 'improve';
  existingContent?: string;
  templateCategory?: string;
  // ÄNDERUNG 02.03.2025: Gespeicherte Fragen für Security-Validierung
  lastQuestions?: GuidedQuestion[];
}

interface GuidedGenerationResult {
  content: string;
  totalTokens: number;
  modelsUsed: string[];
  enrichedStructure?: PRDStructure;
}

const SESSION_NOT_AVAILABLE_MESSAGE = 'Session not found or expired. Please start a new guided workflow.';

export class GuidedAiService {
  private conversationContexts: GuidedSessionStorePort<ConversationContext>;

  constructor(store?: GuidedSessionStorePort<ConversationContext>) {
    this.conversationContexts = store ?? new DbGuidedSessionStore();
  }

  async getSessionState(sessionId: string, userId: string): Promise<ConversationContext | null> {
    const authenticatedUserId = this.requireAuthenticatedUserId(userId);
    const session = await this.conversationContexts.get(sessionId, authenticatedUserId);
    if (session.status === 'ok') {
      return session.context ?? null;
    }
    if (session.status === 'forbidden') {
      throw new Error('Forbidden: You do not have access to this session');
    }
    return null;
  }

  async cleanupExpiredSessions(): Promise<number> {
    return this.conversationContexts.cleanupExpired();
  }

  async startGuidedWorkflow(
    projectIdea: string,
    userId: string,
    options?: {
      existingContent?: string;
      mode?: 'improve' | 'generate';
      templateCategory?: string;
    }
  ): Promise<GuidedStartResponse & { sessionId: string }> {
    const authenticatedUserId = this.requireAuthenticatedUserId(userId);
    const { client, contentLanguage } = await createClientWithUserPreferences(authenticatedUserId);
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
    const templateInstruction = buildTemplateInstruction(options?.templateCategory, resolvedLanguage);
    
    logger.debug('Guided workflow started', {
      projectIdeaLength: projectIdea.length,
      workflowMode,
      hasExistingContent: normalizedExistingContent.length > 0,
      baselineFeatureCount: modeResolution.assessment.featureCount,
      downgradedFromImprove: modeResolution.downgradedFromImprove,
    });

    // Step 1: Analyze project idea or improvement request and create initial feature overview
    logger.debug('Guided workflow analyzing input');
    const analysisInput = workflowMode === 'improve'
      ? `You are refining an existing PRD.

CHANGE REQUEST:
${projectIdea}

EXISTING PRD BASELINE:
${normalizedExistingContent}

Analyze what should be preserved and what should be improved. Focus on concrete user-facing refinements and missing sections.`
      : `Analyze this project idea:\n\n${projectIdea}\n\n${templateInstruction}`;
    
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
    const questionContext = workflowMode === 'improve'
      ? `Based on this analysis of an EXISTING PRD and requested refinements, generate 3-5 clarifying questions with multiple choice answers.\n\nAnalysis:\n${featureOverview}\n\nChange request: ${projectIdea}\n\nExisting PRD:\n${normalizedExistingContent}\n\n${templateInstruction}`
      : `Based on this project analysis, generate 3-5 clarifying questions with multiple choice answers:\n\n${featureOverview}\n\nOriginal idea: ${projectIdea}\n\n${templateInstruction}`;
    
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
    const parsedQuestions = this.parseQuestionsResponse(questionsResult.content);

    // Create session ID and store context
    const sessionId = this.generateSessionId();
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
    userId: string
  ): Promise<GuidedAnswerResponse> {
    const authenticatedUserId = this.requireAuthenticatedUserId(userId);
    const context = await this.getSessionContextOrThrow(sessionId, authenticatedUserId);

    const { client, contentLanguage } = await createClientWithUserPreferences(authenticatedUserId);
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
      const answerText = this.formatAnswerText(a, question);
      return `Q: ${questionText}\nA: ${answerText}`;
    }).join('\n\n');

    // Store answers in context with full question text
    answers.forEach(a => {
      const question = questionMap.get(a.questionId);
      context.answers.push({
        questionId: a.questionId,
        question: question?.question || a.questionId,
        answer: this.formatAnswerText(a, question),
      });
    });

    // Refine the plan based on answers
    logger.debug('Guided workflow refining product vision');
    const refinementInput = context.workflowMode === 'improve'
      ? `Existing PRD baseline:
${context.existingContent || '(no baseline provided)'}

Change request:
${context.projectIdea}

Current refined overview:
${context.featureOverview}

User's answers:
${formattedAnswers}

Refine the plan as an incremental improvement to the existing PRD. Preserve existing valid content and target the requested changes.

${buildTemplateInstruction(context.templateCategory, resolvedLanguage)}`
      : `Original project idea:
${context.projectIdea}

Current feature overview:
${context.featureOverview}

User's answers:
${formattedAnswers}

Refine the product vision and features based on these answers.

${buildTemplateInstruction(context.templateCategory, resolvedLanguage)}`;
    
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
    const userPrefs = await this.getUserPreferences(authenticatedUserId);
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

      const parsedFollowUp = this.parseQuestionsResponse(followUpResult.content);
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
      templateCategory?: string;
    }
  ): Promise<GuidedFinalizeResponse> {
    const authenticatedUserId = this.requireAuthenticatedUserId(userId);
    const context = await this.consumeSessionContextOrThrow(sessionId, authenticatedUserId);

    const { client, contentLanguage } = await createClientWithUserPreferences(authenticatedUserId);
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
      const templateInstruction = buildTemplateInstruction(effectiveTemplateCategory, resolvedLanguage);
      const systemPrompt = isImproveWorkflow
        ? FINAL_PRD_REFINEMENT_PROMPT + langInstruction
        : FINAL_PRD_GENERATION_PROMPT + langInstruction;
      const userPrompt = isImproveWorkflow
        ? `Refine the existing PRD by incorporating the requested improvements and guided decisions.

EXISTING PRD (PRESERVE AND IMPROVE):
${context.existingContent}

CHANGE REQUEST:
${context.projectIdea}

REFINED FEATURE OVERVIEW:
${context.featureOverview}

USER DECISIONS & PREFERENCES:
${allAnswers || 'No specific user preferences collected.'}

${templateInstruction}

Return the complete improved PRD.`
        : `Create a complete PRD based on:

ORIGINAL PROJECT IDEA:
${context.projectIdea}

REFINED FEATURE OVERVIEW:
${context.featureOverview}

USER DECISIONS & PREFERENCES:
${allAnswers || 'No specific user preferences collected.'}

${templateInstruction}

Generate a complete, professional PRD that incorporates all gathered requirements.`;

      const compiled = await this.generateWithCompilerGates({
        client,
        systemPrompt,
        userPrompt,
        mode: isImproveWorkflow ? 'improve' : 'generate',
        existingContent: isImproveWorkflow ? context.existingContent : undefined,
        contentLanguage: resolvedLanguage,
        templateCategory: effectiveTemplateCategory,
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
      existingContent?: string;
      mode?: 'improve' | 'generate';
      templateCategory?: string;
    }
  ): Promise<GuidedFinalizeResponse> {
    const { client, contentLanguage } = await createClientWithUserPreferences(userId);
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
    const templateInstruction = buildTemplateInstruction(options?.templateCategory, resolvedLanguage);

    logger.debug('Guided workflow skipped directly to finalize');

    // First do a quick feature analysis
    const analysisInput = isImproveWorkflow
      ? `Analyze the existing PRD and the requested refinements.

CHANGE REQUEST:
${projectIdea}

EXISTING PRD:
${normalizedExistingContent}`
      : `Analyze this project idea:\n\n${projectIdea}\n\n${templateInstruction}`;
    const analysisResult = await client.callWithFallback(
      'generator',
      FEATURE_ANALYSIS_PROMPT + langInstruction,
      analysisInput,
      FEATURE_ANALYSIS
    );

    // Then generate the full PRD
    const finalSystemPrompt = isImproveWorkflow
      ? FINAL_PRD_REFINEMENT_PROMPT + langInstruction
      : FINAL_PRD_GENERATION_PROMPT + langInstruction;
    const finalUserPrompt = isImproveWorkflow
      ? `Refine the existing PRD based on the requested changes.

EXISTING PRD:
${normalizedExistingContent}

CHANGE REQUEST:
${projectIdea}

FEATURE ANALYSIS:
${analysisResult.content}

${templateInstruction}

Return the complete improved PRD.`
      : `Create a complete PRD based on:

PROJECT IDEA:
${projectIdea}

FEATURE ANALYSIS:
${analysisResult.content}

${templateInstruction}

Generate a complete, professional PRD.`;
    const compiled = await this.generateWithCompilerGates({
      client,
      systemPrompt: finalSystemPrompt,
      userPrompt: finalUserPrompt,
      mode: isImproveWorkflow ? 'improve' : 'generate',
      existingContent: isImproveWorkflow ? normalizedExistingContent : undefined,
      contentLanguage: resolvedLanguage,
      templateCategory: options?.templateCategory,
    });

    logger.debug('Guided direct finalize complete', {
      totalTokens: analysisResult.usage.total_tokens + compiled.totalTokens,
    });

    return {
      prdContent: compiled.content,
      tokensUsed: analysisResult.usage.total_tokens + compiled.totalTokens,
      modelsUsed: [analysisResult.model, ...compiled.modelsUsed],
      workflowMode: isImproveWorkflow ? 'improve' : 'generate',
      existingContent: isImproveWorkflow ? normalizedExistingContent : undefined,
    };
  }

  private async generateWithCompilerGates(params: {
    client: ReturnType<typeof getOpenRouterClient>;
    systemPrompt: string;
    userPrompt: string;
    mode: 'generate' | 'improve';
    existingContent?: string;
    contentLanguage?: string | null;
    templateCategory?: string;
  }): Promise<GuidedGenerationResult> {
    const { client, systemPrompt, userPrompt, mode, existingContent, contentLanguage, templateCategory } = params;
    const language = detectContentLanguage(contentLanguage, `${userPrompt}\n${existingContent || ''}`);
    const modelsUsed = new Set<string>();
    let totalTokens = 0;

    const generationResult = await client.callWithFallback(
      'generator',
      systemPrompt,
      userPrompt,
      PRD_FINAL_GENERATION
    );
    modelsUsed.add(generationResult.model);
    totalTokens += generationResult.usage.total_tokens;

    // Feature Expansion (generate mode only — same pipeline as Simple/Iterative)
    let enrichedStructure: PRDStructure | undefined;
    if (mode === 'generate') {
      const expansion = await runFeatureExpansionPipeline({
        inputText: userPrompt,
        draftContent: generationResult.content,
        client,
        language,
        log: (msg) => logger.debug(msg),
        warn: (msg) => logger.warn(msg),
      });
      enrichedStructure = expansion.enrichedStructure;
      totalTokens += expansion.expansionTokens;
      if (expansion.featureListModel) modelsUsed.add(expansion.featureListModel);
      if (expansion.assembledContent && expansion.assembledContent.length > generationResult.content.length) {
        logger.debug(`📝 Guided: Replacing generator content with enriched structure (${expansion.expandedFeatureCount} features)`);
        generationResult.content = expansion.assembledContent;
      }
    } else if (mode === 'improve' && existingContent) {
      // Improve mode: parse existing content as baseline for post-compiler preservation.
      // Feature Expansion is skipped (too expensive), but we need a baseline so
      // runPostCompilerPreservation() can detect and restore features lost during compilation.
      enrichedStructure = parsePRDToStructure(existingContent);
      logger.debug(`🛡️ Guided improve baseline: ${enrichedStructure.features.length} features as preservation target`);
    }

    const primaryGenerator = client.getPreferredModel('generator') || '';
    const guidedFinalizerOpts = {
      mode,
      existingContent,
      language,
      templateCategory,
      originalRequest: userPrompt,
      maxRepairPasses: 3,
      repairGenerator: async (repairPrompt: string) => {
        logger.warn('Guided compiler quality gate failed; starting repair pass');
        const repairResult = await client.callWithFallback(
          'generator',
          systemPrompt,
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
    } as const;

    let finalized;
    try {
      finalized = await finalizeWithCompilerGates({
        initialResult: {
          content: generationResult.content,
          model: generationResult.model,
          usage: generationResult.usage,
          finishReason: generationResult.finishReason,
        },
        ...guidedFinalizerOpts,
      });
    } catch (error) {
      if (!(error instanceof PrdCompilerQualityError)) throw error;

      const triedModels = error.repairAttempts.map(a => a.model);
      const fallbackModel = pickNextFallbackModel(client, primaryGenerator, triedModels);
      if (!fallbackModel) throw error;

      logger.warn(`Guided quality fallback: ${primaryGenerator} → ${fallbackModel}`);
      client.setPreferredModel('generator', fallbackModel);

      try {
        const fallbackDraft = await client.callWithFallback(
          'generator',
          systemPrompt,
          userPrompt,
          PRD_FINAL_GENERATION
        );
        modelsUsed.add(fallbackDraft.model);
        totalTokens += fallbackDraft.usage.total_tokens;

        finalized = await finalizeWithCompilerGates({
          initialResult: {
            content: fallbackDraft.content,
            model: fallbackDraft.model,
            usage: fallbackDraft.usage,
            finishReason: fallbackDraft.finishReason,
          },
          ...guidedFinalizerOpts,
        });
        logger.info(`Guided quality fallback succeeded with ${fallbackModel}`);
      } catch (fallbackError) {
        const degraded = pickBestDegradedResult(error, fallbackError);
        if (degraded) {
          logger.warn('Both models failed quality gates — returning best degraded result');
          finalized = degraded;
        } else {
          throw error;
        }
      } finally {
        client.setPreferredModel('generator', primaryGenerator);
      }
    }

    for (const attempt of finalized.repairAttempts) {
      modelsUsed.add(attempt.model);
      totalTokens += attempt.usage.total_tokens;
    }

    // Post-compiler feature preservation (same as Simple flow)
    let finalContent = finalized.content;
    if (enrichedStructure && finalized.structure) {
      const preserved = runPostCompilerPreservation(
        enrichedStructure,
        { content: finalized.content, structure: finalized.structure },
        (msg) => logger.debug(msg),
        (msg) => logger.warn(msg),
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
    };
  }

  // resolveContentLanguage replaced by shared detectContentLanguage() from prdLanguageDetector.ts

  private parseQuestionsResponse(content: string): { preliminaryPlan?: string; questions: GuidedQuestion[] } {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        let questions = parsed.questions || [];
        
        // Validate and fix questions: ensure at least 2 meaningful options + custom
        questions = this.ensureMinimumOptions(questions);
        
        return {
          preliminaryPlan: parsed.preliminaryPlan || parsed.summary,
          questions,
        };
      }
    } catch (e) {
      logger.warn('Failed to parse guided questions JSON; falling back to text extraction', {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Fallback: Try to extract questions from text format
    const questions: GuidedQuestion[] = [];
    const questionPattern = /(?:\d+\.|#{1,3})\s*(.+\?)/g;
    let match;
    let questionNum = 1;
    
    while ((match = questionPattern.exec(content)) !== null) {
      questions.push({
        id: `q${questionNum}`,
        question: match[1].trim(),
        context: 'Please select the option that best describes your preference.',
        options: [
          { id: 'a', label: 'Option A', description: 'First choice' },
          { id: 'b', label: 'Option B', description: 'Second choice' },
          { id: 'c', label: 'Option C', description: 'Third choice' },
          { id: 'custom', label: 'Other', description: 'Let me explain my preference...' },
        ],
      });
      questionNum++;
      if (questionNum > 5) break;
    }

    return { questions };
  }

  private ensureMinimumOptions(questions: GuidedQuestion[]): GuidedQuestion[] {
    return questions.map(question => {
      // Guard against missing/empty options array
      if (!question.options || !Array.isArray(question.options)) {
        question.options = [];
      }
      
      // Filter out the custom/other option to count meaningful options
      const meaningfulOptions = question.options.filter(
        opt => opt.id !== 'custom' && opt.id !== 'other'
      );
      
      // If we have less than 2 meaningful options, add default options
      if (meaningfulOptions.length < 2) {
        logger.warn('Guided question has insufficient options; injecting defaults', {
          meaningfulOptionCount: meaningfulOptions.length,
        });
        
        const defaultOptions = [
          { id: 'a', label: 'Yes', description: 'Include this in the product' },
          { id: 'b', label: 'No', description: 'Skip this feature for now' },
          { id: 'c', label: 'Maybe', description: 'Consider for a later phase' },
        ];
        
        // Keep existing meaningful options and add from defaults as needed
        const newOptions = [...meaningfulOptions];
        let optionIndex = 0;
        while (newOptions.length < 3 && optionIndex < defaultOptions.length) {
          const defaultOpt = defaultOptions[optionIndex];
          if (!newOptions.some(opt => opt.id === defaultOpt.id)) {
            newOptions.push(defaultOpt);
          }
          optionIndex++;
        }
        
        // Always add custom option at the end
        newOptions.push({ id: 'custom', label: 'Other', description: 'Let me explain my preference...' });
        
        return { ...question, options: newOptions };
      }
      
      // Ensure custom option exists
      if (!question.options.some(opt => opt.id === 'custom' || opt.id === 'other')) {
        return {
          ...question,
          options: [...question.options, { id: 'custom', label: 'Other', description: 'Let me explain my preference...' }]
        };
      }
      
      return question;
    });
  }

  private generateSessionId(): string {
    return `guided_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private requireAuthenticatedUserId(userId?: string): string {
    if (!userId || !userId.trim()) {
      throw new Error('Authenticated user is required for guided workflow.');
    }
    return userId;
  }

  private async getSessionContextOrThrow(sessionId: string, userId: string): Promise<ConversationContext> {
    const session = await this.conversationContexts.get(sessionId, userId);
    if (session.status !== 'ok' || !session.context) {
      throw new Error(SESSION_NOT_AVAILABLE_MESSAGE);
    }
    return session.context;
  }

  private async consumeSessionContextOrThrow(sessionId: string, userId: string): Promise<ConversationContext> {
    const session = await this.conversationContexts.consume(sessionId, userId);
    if (session.status !== 'ok' || !session.context) {
      throw new Error(SESSION_NOT_AVAILABLE_MESSAGE);
    }
    return session.context;
  }

  // createClientWithUserPreferences replaced by shared createClientWithUserPreferences() from openrouter.ts

  private async getUserPreferences(userId?: string): Promise<{ guidedQuestionRounds?: number } | null> {
    if (!userId) return null;

    const userPrefs = await db.select({
      aiPreferences: users.aiPreferences
    })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (userPrefs[0]?.aiPreferences) {
      const prefs = userPrefs[0].aiPreferences as any;
      return {
        guidedQuestionRounds: prefs.guidedQuestionRounds || 3
      };
    }

    return null;
  }

  // ÄNDERUNG 02.03.2025: formatAnswerText als private Methode für DRY-Prinzip
  // ÄNDERUNG 02.03.2025: Explizite String-Prüfung für customText mit optionaler trim-Validierung
  private formatAnswerText(answer: GuidedAnswerInput, question?: GuidedQuestion): string {
    if (typeof answer.customText === 'string' && answer.selectedOptionIds?.includes('custom') && answer.customText.trim().length > 0) {
      return answer.customText;
    }
    if (question && answer.selectedOptionIds?.length) {
      return answer.selectedOptionIds
        .map(id => question.options.find(opt => opt.id === id))
        .filter((opt): opt is NonNullable<typeof opt> => opt !== undefined)
        .map(opt => `${opt.label}: ${opt.description}`)
        .join('; ');
    }
    return answer.selectedOptionIds?.join(', ') || '';
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
