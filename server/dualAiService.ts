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
import { expandAllFeatures } from './services/llm/expandFeature';
import { parsePRDToStructure, logStructureValidation } from './prdParser';
import { compareStructures, logStructuralDrift, restoreRemovedFeatures } from './prdStructureDiff';
import { assembleStructureToMarkdown } from './prdAssembler';
import { enforceFeatureIntegrity, type IntegrityRestoration } from './prdFeatureValidator';
import type { PRDStructure } from './prdStructure';
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

        // Feature Expansion Engine (modular, parallel to monolithic PRD — testing phase)
        try {
          console.log('🏗️ Feature Expansion Engine: Starting modular expansion...');
          const expansionResult = await expandAllFeatures(userInput, vision, featureResult.featureList, client);
          console.log(`🏗️ Feature Expansion complete: ${expansionResult.expandedFeatures.length} features, ${expansionResult.totalTokens} tokens`);
        } catch (expansionError: any) {
          console.warn('⚠️ Feature Expansion Engine failed (non-blocking):', expansionError.message);
        }
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

    // Apply cleanup to strip any LLM preamble/meta-commentary from final output
    const rawFinalContent = improvedVersion?.content || generatorResponse.content;
    const cleanedFinalContent = this.extractCleanPRD(rawFinalContent);

    // Structured PRD representation (read-only, logging only)
    try {
      const structured = parsePRDToStructure(cleanedFinalContent);
      logStructureValidation(structured);
    } catch (parseError: any) {
      console.warn('⚠️ PRD structure parsing failed (non-blocking):', parseError.message);
    }

    return {
      finalContent: cleanedFinalContent,
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
    let previousStructure: PRDStructure | null = null;
    const allDriftWarnings: Map<number, string[]> = new Map();
    const allPreservationActions: Map<number, string[]> = new Map();
    const allIntegrityRestorations: Map<number, IntegrityRestoration[]> = new Map();
    
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
        // Subsequent iterations: Incorporate previous answers and resolve open points
        const prevIteration = iterations[iterations.length - 1];
        generatorPrompt = `CURRENT PRD (DO NOT DISCARD - BUILD UPON IT):
${currentPRD}

ANSWERS FROM PREVIOUS ITERATION (MUST be incorporated into the PRD):
${prevIteration.answererOutput}

Your task:
1. PRESERVE all existing sections and content
2. INCORPORATE all answers from the previous iteration directly into the appropriate PRD sections — do NOT leave them as separate Q&A
3. RESOLVE any Open Points or Gaps by using the expert answers — the information must become part of the PRD content
4. EXPAND sections that are still incomplete
5. Ask questions about remaining gaps only (do NOT repeat already-answered questions)
6. The final PRD must be self-contained — a reader should find all information IN the document, not in a separate Q&A section`
      }
      
      const genResult = await client.callWithFallback(
        'generator',
        ITERATIVE_GENERATOR_PROMPT + langInstruction,
        generatorPrompt,
        8000  // Enough for PRD + questions
      );
      
      modelsUsed.add(genResult.model);
      console.log(`✅ Generated ${genResult.usage.completion_tokens} tokens with ${genResult.model}`);
      
      // Feature Identification Layer + Expansion Engine (first iteration only)
      if (i === 1) {
        try {
          console.log('🧩 Feature Identification Layer (iterative): Extracting atomic features...');
          const vision = this.extractVisionFromContent(genResult.content);
          const inputText = additionalRequirements || existingContent || '';
          const featureResult = await generateFeatureList(inputText, vision, client);
          console.log(`🧩 Feature List (model: ${featureResult.model}, retried: ${featureResult.retried}):`);
          console.log(featureResult.featureList);

          // Feature Expansion Engine (modular, parallel to monolithic PRD — testing phase)
          try {
            console.log('🏗️ Feature Expansion Engine (iterative): Starting modular expansion...');
            const expansionResult = await expandAllFeatures(inputText, vision, featureResult.featureList, client);
            console.log(`🏗️ Feature Expansion complete: ${expansionResult.expandedFeatures.length} features, ${expansionResult.totalTokens} tokens`);
          } catch (expansionError: any) {
            console.warn('⚠️ Feature Expansion Engine failed (non-blocking):', expansionError.message);
          }
        } catch (error: any) {
          console.warn('⚠️ Feature Identification Layer failed (non-blocking):', error.message);
        }
      }

      // Extract questions from generator output
      const questions = this.extractQuestionsFromIterativeOutput(genResult.content);
      console.log(`📋 Extracted ${questions.length} questions`);
      
      // Step 2: AI #2 (Answerer) - Answers with best practices
      console.log(`🧠 AI #2: Answering questions with best practices...`);
      
      const answererPrompt = `The following PRD is being developed:\n\n${genResult.content}\n\nAnswer ALL questions with best practices. Also identify and resolve any Open Points, Gaps, or unresolved areas in the PRD. Your answers will be incorporated directly into the next PRD revision.`;
      
      const answerResult = await client.callWithFallback(
        'reviewer',  // Using reviewer model for answerer role
        BEST_PRACTICE_ANSWERER_PROMPT + langInstruction,
        answererPrompt,
        4000  // Enough for detailed answers
      );
      
      modelsUsed.add(answerResult.model);
      console.log(`✅ Answered with ${answerResult.usage.completion_tokens} tokens using ${answerResult.model}`);
      
      // Step 3: Extract clean PRD (without Q&A sections) and build iteration log
      const cleanPRD = this.extractCleanPRD(genResult.content);

      // Structural drift detection + feature preservation (non-blocking)
      let preservedPRD = cleanPRD;
      try {
        let currentStructure = parsePRDToStructure(cleanPRD);
        if (previousStructure) {
          const diff = compareStructures(previousStructure, currentStructure);
          const warnings = logStructuralDrift(i, diff);
          if (warnings.length > 0) {
            allDriftWarnings.set(i, warnings);
          }

          if (diff.removedFeatures.length > 0) {
            console.log(`🔧 Iteration ${i}: Restoring ${diff.removedFeatures.length} lost feature(s)...`);
            currentStructure = restoreRemovedFeatures(previousStructure, currentStructure, diff.removedFeatures);
            preservedPRD = assembleStructureToMarkdown(currentStructure);
            allPreservationActions.set(i, [...diff.removedFeatures]);
            console.log(`✅ Iteration ${i}: Feature preservation complete, PRD reassembled`);
          }

          try {
            const integrityResult = enforceFeatureIntegrity(previousStructure, currentStructure);
            currentStructure = integrityResult.structure;
            if (integrityResult.restorations.length > 0) {
              preservedPRD = assembleStructureToMarkdown(currentStructure);
              allIntegrityRestorations.set(i, integrityResult.restorations);
              console.log(`🛡️ Iteration ${i}: Feature integrity enforced, ${integrityResult.restorations.length} feature(s) restored`);
            }
          } catch (integrityError: any) {
            console.warn(`⚠️ Feature integrity check failed for iteration ${i} (non-blocking):`, integrityError.message);
          }
        } else {
          logStructureValidation(currentStructure);
        }
        previousStructure = currentStructure;
      } catch (preserveError: any) {
        console.warn(`⚠️ Feature preservation failed for iteration ${i} (non-blocking, using cleanPRD):`, preserveError.message);
        preservedPRD = cleanPRD;
      }

      currentPRD = preservedPRD;
      
      iterations.push({
        iterationNumber: i,
        generatorOutput: genResult.content,
        answererOutput: answerResult.content,
        questions,
        mergedPRD: preservedPRD,
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
        6000
      );
      
      modelsUsed.add(reviewResult.model);
      console.log(`✅ Final review complete with ${reviewResult.usage.completion_tokens} tokens`);
      
      finalReview = {
        content: reviewResult.content,
        model: reviewResult.model,
        usage: reviewResult.usage,
        tier: reviewResult.tier
      };
    }
    
    // Build iteration log document (separate from clean PRD)
    const iterationLog = this.buildIterationLog(iterations, finalReview, allDriftWarnings, allPreservationActions, allIntegrityRestorations);
    
    // Calculate totals
    const totalTokens = iterations.reduce((sum, iter) => sum + iter.tokensUsed, 0) +
      (finalReview?.usage.total_tokens || 0);
    
    console.log(`\n✅ Iterative workflow complete! Total tokens: ${totalTokens}`);

    // Structured PRD representation (read-only, logging only)
    try {
      const structured = parsePRDToStructure(currentPRD);
      logStructureValidation(structured);
    } catch (parseError: any) {
      console.warn('⚠️ PRD structure parsing failed (non-blocking):', parseError.message);
    }
    
    return {
      finalContent: currentPRD,
      iterationLog,
      iterations,
      finalReview,
      totalTokens,
      modelsUsed: Array.from(modelsUsed)
    };
  }

  private extractQuestionsFromIterativeOutput(generatorOutput: string): string[] {
    const questions: string[] = [];
    
    // Look for question sections in multiple languages
    const questionPatterns = [
      /## (?:Fragen zur Verbesserung|Questions for Improvement)([\s\S]*?)(?=##|$)/i,
      /## (?:Offene Fragen|Open Questions)([\s\S]*?)(?=##|$)/i,
    ];
    
    let questionSection: string | null = null;
    for (const pattern of questionPatterns) {
      const match = generatorOutput.match(pattern);
      if (match) {
        questionSection = match[1];
        break;
      }
    }
    
    if (questionSection) {
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
      /\n---\s*\n+## (?:Open Points|Offene Punkte)[\s\S]*/i,
      /\n---\s*\n+## Best Practice Empfehlungen[\s\S]*/i,
      /\n---\s*\n+## Final Review Feedback[\s\S]*/i,
      /\n## (?:Questions for Improvement|Fragen zur Verbesserung)[\s\S]*?(?=\n## (?!Questions|Fragen)|$)/i,
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

  private buildIterationLog(iterations: IterationData[], finalReview?: IterativeResponse['finalReview'], driftWarnings?: Map<number, string[]>, preservationActions?: Map<number, string[]>, integrityRestorations?: Map<number, IntegrityRestoration[]>): string {
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
