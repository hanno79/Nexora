// Guided AI Service - User-involved PRD Generation Workflow
import { getOpenRouterClient } from './openrouter';
import {
  FEATURE_ANALYSIS_PROMPT,
  USER_QUESTION_PROMPT,
  FEATURE_REFINEMENT_PROMPT,
  GENERATE_FOLLOWUP_QUESTIONS_PROMPT,
  FINAL_PRD_GENERATION_PROMPT,
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

interface ConversationContext {
  projectIdea: string;
  featureOverview: string;
  answers: { questionId: string; question: string; answer: string }[];
  roundNumber: number;
}

export class GuidedAiService {
  private conversationContexts: Map<string, ConversationContext> = new Map();

  async startGuidedWorkflow(
    projectIdea: string,
    userId?: string
  ): Promise<GuidedStartResponse & { sessionId: string }> {
    const { client, contentLanguage } = await this.createClientWithUserPreferences(userId);
    const langInstruction = getLanguageInstruction(contentLanguage);
    
    console.log('🎯 Starting Guided AI Workflow...');
    console.log(`📝 Project idea: ${projectIdea.substring(0, 100)}...`);

    // Step 1: Analyze the project idea and create initial feature overview
    console.log('🔍 Step 1: Analyzing project idea...');
    
    const analysisResult = await client.callWithFallback(
      'generator',
      FEATURE_ANALYSIS_PROMPT + langInstruction,
      `Analyze this project idea:\n\n${projectIdea}`,
      3000
    );

    const featureOverview = analysisResult.content;
    console.log(`✅ Feature analysis complete (${analysisResult.usage.completion_tokens} tokens)`);

    // Step 2: Generate initial questions for the user
    console.log('❓ Step 2: Generating clarifying questions...');
    
    const questionsResult = await client.callWithFallback(
      'reviewer',
      USER_QUESTION_PROMPT + langInstruction,
      `Based on this project analysis, generate 3-5 clarifying questions with multiple choice answers:\n\n${featureOverview}\n\nOriginal idea: ${projectIdea}`,
      2500
    );

    console.log(`✅ Questions generated (${questionsResult.usage.completion_tokens} tokens)`);

    // Parse the JSON response
    const parsedQuestions = this.parseQuestionsResponse(questionsResult.content);

    // Create session ID and store context
    const sessionId = this.generateSessionId();
    this.conversationContexts.set(sessionId, {
      projectIdea,
      featureOverview,
      answers: [],
      roundNumber: 1,
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
    userId?: string
  ): Promise<GuidedAnswerResponse> {
    const context = this.conversationContexts.get(sessionId);
    if (!context) {
      throw new Error('Session not found. Please start a new guided workflow.');
    }

    const { client, contentLanguage } = await this.createClientWithUserPreferences(userId);
    const langInstruction = getLanguageInstruction(contentLanguage);

    console.log(`📝 Processing ${answers.length} answers for session ${sessionId}...`);

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
    console.log('🔄 Refining product vision based on answers...');
    
    const refinementResult = await client.callWithFallback(
      'generator',
      FEATURE_REFINEMENT_PROMPT + langInstruction,
      `Original project idea:\n${context.projectIdea}\n\nCurrent feature overview:\n${context.featureOverview}\n\nUser's answers:\n${formattedAnswers}\n\nRefine the product vision and features based on these answers.`,
      4000
    );

    context.featureOverview = refinementResult.content;
    console.log(`✅ Refinement complete (${refinementResult.usage.completion_tokens} tokens)`);

    // Decide if we need more questions (max 3 rounds)
    const maxRounds = 3;
    context.roundNumber++;

    if (context.roundNumber <= maxRounds) {
      // Generate follow-up questions
      console.log('❓ Generating follow-up questions...');
      
      const followUpResult = await client.callWithFallback(
        'reviewer',
        GENERATE_FOLLOWUP_QUESTIONS_PROMPT + langInstruction,
        `Current refined plan:\n${refinementResult.content}\n\nPrevious answers:\n${formattedAnswers}\n\nGenerate 2-3 follow-up questions to further refine the product.`,
        2000
      );

      const parsedFollowUp = this.parseQuestionsResponse(followUpResult.content);
      console.log(`✅ Follow-up questions generated (${followUpResult.usage.completion_tokens} tokens)`);

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
    userId?: string
  ): Promise<GuidedFinalizeResponse> {
    const context = this.conversationContexts.get(sessionId);
    if (!context) {
      throw new Error('Session not found. Please start a new guided workflow.');
    }

    const { client, contentLanguage } = await this.createClientWithUserPreferences(userId);
    const langInstruction = getLanguageInstruction(contentLanguage);

    console.log('📄 Generating final PRD...');

    // Compile all context for final PRD generation
    const allAnswers = context.answers.map(a => 
      `- ${a.questionId}: ${a.answer}`
    ).join('\n');

    const prdResult = await client.callWithFallback(
      'generator',
      FINAL_PRD_GENERATION_PROMPT + langInstruction,
      `Create a complete PRD based on:

ORIGINAL PROJECT IDEA:
${context.projectIdea}

REFINED FEATURE OVERVIEW:
${context.featureOverview}

USER DECISIONS & PREFERENCES:
${allAnswers || 'No specific user preferences collected.'}

Generate a complete, professional PRD that incorporates all gathered requirements.`,
      8000
    );

    console.log(`✅ Final PRD generated (${prdResult.usage.completion_tokens} tokens)`);

    // Clean up session
    this.conversationContexts.delete(sessionId);

    return {
      prdContent: prdResult.content,
      tokensUsed: prdResult.usage.total_tokens,
      modelsUsed: [prdResult.model],
    };
  }

  async skipToFinalize(
    projectIdea: string,
    userId?: string
  ): Promise<GuidedFinalizeResponse> {
    const { client, contentLanguage } = await this.createClientWithUserPreferences(userId);
    const langInstruction = getLanguageInstruction(contentLanguage);

    console.log('⚡ Skipping guided workflow, generating PRD directly...');

    // First do a quick feature analysis
    const analysisResult = await client.callWithFallback(
      'generator',
      FEATURE_ANALYSIS_PROMPT + langInstruction,
      `Analyze this project idea:\n\n${projectIdea}`,
      3000
    );

    // Then generate the full PRD
    const prdResult = await client.callWithFallback(
      'generator',
      FINAL_PRD_GENERATION_PROMPT + langInstruction,
      `Create a complete PRD based on:

PROJECT IDEA:
${projectIdea}

FEATURE ANALYSIS:
${analysisResult.content}

Generate a complete, professional PRD.`,
      8000
    );

    console.log(`✅ PRD generated directly (${prdResult.usage.total_tokens} total tokens)`);

    return {
      prdContent: prdResult.content,
      tokensUsed: analysisResult.usage.total_tokens + prdResult.usage.total_tokens,
      modelsUsed: [analysisResult.model, prdResult.model],
    };
  }

  private parseQuestionsResponse(content: string): { preliminaryPlan?: string; questions: GuidedQuestion[] } {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          preliminaryPlan: parsed.preliminaryPlan || parsed.summary,
          questions: parsed.questions || [],
        };
      }
    } catch (e) {
      console.warn('Failed to parse questions JSON, attempting text extraction:', e);
    }

    // Fallback: Try to extract questions from text format
    const questions: GuidedQuestion[] = [];
    const questionMatches = content.matchAll(/(?:\d+\.|#{1,3})\s*(.+\?)/g);
    
    let questionNum = 1;
    for (const match of questionMatches) {
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

  private generateSessionId(): string {
    return `guided_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
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
          if (prefs.generatorModel) {
            client.setPreferredModel('generator', prefs.generatorModel);
          }
          if (prefs.reviewerModel) {
            client.setPreferredModel('reviewer', prefs.reviewerModel);
          }
          if (prefs.tier) {
            client.setPreferredTier(prefs.tier);
          }
        }
      }
    }

    return { client, contentLanguage };
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
