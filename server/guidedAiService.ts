// Guided AI Service - User-involved PRD Generation Workflow
import { getOpenRouterClient } from './openrouter';
import { MODEL_TIERS, getDefaultFallbackModelForTier, sanitizeConfiguredModel } from './openrouter';
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
import { GuidedSessionStore } from './guidedSessionStore';
import { logger } from './logger';
import { finalizeWithCompilerGates } from './prdCompilerFinalizer';
import { resolvePrdWorkflowMode } from './prdWorkflowMode';

interface ConversationContext {
  projectIdea: string;
  featureOverview: string;
  answers: { questionId: string; question: string; answer: string }[];
  roundNumber: number;
  workflowMode: 'generate' | 'improve';
  existingContent?: string;
}

interface GuidedGenerationResult {
  content: string;
  totalTokens: number;
  modelsUsed: string[];
}

const SESSION_NOT_AVAILABLE_MESSAGE = 'Session not found or expired. Please start a new guided workflow.';

export class GuidedAiService {
  private conversationContexts: GuidedSessionStore<ConversationContext> = new GuidedSessionStore();

  async startGuidedWorkflow(
    projectIdea: string,
    userId: string,
    options?: {
      existingContent?: string;
      mode?: 'improve' | 'generate';
    }
  ): Promise<GuidedStartResponse & { sessionId: string }> {
    const authenticatedUserId = this.requireAuthenticatedUserId(userId);
    const { client, contentLanguage } = await this.createClientWithUserPreferences(authenticatedUserId);
    const normalizedExistingContent = typeof options?.existingContent === 'string'
      ? options.existingContent.trim()
      : '';
    const resolvedLanguage = this.resolveContentLanguage(
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
    const analysisInput = workflowMode === 'improve'
      ? `You are refining an existing PRD.

CHANGE REQUEST:
${projectIdea}

EXISTING PRD BASELINE:
${normalizedExistingContent}

Analyze what should be preserved and what should be improved. Focus on concrete user-facing refinements and missing sections.`
      : `Analyze this project idea:\n\n${projectIdea}`;
    
    const analysisResult = await client.callWithFallback(
      'generator',
      FEATURE_ANALYSIS_PROMPT + langInstruction,
      analysisInput,
      3000
    );

    const featureOverview = analysisResult.content;
    logger.debug('Guided workflow feature analysis complete', {
      completionTokens: analysisResult.usage.completion_tokens,
    });

    // Step 2: Generate initial questions for the user
    logger.debug('Guided workflow generating clarifying questions');
    const questionContext = workflowMode === 'improve'
      ? `Based on this analysis of an EXISTING PRD and requested refinements, generate 3-5 clarifying questions with multiple choice answers.\n\nAnalysis:\n${featureOverview}\n\nChange request: ${projectIdea}\n\nExisting PRD:\n${normalizedExistingContent}`
      : `Based on this project analysis, generate 3-5 clarifying questions with multiple choice answers:\n\n${featureOverview}\n\nOriginal idea: ${projectIdea}`;
    
    const questionsResult = await client.callWithFallback(
      'reviewer',
      USER_QUESTION_PROMPT + langInstruction,
      questionContext,
      2500
    );

    logger.debug('Guided workflow questions generated', {
      completionTokens: questionsResult.usage.completion_tokens,
    });

    // Parse the JSON response
    const parsedQuestions = this.parseQuestionsResponse(questionsResult.content);

    // Create session ID and store context
    const sessionId = this.generateSessionId();
    this.conversationContexts.create(sessionId, authenticatedUserId, {
      projectIdea,
      featureOverview,
      answers: [],
      roundNumber: 1,
      workflowMode,
      existingContent: normalizedExistingContent || undefined,
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
    const context = this.getSessionContextOrThrow(sessionId, authenticatedUserId);

    const { client, contentLanguage } = await this.createClientWithUserPreferences(authenticatedUserId);
    const resolvedLanguage = this.resolveContentLanguage(
      contentLanguage,
      `${context.projectIdea || ''}\n${context.featureOverview || ''}`
    );
    const langInstruction = getLanguageInstruction(resolvedLanguage);

    logger.debug('Guided workflow processing answers', { answerCount: answers.length });

    // Create a map of questions for lookup
    const questionMap = new Map(questions.map(q => [q.id, q]));

    // Format answers for the AI with proper labels, not just IDs
    const formattedAnswers = answers.map(a => {
      const question = questionMap.get(a.questionId);
      const questionText = question?.question || a.questionId;
      
      // Get the actual option label/description, not just the ID
      let answerText: string;
      if (a.customText) {
        answerText = a.customText;
      } else if (question) {
        const selectedOption = question.options.find(opt => opt.id === a.selectedOptionId);
        answerText = selectedOption 
          ? `${selectedOption.label}: ${selectedOption.description}`
          : a.selectedOptionId;
      } else {
        answerText = a.selectedOptionId;
      }
      
      return `Q: ${questionText}\nA: ${answerText}`;
    }).join('\n\n');

    // Store answers in context with full question text
    answers.forEach(a => {
      const question = questionMap.get(a.questionId);
      const selectedOption = question?.options.find(opt => opt.id === a.selectedOptionId);
      
      context.answers.push({
        questionId: a.questionId,
        question: question?.question || a.questionId,
        answer: a.customText || (selectedOption ? `${selectedOption.label}: ${selectedOption.description}` : a.selectedOptionId),
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

Refine the plan as an incremental improvement to the existing PRD. Preserve existing valid content and target the requested changes.`
      : `Original project idea:
${context.projectIdea}

Current feature overview:
${context.featureOverview}

User's answers:
${formattedAnswers}

Refine the product vision and features based on these answers.`;
    
    const refinementResult = await client.callWithFallback(
      'generator',
      FEATURE_REFINEMENT_PROMPT + langInstruction,
      refinementInput,
      4000
    );

    context.featureOverview = refinementResult.content;
    logger.debug('Guided workflow refinement complete', {
      completionTokens: refinementResult.usage.completion_tokens,
    });

    // Decide if we need more questions (use user's configured max rounds)
    const userPrefs = await this.getUserPreferences(authenticatedUserId);
    const maxRounds = userPrefs?.guidedQuestionRounds || 3;
    context.roundNumber++;

    if (context.roundNumber <= maxRounds) {
      // Generate follow-up questions
      logger.debug('Guided workflow generating follow-up questions');
      
      const followUpResult = await client.callWithFallback(
        'reviewer',
        GENERATE_FOLLOWUP_QUESTIONS_PROMPT + langInstruction,
        `Current refined plan:\n${refinementResult.content}\n\nPrevious answers:\n${formattedAnswers}\n\nGenerate 2-3 follow-up questions to further refine the product.`,
        2000
      );

      const parsedFollowUp = this.parseQuestionsResponse(followUpResult.content);
      logger.debug('Guided workflow follow-up questions generated', {
        completionTokens: followUpResult.usage.completion_tokens,
      });

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
    userId: string
  ): Promise<GuidedFinalizeResponse> {
    const authenticatedUserId = this.requireAuthenticatedUserId(userId);
    const context = this.consumeSessionContextOrThrow(sessionId, authenticatedUserId);

    const { client, contentLanguage } = await this.createClientWithUserPreferences(authenticatedUserId);
    const resolvedLanguage = this.resolveContentLanguage(
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

Return the complete improved PRD.`
        : `Create a complete PRD based on:

ORIGINAL PROJECT IDEA:
${context.projectIdea}

REFINED FEATURE OVERVIEW:
${context.featureOverview}

USER DECISIONS & PREFERENCES:
${allAnswers || 'No specific user preferences collected.'}

Generate a complete, professional PRD that incorporates all gathered requirements.`;

      const compiled = await this.generateWithCompilerGates({
        client,
        systemPrompt,
        userPrompt,
        mode: isImproveWorkflow ? 'improve' : 'generate',
        existingContent: isImproveWorkflow ? context.existingContent : undefined,
        contentLanguage: resolvedLanguage,
      });

      logger.debug('Guided workflow final PRD compiled', {
        totalTokens: compiled.totalTokens,
      });

      return {
        prdContent: compiled.content,
        tokensUsed: compiled.totalTokens,
        modelsUsed: compiled.modelsUsed,
      };
    } catch (error) {
      // Restore session context on failure so users can retry finalize.
      this.conversationContexts.create(sessionId, authenticatedUserId, context);
      throw error;
    }
  }

  async skipToFinalize(
    projectIdea: string,
    userId?: string,
    options?: {
      existingContent?: string;
      mode?: 'improve' | 'generate';
    }
  ): Promise<GuidedFinalizeResponse> {
    const { client, contentLanguage } = await this.createClientWithUserPreferences(userId);
    const normalizedExistingContent = typeof options?.existingContent === 'string'
      ? options.existingContent.trim()
      : '';
    const resolvedLanguage = this.resolveContentLanguage(
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
    const analysisInput = isImproveWorkflow
      ? `Analyze the existing PRD and the requested refinements.

CHANGE REQUEST:
${projectIdea}

EXISTING PRD:
${normalizedExistingContent}`
      : `Analyze this project idea:\n\n${projectIdea}`;
    const analysisResult = await client.callWithFallback(
      'generator',
      FEATURE_ANALYSIS_PROMPT + langInstruction,
      analysisInput,
      3000
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

Return the complete improved PRD.`
      : `Create a complete PRD based on:

PROJECT IDEA:
${projectIdea}

FEATURE ANALYSIS:
${analysisResult.content}

Generate a complete, professional PRD.`;
    const compiled = await this.generateWithCompilerGates({
      client,
      systemPrompt: finalSystemPrompt,
      userPrompt: finalUserPrompt,
      mode: isImproveWorkflow ? 'improve' : 'generate',
      existingContent: isImproveWorkflow ? normalizedExistingContent : undefined,
      contentLanguage: resolvedLanguage,
    });

    logger.debug('Guided direct finalize complete', {
      totalTokens: analysisResult.usage.total_tokens + compiled.totalTokens,
    });

    return {
      prdContent: compiled.content,
      tokensUsed: analysisResult.usage.total_tokens + compiled.totalTokens,
      modelsUsed: [analysisResult.model, ...compiled.modelsUsed],
    };
  }

  private async generateWithCompilerGates(params: {
    client: ReturnType<typeof getOpenRouterClient>;
    systemPrompt: string;
    userPrompt: string;
    mode: 'generate' | 'improve';
    existingContent?: string;
    contentLanguage?: string | null;
  }): Promise<GuidedGenerationResult> {
    const { client, systemPrompt, userPrompt, mode, existingContent, contentLanguage } = params;
    const language = this.resolveContentLanguage(contentLanguage, `${userPrompt}\n${existingContent || ''}`);
    const modelsUsed = new Set<string>();
    let totalTokens = 0;

    const generationResult = await client.callWithFallback(
      'generator',
      systemPrompt,
      userPrompt,
      10000
    );
    modelsUsed.add(generationResult.model);
    totalTokens += generationResult.usage.total_tokens;
    const finalized = await finalizeWithCompilerGates({
      initialResult: {
        content: generationResult.content,
        model: generationResult.model,
        usage: generationResult.usage,
        finishReason: generationResult.finishReason,
      },
      mode,
      existingContent,
      language,
      originalRequest: userPrompt,
      maxRepairPasses: 2,
      repairGenerator: async (repairPrompt) => {
        logger.warn('Guided compiler quality gate failed; starting repair pass');
        const repairResult = await client.callWithFallback(
          'generator',
          systemPrompt,
          repairPrompt,
          12000
        );
        return {
          content: repairResult.content,
          model: repairResult.model,
          usage: repairResult.usage,
          finishReason: repairResult.finishReason,
        };
      },
    });

    for (const attempt of finalized.repairAttempts) {
      modelsUsed.add(attempt.model);
      totalTokens += attempt.usage.total_tokens;
    }

    return {
      content: finalized.content,
      totalTokens,
      modelsUsed: Array.from(modelsUsed),
    };
  }

  private resolveContentLanguage(contentLanguage: string | null | undefined, text: string): 'de' | 'en' {
    if (contentLanguage === 'de') return 'de';
    if (contentLanguage === 'en') return 'en';

    const sample = (text || '').toLowerCase();
    if (/[äöüß]/i.test(sample)) return 'de';
    if (/\b(und|oder|mit|fuer|für|bitte|erstelle|anforderung|nutzer)\b/i.test(sample)) return 'de';
    return 'en';
  }

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

  private getSessionContextOrThrow(sessionId: string, userId: string): ConversationContext {
    const session = this.conversationContexts.get(sessionId, userId);
    if (session.status !== 'ok' || !session.context) {
      throw new Error(SESSION_NOT_AVAILABLE_MESSAGE);
    }
    return session.context;
  }

  private consumeSessionContextOrThrow(sessionId: string, userId: string): ConversationContext {
    const session = this.conversationContexts.consume(sessionId, userId);
    if (session.status !== 'ok' || !session.context) {
      throw new Error(SESSION_NOT_AVAILABLE_MESSAGE);
    }
    return session.context;
  }

  private async createClientWithUserPreferences(userId?: string) {
    const client = getOpenRouterClient();
    let contentLanguage: string | null = null;

    if (userId) {
      const userPrefs = await db.select({ 
        aiPreferences: users.aiPreferences,
        defaultContentLanguage: users.defaultContentLanguage
      })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      
      if (userPrefs[0]) {
        contentLanguage = userPrefs[0].defaultContentLanguage || null;
        
        if (userPrefs[0].aiPreferences) {
          const prefs = userPrefs[0].aiPreferences as any;
          const tier = prefs.tier || 'production';
          const tierKey = (tier in MODEL_TIERS ? tier : 'production') as keyof typeof MODEL_TIERS;
          const tierDefaults = MODEL_TIERS[tierKey] || MODEL_TIERS.production;
          const activeTierModels = prefs.tierModels?.[tier] || {};

          const resolvedGeneratorModel =
            sanitizeConfiguredModel(activeTierModels.generatorModel || prefs.generatorModel) ||
            tierDefaults.generator;
          const resolvedReviewerModel =
            sanitizeConfiguredModel(activeTierModels.reviewerModel || prefs.reviewerModel) ||
            tierDefaults.reviewer;
          const resolvedFallbackModel =
            sanitizeConfiguredModel(activeTierModels.fallbackModel || prefs.fallbackModel) ||
            getDefaultFallbackModelForTier(tierKey);

          client.setPreferredModel('generator', resolvedGeneratorModel);
          client.setPreferredModel('reviewer', resolvedReviewerModel);
          client.setPreferredModel('fallback', resolvedFallbackModel);
          client.setPreferredTier(tierKey);
        }
      }
    }

    return { client, contentLanguage };
  }

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
}

// Singleton instance
let guidedAiService: GuidedAiService | null = null;

export function getGuidedAiService(): GuidedAiService {
  if (!guidedAiService) {
    guidedAiService = new GuidedAiService();
  }
  return guidedAiService;
}
