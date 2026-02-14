// Dual-AI Service - Orchestrates Generator & Reviewer based on HRP-17
import { getOpenRouterClient } from './openrouter';
import type { OpenRouterClient } from './openrouter';
import {
  GENERATOR_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT,
  IMPROVEMENT_SYSTEM_PROMPT,
  ITERATIVE_GENERATOR_PROMPT,
  BEST_PRACTICE_ANSWERER_PROMPT,
  FINAL_REVIEWER_PROMPT,
  getLanguageInstruction,
  type DualAiRequest,
  type DualAiResponse,
  type GeneratorResponse,
  type ReviewerResponse,
  type IterativeResponse,
  type IterationData
} from './dualAiPrompts';
import { generateFeatureList } from './services/llm/generateFeatureList';
import { db } from './db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';

export class DualAiService {
  async generatePRD(request: DualAiRequest, userId?: string): Promise<DualAiResponse> {
    // Create fresh client per request to prevent cross-user contamination
    const { client, contentLanguage } = await this.createClientWithUserPreferences(userId);
    const langInstruction = getLanguageInstruction(contentLanguage);
    
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
      
      let generatorPrompt: string;
      if (existingContent) {
        // IMPROVEMENT MODE: Explicitly instruct to preserve and build upon existing content
        generatorPrompt = `IMPORTANT: You are IMPROVING an existing PRD. Do NOT start from scratch!

CRITICAL RULES:
- PRESERVE the existing structure and all sections
- KEEP all existing content - do not remove or replace it
- ADD new content based on the user's input
- EXPAND existing sections with more details where relevant
- Only MODIFY content if it directly contradicts the new requirements

EXISTING PRD (PRESERVE THIS):
${existingContent}

USER'S ADDITIONAL REQUIREMENTS/IMPROVEMENTS:
${userInput}

Create an improved version that incorporates the new requirements while keeping all existing content intact.`;
      } else {
        // NEW GENERATION MODE: Create from scratch
        generatorPrompt = `Erstelle ein vollständiges PRD basierend auf:\n\n${userInput}`;
      }

      const genResult = await client.callWithFallback(
        'generator',
        GENERATOR_SYSTEM_PROMPT + langInstruction,
        generatorPrompt,
        8000  // Increased for comprehensive PRDs
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

    // Feature Identification Layer (runs after vision generation, before review)
    if (mode !== 'review-only') {
      try {
        console.log('🧩 Feature Identification Layer: Extracting atomic features...');
        const vision = this.extractVisionFromContent(generatorResponse.content);
        const featureResult = await generateFeatureList(userInput, vision, client);
        console.log(`🧩 Feature List (model: ${featureResult.model}, retried: ${featureResult.retried}):`);
        console.log(featureResult.featureList);
      } catch (error: any) {
        console.warn('⚠️ Feature Identification Layer failed (non-blocking):', error.message);
      }
    }

    // Step 2: Review with AI Reviewer
    console.log('🔍 Step 2: Reviewing PRD with AI Reviewer...');
    
    const reviewerPrompt = `Bewerte folgendes PRD kritisch:\n\n${generatorResponse.content}`;

    const reviewResult = await client.callWithFallback(
      'reviewer',
      REVIEWER_SYSTEM_PROMPT + langInstruction,
      reviewerPrompt,
      3000  // Increased for detailed review with 5-10 questions
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

    // Step 3: Improve based on review (always run in improve mode, regardless of question extraction)
    if (mode === 'improve') {
      console.log('🔧 Step 3: Improving PRD based on review feedback...');
      
      const improvementPrompt = `ORIGINAL PRD:\n${generatorResponse.content}\n\nREVIEW FEEDBACK:\n${reviewContent}\n\nVerbessere das PRD und adressiere die kritischen Fragen.`;

      const improveResult = await client.callWithFallback(
        'generator',
        IMPROVEMENT_SYSTEM_PROMPT + langInstruction,
        improvementPrompt,
        10000  // Increased significantly for complete PRD improvements (2-3x original length)
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
    const { client, contentLanguage } = await this.createClientWithUserPreferences(userId);
    const langInstruction = getLanguageInstruction(contentLanguage);
    
    console.log('🔍 Reviewing existing PRD...');
    
    const reviewerPrompt = `Critically evaluate the following PRD:\n\n${prdContent}`;

    const reviewResult = await client.callWithFallback(
      'reviewer',
      REVIEWER_SYSTEM_PROMPT + langInstruction,
      reviewerPrompt,
      3000  // Increased for detailed review with 5-10 questions
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

  async generateIterative(
    existingContent: string,
    additionalRequirements: string | undefined,
    mode: 'improve' | 'generate',
    iterationCount: number = 3,
    useFinalReview: boolean = false,
    userId?: string
  ): Promise<IterativeResponse> {
    // Create fresh client per request to prevent cross-user contamination
    const { client, contentLanguage } = await this.createClientWithUserPreferences(userId);
    const langInstruction = getLanguageInstruction(contentLanguage);
    
    // Use explicit mode from client - no heuristics needed
    const isImprovement = mode === 'improve';
    const trimmedContent = existingContent?.trim() || '';
    
    console.log(`🔄 Starting iterative workflow: ${iterationCount} iterations, final review: ${useFinalReview}`);
    console.log(`📝 Mode: ${isImprovement ? 'IMPROVEMENT (building upon existing content)' : 'NEW GENERATION'}`);
    console.log(`📄 Existing content length: ${trimmedContent.length} characters`);
    if (additionalRequirements) {
      console.log(`➕ Additional requirements provided: ${additionalRequirements.substring(0, 100)}...`);
    }
    
    const iterations: IterationData[] = [];
    let currentPRD = existingContent || '';
    const modelsUsed = new Set<string>();
    
    // Iterative Q&A Loop
    for (let i = 1; i <= iterationCount; i++) {
      console.log(`\n📝 Iteration ${i}/${iterationCount}`);
      
      // Step 1: AI #1 (Generator) - Creates PRD draft + asks questions
      console.log(`🤖 AI #1: Generating PRD draft and identifying gaps...`);
      
      let generatorPrompt: string;
      
      if (i === 1) {
        if (isImprovement) {
          // IMPROVEMENT MODE: Build upon existing content
          generatorPrompt = `IMPORTANT: You are IMPROVING an EXISTING PRD. Do NOT start from scratch!

EXISTING PRD (PRESERVE THIS STRUCTURE AND CONTENT):
${existingContent}

${additionalRequirements ? `ADDITIONAL REQUIREMENTS TO INTEGRATE:
${additionalRequirements}

Your task:
1. KEEP all existing sections and their content
2. ADD the new requirements into the appropriate existing sections
3. ENHANCE and EXPAND existing content where relevant
4. Do NOT remove or replace existing content unless it contradicts the new requirements
5. Ask questions about any unclear aspects of the new requirements` : `Your task:
1. KEEP all existing sections and their content  
2. ENHANCE and EXPAND existing content with more details
3. Identify gaps and missing information
4. Ask questions to improve specific sections`}`;
        } else {
          // NEW GENERATION MODE: Start fresh
          generatorPrompt = `INITIAL INPUT:\n${additionalRequirements || existingContent}\n\nCreate an initial PRD draft and ask questions about open points.`;
        }
      } else {
        // Subsequent iterations: Always improve current state
        generatorPrompt = `CURRENT PRD (DO NOT DISCARD - BUILD UPON IT):
${currentPRD}

Your task:
1. PRESERVE all existing sections and content
2. INTEGRATE any answered questions from previous iterations
3. EXPAND sections that are still incomplete
4. Ask questions about remaining gaps only
5. Make the PRD more detailed and comprehensive`
      }
      
      const genResult = await client.callWithFallback(
        'generator',
        ITERATIVE_GENERATOR_PROMPT + langInstruction,
        generatorPrompt,
        8000  // Enough for PRD + questions
      );
      
      modelsUsed.add(genResult.model);
      console.log(`✅ Generated ${genResult.usage.completion_tokens} tokens with ${genResult.model}`);
      
      // Feature Identification Layer (first iteration only)
      if (i === 1) {
        try {
          console.log('🧩 Feature Identification Layer (iterative): Extracting atomic features...');
          const vision = this.extractVisionFromContent(genResult.content);
          const inputText = additionalRequirements || existingContent || '';
          const featureResult = await generateFeatureList(inputText, vision, client);
          console.log(`🧩 Feature List (model: ${featureResult.model}, retried: ${featureResult.retried}):`);
          console.log(featureResult.featureList);
        } catch (error: any) {
          console.warn('⚠️ Feature Identification Layer failed (non-blocking):', error.message);
        }
      }

      // Extract questions from generator output
      const questions = this.extractQuestionsFromIterativeOutput(genResult.content);
      console.log(`📋 Extracted ${questions.length} questions`);
      
      // Step 2: AI #2 (Answerer) - Answers with best practices
      console.log(`🧠 AI #2: Answering questions with best practices...`);
      
      const answererPrompt = `The following PRD is being developed:\n\n${genResult.content}\n\nAnswer the questions with best practices.`;
      
      const answerResult = await client.callWithFallback(
        'reviewer',  // Using reviewer model for answerer role
        BEST_PRACTICE_ANSWERER_PROMPT + langInstruction,
        answererPrompt,
        4000  // Enough for detailed answers
      );
      
      modelsUsed.add(answerResult.model);
      console.log(`✅ Answered with ${answerResult.usage.completion_tokens} tokens using ${answerResult.model}`);
      
      // Step 3: Merge answers into PRD
      const mergedPRD = this.mergePRDWithAnswers(genResult.content, answerResult.content);
      currentPRD = mergedPRD;
      
      iterations.push({
        iterationNumber: i,
        generatorOutput: genResult.content,
        answererOutput: answerResult.content,
        questions,
        mergedPRD,
        tokensUsed: genResult.usage.total_tokens + answerResult.usage.total_tokens
      });
    }
    
    let finalReview: IterativeResponse['finalReview'] = undefined;
    
    // Optional: Final Review with AI #3
    if (useFinalReview) {
      console.log('\n🎯 AI #3: Final review and polish...');
      
      const finalReviewerPrompt = `Review the following PRD at the highest level:\n\n${currentPRD}`;
      
      const reviewResult = await client.callWithFallback(
        'reviewer',
        FINAL_REVIEWER_PROMPT + langInstruction,
        finalReviewerPrompt,
        6000  // Enough for comprehensive review
      );
      
      modelsUsed.add(reviewResult.model);
      console.log(`✅ Final review complete with ${reviewResult.usage.completion_tokens} tokens`);
      
      finalReview = {
        content: reviewResult.content,
        model: reviewResult.model,
        usage: reviewResult.usage,
        tier: reviewResult.tier
      };
      
      // Apply final polish if review suggests improvements
      currentPRD = this.applyFinalReview(currentPRD, reviewResult.content);
    }
    
    // Calculate totals
    const totalTokens = iterations.reduce((sum, iter) => sum + iter.tokensUsed, 0) +
      (finalReview?.usage.total_tokens || 0);
    
    console.log(`\n✅ Iterative workflow complete! Total tokens: ${totalTokens}`);
    
    return {
      finalContent: currentPRD,
      iterations,
      finalReview,
      totalTokens,
      modelsUsed: Array.from(modelsUsed)
    };
  }

  private extractQuestionsFromIterativeOutput(generatorOutput: string): string[] {
    const questions: string[] = [];
    
    // Look for "Fragen zur Verbesserung" section
    const questionSectionMatch = generatorOutput.match(/## Fragen zur Verbesserung([\s\S]*?)(?=##|$)/i);
    
    if (questionSectionMatch) {
      const questionSection = questionSectionMatch[1];
      const lines = questionSection.split('\n');
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.match(/^\d+\.\s+/) && trimmed.includes('?')) {
          const question = trimmed.replace(/^\d+\.\s+/, '').trim();
          if (question.length > 10) {
            questions.push(question);
          }
        }
      }
    }
    
    return questions;
  }

  private mergePRDWithAnswers(generatorOutput: string, answererOutput: string): string {
    // Extract the "Überarbeitetes PRD" section from generator output
    const prdMatch = generatorOutput.match(/## Überarbeitetes PRD([\s\S]*?)(?=## Offene Punkte|## Fragen|$)/i);
    let prdContent = prdMatch ? prdMatch[1].trim() : generatorOutput;
    
    // Append answerer insights as a new section
    const mergedContent = `${prdContent}\n\n---\n\n## Best Practice Empfehlungen (Iteration)\n\n${answererOutput}`;
    
    return mergedContent;
  }

  private extractVisionFromContent(content: string): string {
    const visionPatterns = [
      /##\s*(?:1\.\s*)?System Vision\s*\n([\s\S]*?)(?=\n##\s)/i,
      /##\s*(?:1\.\s*)?Executive Summary\s*\n([\s\S]*?)(?=\n##\s)/i,
      /##\s*Vision\s*\n([\s\S]*?)(?=\n##\s)/i,
    ];

    for (const pattern of visionPatterns) {
      const match = content.match(pattern);
      if (match && match[1]?.trim().length > 20) {
        return match[1].trim();
      }
    }

    const firstParagraphs = content.split('\n').filter(l => l.trim().length > 0).slice(0, 5).join('\n');
    return firstParagraphs || content.substring(0, 500);
  }

  private applyFinalReview(currentPRD: string, reviewContent: string): string {
    // For now, append review as final section
    // In future iterations, could use another AI call to actually apply the suggestions
    return `${currentPRD}\n\n---\n\n## Final Review Feedback\n\n${reviewContent}`;
  }

  private async createClientWithUserPreferences(userId?: string): Promise<{ client: OpenRouterClient; contentLanguage: string | null }> {
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
        // Get content language preference
        contentLanguage = userPrefs[0].defaultContentLanguage || null;
        
        // Get AI model preferences
        if (userPrefs[0].aiPreferences) {
          const prefs = userPrefs[0].aiPreferences as any;
          if (prefs.generatorModel) {
            client.setPreferredModel('generator', prefs.generatorModel);
          }
          if (prefs.reviewerModel) {
            client.setPreferredModel('reviewer', prefs.reviewerModel);
          }
          if (prefs.fallbackModel) {
            client.setPreferredModel('fallback', prefs.fallbackModel);
          }
          if (prefs.tier) {
            client.setPreferredTier(prefs.tier);
          }
        }
      }
    }

    return { client, contentLanguage };
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
