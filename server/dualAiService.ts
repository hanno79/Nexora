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
  type IterationData,
  type CompilerDiagnostics
} from './dualAiPrompts';
import { generateFeatureList } from './services/llm/generateFeatureList';
import { expandAllFeatures, expandFeature } from './services/llm/expandFeature';
import { parsePRDToStructure, logStructureValidation } from './prdParser';
import { compareStructures, logStructuralDrift, restoreRemovedFeatures } from './prdStructureDiff';
import { assembleStructureToMarkdown } from './prdAssembler';
import { enforceFeatureIntegrity, type IntegrityRestoration } from './prdFeatureValidator';
import { detectTargetSection, regenerateSection } from './prdSectionRegenerator';
import { regenerateSectionAsJson } from './prdSectionJsonRegenerator';
import type { PRDStructure, FeatureSpec } from './prdStructure';
import { db } from './db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';

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
    const workflowInputText = additionalRequirements || existingContent || '';
    const modelsUsed = new Set<string>();
    let previousStructure: PRDStructure | null = null;
    let freezeBaselineStructure: PRDStructure | null = null;
    const allDriftWarnings: Map<number, string[]> = new Map();
    const allPreservationActions: Map<number, string[]> = new Map();
    const allIntegrityRestorations: Map<number, IntegrityRestoration[]> = new Map();
    const allSectionRegens: Map<number, { section: string; feedbackSnippet: string; mode?: 'json' | 'markdown' }> = new Map();
    
    const diagnostics: CompilerDiagnostics = {
      structuredFeatureCount: 0,
      totalFeatureCount: 0,
      jsonSectionUpdates: 0,
      markdownSectionRegens: 0,
      fullRegenerations: 0,
      featurePreservations: 0,
      featureIntegrityRestores: 0,
      driftEvents: 0,
      featureFreezeActive: false,
      blockedRegenerationAttempts: 0,
      freezeSeedSource: 'none',
    };

    // Feature Freeze Engine - State Variables
    let featuresFrozen = false;
    let freezeActivated = false;
    let blockedRegenerationAttempts = 0;
    console.log("❄️ Feature Freeze Engine initialisiert (wartet auf erste Kompilierung)");

    // Improvement mode: use existing parsed features as authoritative baseline.
    // This prevents first-iteration collapse from redefining the freeze base.
    if (isImprovement && trimmedContent.length > 0) {
      try {
        const baselineStructure = parsePRDToStructure(existingContent);
        if (baselineStructure.features.length > 0) {
          previousStructure = baselineStructure;
          freezeBaselineStructure = baselineStructure;
          featuresFrozen = true;
          freezeActivated = true;
          diagnostics.freezeSeedSource = 'existingContent';
          console.log("🧊 FEATURE CATALOGUE FROZEN – Baseline loaded from existing content");
          console.log("   " + baselineStructure.features.length + " baseline feature(s) locked");
        }
      } catch (baselineParseError: any) {
        console.warn("⚠️ Failed to parse improvement baseline for freeze seeding:", baselineParseError.message);
      }
    }

    // Iterative Q&A Loop
    for (let i = 1; i <= iterationCount; i++) {
      console.log(`\n📝 Iteration ${i}/${iterationCount}`);
      const previousIteration = iterations[iterations.length - 1];
      
      // Step 1: AI #1 (Generator) - Creates PRD draft + asks questions
      // Try section-level regeneration first (iterations >= 2 only)
      let genResult: { content: string; usage: any; model: string; tier: string; usedFallback: boolean } | null = null;

      if (i >= 2 && previousStructure) {
        try {
          const feedbackText = previousIteration.answererOutput;
          let targetSection = detectTargetSection(feedbackText, {
            allowFeatureContext: featuresFrozen
          });
          if (!targetSection && featuresFrozen) {
            targetSection = this.pickFallbackPatchSection(previousStructure);
            if (targetSection) {
              console.log(`🎯 Iteration ${i}: Freeze fallback patch section selected: "${String(targetSection)}"`);
            }
          }

          if (targetSection && typeof previousStructure[targetSection] === 'string') {
            console.log(`🎯 Iteration ${i}: JSON Mode Triggered for Section: "${String(targetSection)}"`);
            const visionContext = previousStructure.systemVision || '';

            let regenContent: string | null = null;
            let usedJsonMode = false;
            const strictMode = process.env.STRICT_JSON_MODE === 'true';

            try {
              const jsonResult = await regenerateSectionAsJson(
                targetSection,
                previousStructure,
                feedbackText,
                visionContext,
                client,
                langInstruction
              );
              regenContent = jsonResult.updatedContent;
              usedJsonMode = true;
              diagnostics.jsonSectionUpdates++;
              console.log(`✅ Iteration ${i}: JSON structured section update succeeded for "${String(targetSection)}"`);
            } catch (jsonError: any) {
              console.warn(`⚠️ Iteration ${i}: JSON Mode failed. Falling back to Markdown Section Regeneration. Error: ${jsonError.message}`);
              if (strictMode) {
                console.error(`🚨 STRICT MODE: JSON failed while section "${String(targetSection)}" was detected. Diagnostic flag raised.`);
                diagnostics.driftEvents++;
              }
            }

            if (!regenContent) {
              regenContent = await regenerateSection(
                targetSection,
                previousStructure,
                feedbackText,
                visionContext,
                client,
                langInstruction
              );
              diagnostics.markdownSectionRegens++;
              console.log(`✅ Iteration ${i}: Markdown section regeneration complete for "${String(targetSection)}"`);
            }

            const updatedStructure = { ...previousStructure, features: [...previousStructure.features] };
            (updatedStructure as any)[targetSection] = regenContent;
            const rebuiltMarkdown = assembleStructureToMarkdown(updatedStructure);

            genResult = {
              content: rebuiltMarkdown,
              usage: { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 },
              model: usedJsonMode ? 'json-section-regen' : 'section-regen',
              tier: 'section',
              usedFallback: false
            };
            allSectionRegens.set(i, {
              section: targetSection,
              feedbackSnippet: feedbackText.substring(0, 150),
              mode: usedJsonMode ? 'json' : 'markdown'
            });
            console.log(`✅ Iteration ${i}: Section-level regeneration complete for "${targetSection}" (mode: ${usedJsonMode ? 'json' : 'markdown'})`);
          }
        } catch (sectionRegenError: any) {
          // FEATURE FREEZE: Block full regeneration when frozen
          if (featuresFrozen) {
            console.warn('🚫 FULL REGENERATION BLOCKED (freeze active)');
            console.warn('   Section-level regen failed: ' + sectionRegenError.message);
            console.warn('   Using previous iteration instead');
            const prevIteration = iterations[iterations.length - 1];
            if (prevIteration) {
              genResult = {
                content: prevIteration.mergedPRD,
                usage: { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 },
                model: 'frozen-prev-iteration',
                tier: 'fallback',
                usedFallback: true
              };
            }
          } else {
            console.error(`🚨 Iteration ${i}: Section-level regeneration failed. Falling back to FULL regeneration. Error: ${sectionRegenError.message}`);
            genResult = null;
          }
        }
      }

      if (!genResult) {
        if (featuresFrozen && i >= 2) {
          console.warn('🚫 FULL REGENERATION BLOCKED (freeze patch mode)');
          const prevIteration = iterations[iterations.length - 1];
          if (prevIteration) {
            blockedRegenerationAttempts++;
            genResult = {
              content: prevIteration.mergedPRD,
              usage: { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 },
              model: 'freeze-patch-fallback',
              tier: 'fallback',
              usedFallback: true
            };
            console.log(`✅ Iteration ${i}: Reused previous PRD because no safe patch target was available`);
          }
        }
      }

      if (!genResult) {
        diagnostics.fullRegenerations++;
        console.log(`🤖 AI #1: Generating PRD draft and identifying gaps...`);
        
        let generatorPrompt: string;
        
        if (i === 1) {
          if (isImprovement) {
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
            generatorPrompt = `INITIAL INPUT:\n${additionalRequirements || existingContent}\n\nCreate an initial PRD draft and ask questions about open points.`;
          }
        } else {
          // FEATURE FREEZE: Add freeze rules to prompt when frozen and iteration >= 2
          let freezeRule = '';
          if (featuresFrozen && i >= 2) {
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
- Add new features using NEW sequential F-XX IDs (e.g., F-03, F-04 if F-01 and F-02 exist)
- Extend non-feature sections
- Improve descriptive content outside compiled features

If you modify or remove existing features, your output will be discarded.
=== END CRITICAL RULE ===
`;
            console.log('🔒 Feature Freeze Rule added to generator prompt');
          }

          generatorPrompt = `CURRENT PRD (DO NOT DISCARD - BUILD UPON IT):
${currentPRD}

ANSWERS FROM PREVIOUS ITERATION (MUST be incorporated into the PRD):
${previousIteration.answererOutput}

Your task:
1. PRESERVE all existing sections and content
2. INCORPORATE all answers from the previous iteration directly into the appropriate PRD sections — do NOT leave them as separate Q&A
3. RESOLVE any Open Points or Gaps by using the expert answers — the information must become part of the PRD content
4. EXPAND sections that are still incomplete
5. Ask questions about remaining gaps only (do NOT repeat already-answered questions)
6. The final PRD must be self-contained — a reader should find all information IN the document, not in a separate Q&A section`
        }
        
        genResult = await client.callWithFallback(
          'generator',
          ITERATIVE_GENERATOR_PROMPT + langInstruction,
          generatorPrompt,
          8000
        );
        
        modelsUsed.add(genResult.model);
        console.log(`✅ Generated ${genResult.usage.completion_tokens} tokens with ${genResult.model}`);
      }

      if (featuresFrozen && i >= 2) {
        const deltaSection = await this.generateStructuredDeltaSection({
          currentPrd: currentPRD,
          generatorOutput: genResult.content,
          reviewerFeedback: previousIteration?.answererOutput || '',
          client,
          langInstruction
        });
        if (deltaSection && !/##\s*Feature Delta(?:\s*\(JSON\))?/i.test(genResult.content)) {
          genResult.content = `${genResult.content.trim()}\n\n---\n\n${deltaSection}`;
          console.log(`🧩 Iteration ${i}: Structured Feature Delta appended via delta-only pass`);
        }
      }
      
      // Feature Identification Layer + Expansion Engine (first iteration only)
      let expansionResult: any = null;
      if (i === 1) {
        try {
          console.log('🧩 Feature Identification Layer (iterative): Extracting atomic features...');
          const vision = this.extractVisionFromContent(genResult.content);
          const featureResult = await generateFeatureList(workflowInputText, vision, client);
          console.log(`🧩 Feature List (model: ${featureResult.model}, retried: ${featureResult.retried}):`);
          console.log(featureResult.featureList);

          // Feature Expansion Engine (modular, parallel to monolithic PRD — testing phase)
          try {
            console.log('🏗️ Feature Expansion Engine (iterative): Starting modular expansion...');
            expansionResult = await expandAllFeatures(workflowInputText, vision, featureResult.featureList, client);
            console.log(`🏗️ Feature Expansion complete: ${expansionResult.expandedFeatures.length} features, ${expansionResult.totalTokens} tokens`);

            // FEATURE FREEZE: Activate freeze after first successful compilation
            if (expansionResult && expansionResult.expandedFeatures.length > 0) {
              const compiledCount = expansionResult.expandedFeatures.filter(
                (f: any) => f.compiled === true || f.valid === true
              ).length;
              const expansionBaseline = this.buildFreezeBaselineFromExpansion(expansionResult, previousStructure);
              if (expansionBaseline) {
                freezeBaselineStructure = expansionBaseline;
              }
              if (compiledCount > 0 && !freezeActivated) {
                featuresFrozen = true;
                freezeActivated = true;
                diagnostics.freezeSeedSource = 'compiledExpansion';
                console.log('🧊 FEATURE CATALOGUE FROZEN – First compilation detected');
                console.log('   ' + compiledCount + ' feature(s) in compiled state');
                if (freezeBaselineStructure?.features.length) {
                  console.log('   Baseline catalogue size: ' + freezeBaselineStructure.features.length);
                }
                console.log('   Full regeneration will be blocked from next iteration');
              }
            }
          } catch (expansionError: any) {
            console.warn('⚠️ Feature Expansion Engine failed (non-blocking):', expansionError.message);
          }
        } catch (error: any) {
          console.warn('⚠️ Feature Identification Layer failed (non-blocking):', error.message);
        }
      }

      let structuredDeltaResult = this.extractStructuredFeatureDeltaWithStatus(genResult.content);
      if (featuresFrozen && i >= 2 && !structuredDeltaResult.valid) {
        blockedRegenerationAttempts++;
        console.warn('🚫 STRICT DELTA JSON REQUIRED (iteration >= 2, freeze active)');
        console.warn(`   Invalid or missing Feature Delta JSON: ${structuredDeltaResult.error || 'not found'}`);
        const prevIteration = iterations[iterations.length - 1];
        if (prevIteration) {
          genResult = {
            content: `${prevIteration.mergedPRD}\n\n${this.buildEmptyFeatureDeltaSection()}`,
            usage: { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 },
            model: 'strict-delta-fallback',
            tier: 'fallback',
            usedFallback: true
          };
          structuredDeltaResult = this.extractStructuredFeatureDeltaWithStatus(genResult.content);
        }
      }

      const provisionalCleanPRD = this.extractCleanPRD(genResult.content);

      // Extract questions from generator output (robust) and synthesize fallback questions if needed
      let questions = this.extractQuestionsFromIterativeOutput(genResult.content);
      if (questions.length < 3 && i < iterationCount) {
        const fallbackQuestions = await this.generateClarifyingQuestions(
          provisionalCleanPRD,
          client,
          langInstruction,
          3
        );
        questions = this.mergeQuestions(questions, fallbackQuestions);
        if (fallbackQuestions.length > 0) {
          console.log(`🧭 Synthesized ${fallbackQuestions.length} fallback clarifying question(s)`);
        }
      }
      console.log(`📋 Extracted ${questions.length} questions`);
      
      // Step 2: AI #2 (Answerer) - Answers with best practices
      console.log(`🧠 AI #2: Answering questions with best practices...`);
      
      const explicitQuestionBlock = questions.length > 0
        ? questions.map((q, idx) => `${idx + 1}. ${q}`).join('\n')
        : '1. Identify the top unresolved product scope risk.\n2. Identify the top unresolved UX risk.\n3. Identify the top unresolved data/operational risk.';
      const answererPrompt = `The following PRD is being developed:\n\n${genResult.content}\n\nQuestions to answer explicitly:\n${explicitQuestionBlock}\n\nAnswer ALL questions with best practices. Also identify and resolve any Open Points, Gaps, or unresolved areas in the PRD. Your answers will be incorporated directly into the next PRD revision.`;
      
      const answerResult = await client.callWithFallback(
        'reviewer',  // Using reviewer model for answerer role
        BEST_PRACTICE_ANSWERER_PROMPT + langInstruction,
        answererPrompt,
        4000  // Enough for detailed answers
      );
      
      modelsUsed.add(answerResult.model);
      console.log(`✅ Answered with ${answerResult.usage.completion_tokens} tokens using ${answerResult.model}`);
      
      // Step 3: Extract clean PRD (without Q&A sections) and build iteration log
      const cleanPRD = provisionalCleanPRD;
      const structuredDelta = structuredDeltaResult.delta;

      // FEATURE FREEZE: Validate no feature loss when frozen
      if (featuresFrozen && freezeBaselineStructure) {
        const previousIds = freezeBaselineStructure.features.map(f => f.id);
        let newStructureForCheck = parsePRDToStructure(cleanPRD);
        const freezeWriteProjectionActive = !!freezeBaselineStructure;
        if (freezeWriteProjectionActive) {
          newStructureForCheck = {
            ...newStructureForCheck,
            features: freezeBaselineStructure.features.map(f => ({ ...f })),
          };
        }
        const newIds = newStructureForCheck.features.map(f => f.id);

        const lostFeature = previousIds.some(id => !newIds.includes(id));

        if (lostFeature) {
          console.warn('❌ FEATURE LOSS DETECTED WHILE FROZEN');
          console.warn('   Baseline features: ' + previousIds.join(', '));
          console.warn('   New features: ' + newIds.join(', '));
          console.warn('   Regeneration attempt marked; baseline restoration will be enforced');
          blockedRegenerationAttempts++;
        }

        if (newStructureForCheck.features.length < freezeBaselineStructure.features.length) {
          console.warn('❌ FEATURE COUNT DECREASED WHILE FROZEN');
          console.warn('   Baseline: ' + freezeBaselineStructure.features.length + ' features');
          console.warn('   New: ' + newStructureForCheck.features.length + ' features');
          console.warn('   Regeneration attempt marked; baseline restoration will be enforced');
          blockedRegenerationAttempts++;
        }
      }

      // Structural drift detection + feature preservation (non-blocking)
      let preservedPRD = cleanPRD;
      let candidateStructure: PRDStructure | null = null;
      try {
        let currentStructure = parsePRDToStructure(cleanPRD);
        let forceReassembleFromStructure = false;
        const featureWriteLockActive = featuresFrozen && !!freezeBaselineStructure;

        if (featureWriteLockActive && freezeBaselineStructure) {
          currentStructure = {
            ...currentStructure,
            features: freezeBaselineStructure.features.map(f => ({ ...f })),
          };
          forceReassembleFromStructure = true;
          console.log(`🔐 Iteration ${i}: Feature write-lock active (direct F-XX rewrites ignored)`);
        }

        if (previousStructure) {
          const diff = compareStructures(previousStructure, currentStructure);
          const warnings = logStructuralDrift(i, diff);
          if (warnings.length > 0) {
            allDriftWarnings.set(i, warnings);
            diagnostics.driftEvents += warnings.length;
          }

          if (!featureWriteLockActive && diff.removedFeatures.length > 0) {
            console.log(`🔧 Iteration ${i}: Restoring ${diff.removedFeatures.length} lost feature(s)...`);
            currentStructure = restoreRemovedFeatures(previousStructure, currentStructure, diff.removedFeatures);
            preservedPRD = assembleStructureToMarkdown(currentStructure);
            forceReassembleFromStructure = true;
            allPreservationActions.set(i, [...diff.removedFeatures]);
            diagnostics.featurePreservations += diff.removedFeatures.length;
            console.log(`✅ Iteration ${i}: Feature preservation complete, PRD reassembled`);
          }

          if (!featureWriteLockActive) {
            try {
            const integrityResult = enforceFeatureIntegrity(previousStructure, currentStructure);
            currentStructure = integrityResult.structure;
            if (integrityResult.restorations.length > 0) {
              preservedPRD = assembleStructureToMarkdown(currentStructure);
              forceReassembleFromStructure = true;
              allIntegrityRestorations.set(i, integrityResult.restorations);
              diagnostics.featureIntegrityRestores += integrityResult.restorations.length;
              console.log(`🛡️ Iteration ${i}: Feature integrity enforced, ${integrityResult.restorations.length} feature(s) restored`);
            }
            } catch (integrityError: any) {
              console.warn(`⚠️ Feature integrity check failed for iteration ${i} (non-blocking):`, integrityError.message);
            }
          }
        } else {
          logStructureValidation(currentStructure);
        }

        // Enforce frozen catalogue baseline independently of iterative drift context.
        if (featuresFrozen && freezeBaselineStructure) {
          const freezeDiff = compareStructures(freezeBaselineStructure, currentStructure);
          if (!featureWriteLockActive && freezeDiff.removedFeatures.length > 0) {
            console.log(`🔒 Freeze baseline restore: ${freezeDiff.removedFeatures.length} feature(s)`);
            currentStructure = restoreRemovedFeatures(freezeBaselineStructure, currentStructure, freezeDiff.removedFeatures);
            preservedPRD = assembleStructureToMarkdown(currentStructure);
            forceReassembleFromStructure = true;
            const existing = allPreservationActions.get(i) || [];
            allPreservationActions.set(
              i,
              Array.from(new Set([...existing, ...freezeDiff.removedFeatures]))
            );
            diagnostics.featurePreservations += freezeDiff.removedFeatures.length;
          }

          if (!featureWriteLockActive) {
            const freezeIntegrity = enforceFeatureIntegrity(freezeBaselineStructure, currentStructure);
            currentStructure = freezeIntegrity.structure;
            if (freezeIntegrity.restorations.length > 0) {
              preservedPRD = assembleStructureToMarkdown(currentStructure);
              forceReassembleFromStructure = true;
              const existing = allIntegrityRestorations.get(i) || [];
              allIntegrityRestorations.set(i, [...existing, ...freezeIntegrity.restorations]);
              diagnostics.featureIntegrityRestores += freezeIntegrity.restorations.length;
              console.log(`🛡️ Freeze baseline integrity enforced, ${freezeIntegrity.restorations.length} feature(s) restored`);
            }
          }

          // Delta compiler: process only truly new features, block duplicates.
          const deltaResult = await this.compileFeatureDelta({
            currentStructure,
            freezeBaseline: freezeBaselineStructure,
            visionContext: this.extractVisionFromContent(currentPRD || cleanPRD),
            workflowInputText,
            structuredDelta,
            enforceStructuredDeltaOnly: featuresFrozen && i >= 2,
            client
          });
          currentStructure = deltaResult.structure;
          freezeBaselineStructure = deltaResult.freezeBaseline;
          if (deltaResult.addedFeatureIds.length > 0) {
            console.log(`🆕 Iteration ${i}: New feature delta compiled (${deltaResult.addedFeatureIds.join(', ')})`);
            preservedPRD = assembleStructureToMarkdown(currentStructure);
            forceReassembleFromStructure = true;
          }
          if (deltaResult.droppedDuplicates.length > 0) {
            console.log(`🧹 Iteration ${i}: Dropped duplicate feature candidates (${deltaResult.droppedDuplicates.join(', ')})`);
            preservedPRD = assembleStructureToMarkdown(currentStructure);
            forceReassembleFromStructure = true;
          }
        }

        if (forceReassembleFromStructure) {
          preservedPRD = assembleStructureToMarkdown(currentStructure);
        }

        candidateStructure = currentStructure;
      } catch (preserveError: any) {
        console.warn(`⚠️ Feature preservation failed for iteration ${i} (non-blocking, using cleanPRD):`, preserveError.message);
        preservedPRD = cleanPRD;
      }

      // Hard acceptance gates: reject unsafe iteration outputs and keep last stable state.
      if (!candidateStructure) {
        try {
          candidateStructure = parsePRDToStructure(preservedPRD);
        } catch (parseGateError: any) {
          console.warn(`⚠️ Iteration ${i}: Gate parse failed: ${parseGateError.message}`);
        }
      }

      const gateResult = this.validateIterationAcceptance({
        structure: candidateStructure,
        freezeBaseline: freezeBaselineStructure,
        featuresFrozen,
        iterationNumber: i,
        structuredDeltaResult,
      });

      if (!gateResult.accepted) {
        console.warn(`🚫 Iteration ${i}: Rejected by acceptance gates`);
        for (const reason of gateResult.reasons) {
          console.warn(`   - ${reason}`);
        }

        const prevIteration = iterations[iterations.length - 1];
        if (prevIteration) {
          blockedRegenerationAttempts++;
          preservedPRD = prevIteration.mergedPRD;
          try {
            candidateStructure = parsePRDToStructure(preservedPRD);
          } catch {
            candidateStructure = previousStructure;
          }
        }
      }

      if (candidateStructure) {
        previousStructure = candidateStructure;
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
    const iterationLog = this.buildIterationLog(iterations, finalReview, allDriftWarnings, allPreservationActions, allIntegrityRestorations, allSectionRegens);
    
    // Calculate totals
    const totalTokens = iterations.reduce((sum, iter) => sum + iter.tokensUsed, 0) +
      (finalReview?.usage.total_tokens || 0);
    
    console.log(`\n✅ Iterative workflow complete! Total tokens: ${totalTokens}`);

    // Structured PRD representation (read-only, logging only)
    try {
      const structured = parsePRDToStructure(currentPRD);
      logStructureValidation(structured);
      diagnostics.totalFeatureCount = structured.features.length;
      diagnostics.structuredFeatureCount = structured.features.filter(f =>
        f.purpose || f.actors || f.mainFlow || f.acceptanceCriteria
      ).length;
    } catch (parseError: any) {
      console.warn('⚠️ PRD structure parsing failed (non-blocking):', parseError.message);
    }

    // FEATURE FREEZE: Set final diagnostic values
    diagnostics.featureFreezeActive = featuresFrozen;
    diagnostics.blockedRegenerationAttempts = blockedRegenerationAttempts;

    // FEATURE FREEZE: Final summary logging
    console.log('\n📊 Feature Freeze Engine Summary:');
    console.log('   Freeze Active: ' + featuresFrozen);
    console.log('   Blocked Attempts: ' + blockedRegenerationAttempts);
    console.log('   Final Feature Count: ' + (previousStructure?.features.length || 0));

    return {
      finalContent: currentPRD,
      iterationLog,
      iterations,
      finalReview,
      totalTokens,
      modelsUsed: Array.from(modelsUsed),
      diagnostics
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
      if (idSeen.has(feature.id)) {
        reasons.push(`duplicate feature id detected: ${feature.id}`);
      } else {
        idSeen.add(feature.id);
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

      const currentIds = new Set(structure.features.map(f => f.id));
      for (const frozenFeature of freezeBaseline.features) {
        if (!currentIds.has(frozenFeature.id)) {
          reasons.push(`frozen feature missing: ${frozenFeature.id}`);
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
    minCount: number
  ): Promise<string[]> {
    try {
      const prompt = `Review this PRD and generate ${minCount} to 5 concrete clarifying questions about unresolved scope, UX, and operational gaps.\n\nReturn ONLY numbered questions.\n\nPRD:\n${prdContent}`;
      const result = await client.callWithFallback(
        'reviewer',
        REVIEWER_SYSTEM_PROMPT + langInstruction,
        prompt,
        1500
      );
      const lines = result.content.split('\n').map(l => l.trim()).filter(Boolean);
      const parsed: string[] = [];
      for (const line of lines) {
        const question = this.normalizeQuestionLine(line);
        if (question) parsed.push(question);
      }
      return this.mergeQuestions([], parsed).slice(0, Math.max(3, minCount));
    } catch (error: any) {
      console.warn(`⚠️ Fallback question synthesis failed: ${error.message}`);
      return [];
    }
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

  private pickFallbackPatchSection(structure: PRDStructure): keyof PRDStructure | null {
    const orderedCandidates: (keyof PRDStructure)[] = [
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
    client: OpenRouterClient;
  }): Promise<{
    structure: PRDStructure;
    freezeBaseline: PRDStructure;
    addedFeatureIds: string[];
    droppedDuplicates: string[];
  }> {
    const {
      currentStructure,
      freezeBaseline,
      visionContext,
      workflowInputText,
      structuredDelta,
      enforceStructuredDeltaOnly,
      client
    } = params;
    const baselineIds = new Set(freezeBaseline.features.map(f => f.id));
    const baselineFeatures = freezeBaseline.features.map(f => ({ ...f }));
    const currentAdditions = currentStructure.features.filter(f => !baselineIds.has(f.id));
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
      };
    }

    const dedupeResult = this.filterDuplicateNewFeatures(candidatePool, baselineFeatures);
    const droppedDuplicates = dedupeResult.dropped.map(f => `${f.id}:${f.name}`);
    const acceptedCandidates = dedupeResult.accepted;

    const compiledNewFeatures: FeatureSpec[] = [];
    const usedIds = new Set(currentStructure.features.map(f => f.id));
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
          client
        );
        compiledRaw = expansion.content || candidate.rawContent;
      } catch (deltaCompileError: any) {
        console.warn(`⚠️ Delta compile failed for ${candidate.id} (${candidate.name}): ${deltaCompileError.message}`);
      }

      compiledNewFeatures.push({
        id: resolvedId,
        name: candidate.name,
        rawContent: compiledRaw,
      });
    }

    const rebuiltFeatures = [
      ...currentStructure.features.filter(f => baselineIds.has(f.id)),
      ...compiledNewFeatures
    ];

    const mergedBaseline = {
      ...freezeBaseline,
      features: [
        ...freezeBaseline.features,
        ...compiledNewFeatures
      ]
    };
    mergedBaseline.features.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

    return {
      structure: { ...currentStructure, features: rebuiltFeatures },
      freezeBaseline: mergedBaseline,
      addedFeatureIds: compiledNewFeatures.map(f => f.id),
      droppedDuplicates,
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
      const shortDescription = String(entry?.shortDescription || '').trim();
      const id = String(entry?.featureId || '').trim().toUpperCase();
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
    if (a.id === b.id) return true;

    const aName = this.normalizeFeatureName(a.name);
    const bName = this.normalizeFeatureName(b.name);
    if (aName && bName && aName === bName) return true;
    if (aName && bName && (aName.includes(bName) || bName.includes(aName)) && Math.min(aName.length, bName.length) >= 8) {
      return true;
    }

    const aTokens = new Set(aName.split(' ').filter(Boolean));
    const bTokens = new Set(bName.split(' ').filter(Boolean));
    let intersection = 0;
    for (const token of Array.from(aTokens)) {
      if (bTokens.has(token)) intersection++;
    }
    const union = new Set(
      Array.from(aTokens).concat(Array.from(bTokens))
    ).size || 1;
    const similarity = intersection / union;
    if (similarity >= 0.8) return true;

    const aSig = this.normalizeFeatureName(a.rawContent).slice(0, 120);
    const bSig = this.normalizeFeatureName(b.rawContent).slice(0, 120);
    return aSig.length > 40 && aSig === bSig;
  }

  private normalizeFeatureName(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\b(feature|todo|item|app|webapp|system|module)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private nextAvailableFeatureId(preferredId: string, usedIds: Set<string>): string {
    if (preferredId && !usedIds.has(preferredId)) {
      return preferredId;
    }

    let maxNum = 0;
    for (const id of Array.from(usedIds)) {
      const match = id.match(/^F-(\d{2,})$/i);
      if (match) {
        maxNum = Math.max(maxNum, Number(match[1]));
      }
    }

    let candidateNum = maxNum + 1;
    while (true) {
      const candidate = `F-${String(candidateNum).padStart(2, '0')}`;
      if (!usedIds.has(candidate)) return candidate;
      candidateNum++;
    }
  }

  private deriveShortDescription(feature: FeatureSpec): string {
    const oneLine = feature.rawContent
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
    return oneLine || feature.name;
  }

  private async generateStructuredDeltaSection(params: {
    currentPrd: string;
    generatorOutput: string;
    reviewerFeedback: string;
    client: OpenRouterClient;
    langInstruction: string;
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
- Keep addedFeatures minimal and concrete`;

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
        1200
      );

      const parsed = this.parseLooseJsonObject(result.content);
      if (!parsed) return null;

      const addedRaw = Array.isArray(parsed.addedFeatures) ? parsed.addedFeatures : [];
      const updatedRaw = Array.isArray(parsed.updatedFeatures) ? parsed.updatedFeatures : [];
      const normalized = {
        addedFeatures: addedRaw
          .map((f: any) => ({
            featureId: typeof f?.featureId === 'string' ? f.featureId.trim().toUpperCase() : 'F-XX',
            name: String(f?.name || '').trim(),
            shortDescription: String(f?.shortDescription || '').trim(),
          }))
          .filter((f: any) => f.name.length > 0),
        updatedFeatures: updatedRaw
          .map((f: any) => ({
            featureId: String(f?.featureId || '').trim().toUpperCase(),
            notes: typeof f?.notes === 'string' ? f.notes.trim() : '',
          }))
          .filter((f: any) => /^F-\d{2,}$/i.test(f.featureId)),
      };

      const json = JSON.stringify(normalized, null, 2);
      return `## Feature Delta (JSON)\n\`\`\`json\n${json}\n\`\`\``;
    } catch (error: any) {
      console.warn(`⚠️ Delta-only extraction failed: ${error.message}`);
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
            featureId: typeof f?.featureId === 'string' ? f.featureId : undefined,
            name: String(f?.name || '').trim(),
            shortDescription: typeof f?.shortDescription === 'string' ? f.shortDescription : undefined,
          }))
          .filter((f: any) => f.name.length > 0),
        updatedFeatures: updated
          .map((f: any) => ({
            featureId: String(f?.featureId || '').trim().toUpperCase(),
            notes: typeof f?.notes === 'string' ? f.notes : undefined,
          }))
          .filter((f: any) => /^F-\d{2,}$/i.test(f.featureId)),
      };
      return { found: true, valid: true, delta };
    } catch (error: any) {
      console.warn(`⚠️ Structured feature delta parse failed: ${error.message}`);
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
      .map((f: any): FeatureSpec => ({
        id: String(f.featureId || '').trim().toUpperCase(),
        name: String(f.featureName || f.featureId || '').trim(),
        rawContent: String(f.content || '').trim(),
      }))
      .filter((f: FeatureSpec) => f.id.length > 0 && f.rawContent.length > 0);

    if (compiledFeatures.length === 0) {
      return null;
    }

    compiledFeatures.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

    return {
      systemVision: anchor?.systemVision,
      systemBoundaries: anchor?.systemBoundaries,
      domainModel: anchor?.domainModel,
      globalBusinessRules: anchor?.globalBusinessRules,
      featureCatalogueIntro: anchor?.featureCatalogueIntro,
      features: compiledFeatures,
      nonFunctional: anchor?.nonFunctional,
      errorHandling: anchor?.errorHandling,
      deployment: anchor?.deployment,
      definitionOfDone: anchor?.definitionOfDone,
      otherSections: anchor?.otherSections ? { ...anchor.otherSections } : {},
    };
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
