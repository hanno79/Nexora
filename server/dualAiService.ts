// Dual-AI Service - Orchestrates Generator & Reviewer based on HRP-17
import { getOpenRouterClient } from './openrouter';
import type { OpenRouterClient } from './openrouter';
import {
  GENERATOR_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT,
  IMPROVEMENT_SYSTEM_PROMPT,
  type DualAiRequest,
  type DualAiResponse,
  type GeneratorResponse,
  type ReviewerResponse
} from './dualAiPrompts';
import { db } from './db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';

export class DualAiService {
  async generatePRD(request: DualAiRequest, userId?: string): Promise<DualAiResponse> {
    // Create fresh client per request to prevent cross-user contamination
    const client = await this.createClientWithUserPreferences(userId);
    
    const { userInput, existingContent, mode } = request;

    if (mode === 'review-only' && !existingContent) {
      throw new Error('review-only mode requires existingContent');
    }

    let generatorResponse: GeneratorResponse;
    let reviewerResponse: ReviewerResponse;
    let improvedVersion: GeneratorResponse | undefined;

    // Step 1: Generate initial PRD (skip if review-only)
    if (mode !== 'review-only') {
      console.log('🤖 Step 1: Generating PRD with AI Generator...');
      
      const generatorPrompt = existingContent
        ? `Verbessere folgendes PRD basierend auf neuem Input:\n\nBISHERIGES PRD:\n${existingContent}\n\nNEUER INPUT:\n${userInput}`
        : `Erstelle ein vollständiges PRD basierend auf:\n\n${userInput}`;

      const genResult = await client.callWithFallback(
        'generator',
        GENERATOR_SYSTEM_PROMPT,
        generatorPrompt,
        4000
      );

      generatorResponse = {
        content: genResult.content,
        model: genResult.model,
        usage: genResult.usage,
        tier: genResult.tier
      };

      console.log(`✅ Generated ${genResult.usage.completion_tokens} tokens with ${genResult.model}`);
    } else {
      generatorResponse = {
        content: existingContent!,
        model: 'existing',
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        tier: 'n/a'
      };
    }

    // Step 2: Review with AI Reviewer
    console.log('🔍 Step 2: Reviewing PRD with AI Reviewer...');
    
    const reviewerPrompt = `Bewerte folgendes PRD kritisch:\n\n${generatorResponse.content}`;

    const reviewResult = await client.callWithFallback(
      'reviewer',
      REVIEWER_SYSTEM_PROMPT,
      reviewerPrompt,
      2000
    );

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

    console.log(`✅ Review complete with ${reviewResult.usage.completion_tokens} tokens using ${reviewResult.model}`);

    // Step 3: Improve based on review (if in improve mode)
    if (mode === 'improve' && questions.length > 0) {
      console.log('🔧 Step 3: Improving PRD based on review feedback...');
      
      const improvementPrompt = `ORIGINAL PRD:\n${generatorResponse.content}\n\nREVIEW FEEDBACK:\n${reviewContent}\n\nVerbessere das PRD und adressiere die kritischen Fragen.`;

      const improveResult = await client.callWithFallback(
        'generator',
        IMPROVEMENT_SYSTEM_PROMPT,
        improvementPrompt,
        4000
      );

      improvedVersion = {
        content: improveResult.content,
        model: improveResult.model,
        usage: improveResult.usage,
        tier: improveResult.tier
      };

      console.log(`✅ Improved version generated with ${improveResult.usage.completion_tokens} tokens`);
    }

    // Calculate totals
    const totalTokens = 
      generatorResponse.usage.total_tokens +
      reviewerResponse.usage.total_tokens +
      (improvedVersion?.usage.total_tokens || 0);

    const modelsUsed = Array.from(new Set([
      generatorResponse.model,
      reviewerResponse.model,
      improvedVersion?.model
    ].filter(Boolean))) as string[];

    return {
      finalContent: improvedVersion?.content || generatorResponse.content,
      generatorResponse,
      reviewerResponse,
      improvedVersion,
      totalTokens,
      modelsUsed
    };
  }

  async reviewOnly(prdContent: string, userId?: string): Promise<ReviewerResponse> {
    // Create fresh client per request to prevent cross-user contamination
    const client = await this.createClientWithUserPreferences(userId);
    
    console.log('🔍 Reviewing existing PRD...');
    
    const reviewerPrompt = `Bewerte folgendes PRD kritisch:\n\n${prdContent}`;

    const reviewResult = await client.callWithFallback(
      'reviewer',
      REVIEWER_SYSTEM_PROMPT,
      reviewerPrompt,
      2000
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

  private async createClientWithUserPreferences(userId?: string): Promise<OpenRouterClient> {
    const client = getOpenRouterClient();

    if (userId) {
      const userPrefs = await db.select({ aiPreferences: users.aiPreferences })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      
      if (userPrefs[0]?.aiPreferences) {
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

    return client;
  }

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
