// Dual-AI Service - Orchestrates Generator & Reviewer based on HRP-17
import { getOpenRouterClient, MODEL_TIERS } from './openrouter';
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
import { countFeatureCompleteness, enforceFeatureIntegrity, type IntegrityRestoration } from './prdFeatureValidator';
import { detectTargetSection, regenerateSection } from './prdSectionRegenerator';
import { regenerateSectionAsJson } from './prdSectionJsonRegenerator';
import type { PRDStructure, FeatureSpec } from './prdStructure';
import { mergeExpansionIntoStructure } from './prdStructureMerger';
import { db } from './db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

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
    console.log(`🎯 Simple run models: generator=${client.getPreferredModel('generator') || '(tier default)'}, reviewer=${client.getPreferredModel('reviewer') || '(tier default)'}, fallback=${client.getPreferredModel('fallback') || '(none)'}`);
    
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
    let enrichedStructure: PRDStructure | undefined;
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

          // Merge expansion into structured representation for persistence
          if (expansionResult.expandedFeatures.length > 0) {
            try {
              const baseStructure = parsePRDToStructure(generatorResponse.content);
              enrichedStructure = mergeExpansionIntoStructure(baseStructure, expansionResult.expandedFeatures);
              console.log(`📦 Structure enriched: ${enrichedStructure.features.length} features with structured fields`);
            } catch (mergeError: any) {
              console.warn('⚠️ Structure merge failed (non-blocking):', mergeError.message);
            }
          }
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

    // Structured PRD representation - use enriched structure if available, else parse
    let finalStructuredContent: PRDStructure | undefined = enrichedStructure;
    try {
      if (!finalStructuredContent) {
        finalStructuredContent = parsePRDToStructure(cleanedFinalContent);
      }
      logStructureValidation(finalStructuredContent);
    } catch (parseError: any) {
      console.warn('⚠️ PRD structure parsing failed (non-blocking):', parseError.message);
    }

    return {
      finalContent: cleanedFinalContent,
      generatorResponse,
      reviewerResponse,
      improvedVersion,
      totalTokens,
      modelsUsed,
      structuredContent: finalStructuredContent
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
    userId?: string,
    onProgress?: (event: { type: string; [key: string]: any }) => void
  ): Promise<IterativeResponse> {
    // Create fresh client per request to prevent cross-user contamination
    const { client, contentLanguage } = await this.createClientWithUserPreferences(userId);
    const langInstruction = getLanguageInstruction(contentLanguage);
    
    // Use explicit mode from client - no heuristics needed
    const isImprovement = mode === 'improve';
    const trimmedContent = existingContent?.trim() || '';
    
    console.log(`🎯 Iterative run models: generator=${client.getPreferredModel('generator') || '(tier default)'}, reviewer=${client.getPreferredModel('reviewer') || '(tier default)'}, fallback=${client.getPreferredModel('fallback') || '(none)'}`);
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
    };

    // Feature Freeze Engine - State Variables
    let featuresFrozen = false;
    let freezeActivated = false;
    let blockedRegenerationAttempts = 0;
    let iterativeEnrichedStructure: PRDStructure | undefined;
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
      onProgress?.({ type: 'iteration_start', iteration: i, total: iterationCount });
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

          if (targetSection) {
            const currentSectionValue = previousStructure[targetSection];
            const hasSectionContent = typeof currentSectionValue === 'string' && currentSectionValue.trim().length > 0;
            if (!hasSectionContent) {
              console.log(`🧱 Iteration ${i}: Target section "${String(targetSection)}" is empty and will be initialized via section regeneration`);
            }
            console.log(`🎯 Iteration ${i}: JSON Mode Triggered for Section: "${String(targetSection)}"`);
            const visionContext = previousStructure.systemVision || '';

            let regenContent: string | null = null;
            let usedJsonMode = false;
            const strictMode = process.env.STRICT_JSON_MODE !== 'false'; // Default: true

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
              diagnostics.jsonRetryAttempts = (diagnostics.jsonRetryAttempts || 0) + (jsonResult.diagnostics?.retryAttempts || 1);
              diagnostics.jsonRepairSuccesses = (diagnostics.jsonRepairSuccesses || 0) + (jsonResult.diagnostics?.repairSuccesses || 0);
              console.log(`✅ Iteration ${i}: JSON structured section update succeeded for "${String(targetSection)}" (attempts: ${jsonResult.diagnostics?.retryAttempts || 1})`);
            } catch (jsonError: any) {
              const retryCount = (jsonError as any).retryCount || 1;
              diagnostics.jsonRetryAttempts = (diagnostics.jsonRetryAttempts || 0) + retryCount;
              console.warn(`⚠️ Iteration ${i}: JSON Mode failed after ${retryCount} attempts. Falling back to Markdown. Error: ${jsonError.message}`);
              if (strictMode) {
                console.error(`🚨 STRICT MODE: JSON failed for "${String(targetSection)}" after all retries. Diagnostic drift event raised.`);
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
            } else {
              const frozenFallbackContent = iterations[0]?.mergedPRD || currentPRD || '';
              if (!frozenFallbackContent) {
                console.warn(`⚠️ Iteration ${i}: freeze fallback content is empty (no previous mergedPRD/currentPRD available)`);
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
        onProgress?.({ type: 'generator_done', iteration: i, tokensUsed: genResult.usage.total_tokens, model: genResult.model });
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
        let firstIterationStructure: PRDStructure | null = null;
        try {
          firstIterationStructure = parsePRDToStructure(this.extractCleanPRD(genResult.content));
        } catch (firstIterationParseError: any) {
          console.warn('⚠️ Unable to parse first iteration PRD for freeze seeding:', firstIterationParseError.message);
        }
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
            onProgress?.({ type: 'features_expanded', count: expansionResult.expandedFeatures.length, tokensUsed: expansionResult.totalTokens });

            // FEATURE FREEZE: Activate freeze after first successful compilation
            if (expansionResult && expansionResult.expandedFeatures.length > 0) {
              const compiledCount = expansionResult.expandedFeatures.filter(
                (f: any) => f.compiled === true || f.valid === true
              ).length;
              const expansionBaseline = this.buildFreezeBaselineFromExpansion(
                expansionResult,
                firstIterationStructure || previousStructure
              );
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

            // Merge expansion into structured representation for persistence
            if (expansionResult.expandedFeatures.length > 0 && firstIterationStructure) {
              try {
                iterativeEnrichedStructure = mergeExpansionIntoStructure(firstIterationStructure, expansionResult.expandedFeatures);
                console.log(`📦 Iterative structure enriched: ${iterativeEnrichedStructure.features.length} features with structured fields`);
              } catch (mergeError: any) {
                console.warn('⚠️ Iterative structure merge failed (non-blocking):', mergeError.message);
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
      const requiredQuestions = i >= 2 ? 2 : (i < iterationCount ? 3 : 0);
      if (requiredQuestions > 0 && questions.length < requiredQuestions) {
        const fallbackQuestions = await this.generateClarifyingQuestions(
          provisionalCleanPRD,
          client,
          langInstruction,
          requiredQuestions
        );
        questions = this.mergeQuestions(questions, fallbackQuestions);
        if (fallbackQuestions.length > 0) {
          console.log(`🧭 Synthesized ${fallbackQuestions.length} fallback clarifying question(s)`);
        }
      }
      if (requiredQuestions > 0 && questions.length < requiredQuestions) {
        const deterministicFallback = this.getDeterministicFallbackQuestions(requiredQuestions);
        questions = this.mergeQuestions(questions, deterministicFallback);
        console.log(`🧩 Added deterministic fallback questions to meet minimum (${requiredQuestions})`);
      }
      if (requiredQuestions > 0 && questions.length > 5) {
        questions = questions.slice(0, 5);
      }
      console.log(`📋 Extracted ${questions.length} questions`);
      
      // Step 2: AI #2 (Answerer) - Answers with best practices
      console.log(`🧠 AI #2: Answering questions with best practices...`);
      
      const explicitQuestionBlock = questions.length > 0
        ? questions.map((q, idx) => `${idx + 1}. ${q}`).join('\n')
        : '1. Identify the top unresolved product scope risk.\n2. Identify the top unresolved UX risk.\n3. Identify the top unresolved data/operational risk.';
      const answererPrompt = `The following PRD is being developed:\n\n${genResult.content}\n\nQuestions to answer explicitly:\n${explicitQuestionBlock}\n\nAnswer ALL questions with best practices. Also identify and resolve any Open Points, Gaps, or unresolved areas in the PRD. Your answers will be incorporated directly into the next PRD revision.`;
      
      let answerResult = await client.callWithFallback(
        'reviewer',  // Using reviewer model for answerer role
        BEST_PRACTICE_ANSWERER_PROMPT + langInstruction,
        answererPrompt,
        5500  // Larger budget to reduce truncation risk
      );
      
      modelsUsed.add(answerResult.model);
      console.log(`✅ Answered with ${answerResult.usage.completion_tokens} tokens using ${answerResult.model}`);
      let answererOutputTruncated = this.looksLikeTruncatedOutput(answerResult.content);
      if (answererOutputTruncated) {
        console.warn(`⚠️ Iteration ${i}: answerer output looks truncated, retrying once with higher token budget...`);
        const retryPrompt = `${answererPrompt}\n\nIMPORTANT: Return a complete final response. Do not end mid-sentence or mid-list.`;
        const retryResult = await client.callWithFallback(
          'reviewer',
          BEST_PRACTICE_ANSWERER_PROMPT + langInstruction,
          retryPrompt,
          7000
        );
        modelsUsed.add(retryResult.model);
        const retryTruncated = this.looksLikeTruncatedOutput(retryResult.content);
        const shouldUseRetry = !retryTruncated || retryResult.content.length > answerResult.content.length + 120;
        if (shouldUseRetry) {
          answerResult = retryResult;
          answererOutputTruncated = retryTruncated;
          console.log(`✅ Iteration ${i}: using retried answerer output (${retryResult.model})`);
        } else {
          console.warn(`⚠️ Iteration ${i}: retry still appears truncated, keeping original output`);
        }
      }
      
      onProgress?.({ type: 'answerer_done', iteration: i, tokensUsed: answerResult.usage.total_tokens, model: answerResult.model });

      // Step 3: Extract clean PRD (without Q&A sections) and build iteration log
      const cleanPRD = provisionalCleanPRD;
      const structuredDelta = structuredDeltaResult.delta;

      const rollbackFrozenIteration = (reason: string): boolean => {
        const prevIteration = iterations[iterations.length - 1];
        if (!prevIteration) {
          console.warn(`⚠️ Iteration ${i}: ${reason}, but no previous iteration to roll back to.`);
          return false;
        }

        blockedRegenerationAttempts++;
        currentPRD = prevIteration.mergedPRD;
        console.warn(`🚫 Iteration ${i}: ${reason}`);
        console.warn('   Rolled back to previous merged PRD and continuing with next iteration');
        return true;
      };

      // FEATURE FREEZE: Validate no feature loss when frozen
      if (featuresFrozen && freezeBaselineStructure) {
        const previousIds = freezeBaselineStructure.features.map(f => f.id);
        let newStructureForCheck: PRDStructure;
        try {
          newStructureForCheck = parsePRDToStructure(cleanPRD);
        } catch (freezeParseError: any) {
          console.warn(`❌ Iteration ${i}: Freeze validation parse failed: ${freezeParseError.message}`);
          if (rollbackFrozenIteration('freeze validation parse failure')) {
            continue;
          }
          newStructureForCheck = freezeBaselineStructure;
        }
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
          if (rollbackFrozenIteration('feature loss detected while frozen')) {
            continue;
          }
        }

        if (newStructureForCheck.features.length < freezeBaselineStructure.features.length) {
          console.warn('❌ FEATURE COUNT DECREASED WHILE FROZEN');
          console.warn('   Baseline: ' + freezeBaselineStructure.features.length + ' features');
          console.warn('   New: ' + newStructureForCheck.features.length + ' features');
          if (rollbackFrozenIteration('feature count decreased while frozen')) {
            continue;
          }
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

        const scaffoldResult = this.ensureRequiredSections(currentStructure, {
          workflowInputText,
          iterationNumber: i,
          contentLanguage,
        });
        currentStructure = scaffoldResult.structure;
        if (scaffoldResult.addedSections.length > 0) {
          forceReassembleFromStructure = true;
          console.log(`🧱 Iteration ${i}: Section scaffold added (${scaffoldResult.addedSections.join(', ')})`);
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
              diagnostics.autoRecoveredFeatures = (diagnostics.autoRecoveredFeatures || 0) + integrityResult.restorations.length;
              diagnostics.featureQualityRegressions = (diagnostics.featureQualityRegressions || 0) +
                integrityResult.restorations.filter(r => r.qualityRegression).length;
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
              diagnostics.autoRecoveredFeatures = (diagnostics.autoRecoveredFeatures || 0) + freezeIntegrity.restorations.length;
              diagnostics.featureQualityRegressions = (diagnostics.featureQualityRegressions || 0) +
                freezeIntegrity.restorations.filter(r => r.qualityRegression).length;
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
      
      const iterTokens = genResult.usage.total_tokens + answerResult.usage.total_tokens;
      iterations.push({
        iterationNumber: i,
        generatorOutput: genResult.content,
        answererOutput: answerResult.content,
        answererOutputTruncated,
        questions,
        mergedPRD: preservedPRD,
        tokensUsed: iterTokens
      });
      onProgress?.({ type: 'iteration_complete', iteration: i, total: iterationCount, tokensUsed: iterTokens });
    }
    
    let finalReview: IterativeResponse['finalReview'] = undefined;
    
    // Optional: Final Review with AI #3
    if (useFinalReview) {
      console.log('\n🎯 AI #3: Final review and polish...');
      onProgress?.({ type: 'final_review_start' });

      const finalReviewerPrompt = `Review the following PRD at the highest level:\n\n${currentPRD}`;

      const reviewResult = await client.callWithFallback(
        'reviewer',
        FINAL_REVIEWER_PROMPT + langInstruction,
        finalReviewerPrompt,
        6000
      );
      
      modelsUsed.add(reviewResult.model);
      console.log(`✅ Final review complete with ${reviewResult.usage.completion_tokens} tokens`);
      onProgress?.({ type: 'final_review_done', tokensUsed: reviewResult.usage.total_tokens });

      finalReview = {
        content: reviewResult.content,
        model: reviewResult.model,
        usage: reviewResult.usage,
        tier: reviewResult.tier
      };
    }

    // Final hardening: guarantee all required non-feature sections are present in final output.
    let finalHardenedStructure: PRDStructure | undefined;
    try {
      let finalStructure = parsePRDToStructure(currentPRD);

      // Merge enriched expansion data into final structure if available
      if (iterativeEnrichedStructure) {
        finalStructure = mergeExpansionIntoStructure(finalStructure,
          iterativeEnrichedStructure.features.map(f => ({
            featureId: f.id,
            featureName: f.name,
            content: f.rawContent,
            model: 'merged',
            usage: {},
            retried: false,
            valid: true,
            compiled: true,
          }))
        );
      }

      if (featuresFrozen && freezeBaselineStructure) {
        finalStructure = this.mergeWithFreezeBaseline(finalStructure, freezeBaselineStructure);
      }
      finalStructure = this.normalizeSectionAliases(finalStructure);
      const finalScaffold = this.ensureRequiredSections(finalStructure, {
        workflowInputText,
        iterationNumber: iterationCount,
        contentLanguage,
      });
      let hardenedStructure = this.enforceCanonicalFeatureStructure(finalScaffold.structure, contentLanguage);
      const nfrHardening = this.enforceNfrCoverage(hardenedStructure, contentLanguage);
      hardenedStructure = nfrHardening.structure;
      diagnostics.nfrGlobalCategoryAdds = (diagnostics.nfrGlobalCategoryAdds || 0) + nfrHardening.globalCategoryAdds;
      diagnostics.nfrFeatureCriteriaAdds = (diagnostics.nfrFeatureCriteriaAdds || 0) + nfrHardening.featureCriteriaAdds;
      hardenedStructure = this.normalizeSectionAliases(hardenedStructure);
      finalHardenedStructure = hardenedStructure;
      currentPRD = assembleStructureToMarkdown(hardenedStructure);
      if (iterations.length > 0) {
        iterations[iterations.length - 1].mergedPRD = currentPRD;
      }
      if (finalScaffold.addedSections.length > 0) {
        console.log(`🧱 Final scaffold added (${finalScaffold.addedSections.join(', ')})`);
      } else {
        console.log('🧱 Final canonical assembly complete');
      }
      if (nfrHardening.globalCategoryAdds > 0 || nfrHardening.featureCriteriaAdds > 0) {
        console.log(`🛡️ NFR hardening: +${nfrHardening.globalCategoryAdds} global categories, +${nfrHardening.featureCriteriaAdds} feature criteria`);
      }
    } catch (finalScaffoldError: any) {
      console.warn(`⚠️ Final scaffold hardening failed (non-blocking): ${finalScaffoldError.message}`);
    }
    
    // Build iteration log document (separate from clean PRD)
    const iterationLog = this.buildIterationLog(iterations, finalReview, allDriftWarnings, allPreservationActions, allIntegrityRestorations, allSectionRegens);
    
    // Calculate totals
    const totalTokens = iterations.reduce((sum, iter) => sum + iter.tokensUsed, 0) +
      (finalReview?.usage.total_tokens || 0);
    
    console.log(`\n✅ Iterative workflow complete! Total tokens: ${totalTokens}`);

    // Structured PRD representation - use hardened structure if available, else parse
    try {
      const structured = finalHardenedStructure || parsePRDToStructure(currentPRD);
      logStructureValidation(structured);
      diagnostics.totalFeatureCount = structured.features.length;
      diagnostics.structuredFeatureCount = structured.features.filter(f =>
        f.purpose || f.actors || f.mainFlow || f.acceptanceCriteria
      ).length;
      diagnostics.avgFeatureCompleteness = structured.features.length > 0
        ? Number((structured.features.reduce((sum, f) => sum + countFeatureCompleteness(f), 0) / structured.features.length).toFixed(2))
        : 0;
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
    console.log('   Avg Feature Completeness: ' + (diagnostics.avgFeatureCompleteness || 0));
    console.log('   Quality Regressions Recovered: ' + (diagnostics.featureQualityRegressions || 0));

    currentPRD = this.sanitizeFinalMarkdown(currentPRD);
    if (iterations.length > 0) {
      iterations[iterations.length - 1].mergedPRD = currentPRD;
    }
    const validation = this.validateFinalOutputConsistency({
      finalPRD: currentPRD,
      iterations,
      freezeBaselineFeatureCount: freezeBaselineStructure?.features.length || 0,
      featuresFrozen
    });
    diagnostics.finalValidationPassed = validation.errors.length === 0;
    diagnostics.finalValidationErrors = validation.errors.length;
    diagnostics.finalSanitizerApplied = validation.sanitizerApplied;
    if (validation.errors.length > 0) {
      console.warn('⚠️ Final output consistency issues detected:');
      for (const err of validation.errors) {
        console.warn(`   - ${err}`);
      }
      if (process.env.HARD_FINAL_QUALITY_GATE === 'true') {
        throw new Error(`Final quality gate failed: ${validation.errors.slice(0, 5).join(' | ')}`);
      }
    }

    // Fail-safe: return immediately after workflow completion to avoid
    // long or stuck post-processing in unstable environments.
    const fastFinalizeEnabled = process.env.ITERATIVE_FAST_FINALIZE !== 'false';
    if (fastFinalizeEnabled) {
      console.log('⚡ Iterative fast finalize enabled (skipping deep post-processing)');
      onProgress?.({ type: 'complete', totalTokens });
      return {
        finalContent: currentPRD,
        mergedPRD: currentPRD,
        iterationLog,
        iterations,
        finalReview,
        totalTokens,
        modelsUsed: Array.from(modelsUsed),
        diagnostics,
        structuredContent: finalHardenedStructure,
      };
    }

    const canonicalMergedPRD = this.buildCanonicalMergedPRD(currentPRD, iterations);
    currentPRD = canonicalMergedPRD;
    if (iterations.length > 0) {
      iterations[iterations.length - 1].mergedPRD = canonicalMergedPRD;
    }
    const postCanonicalValidation = this.validateFinalOutputConsistency({
      finalPRD: currentPRD,
      iterations,
      freezeBaselineFeatureCount: freezeBaselineStructure?.features.length || 0,
      featuresFrozen
    });
    diagnostics.finalValidationPassed = postCanonicalValidation.errors.length === 0;
    diagnostics.finalValidationErrors = postCanonicalValidation.errors.length;
    diagnostics.finalSanitizerApplied = postCanonicalValidation.sanitizerApplied;
    if (postCanonicalValidation.errors.length > 0) {
      console.warn('⚠️ Final output consistency issues detected:');
      for (const err of postCanonicalValidation.errors) {
        console.warn(`   - ${err}`);
      }
    }
    diagnostics.artifactWriteConsistency = true;
    diagnostics.artifactWriteIssues = 0;
    const shouldWriteArtifacts = process.env.WRITE_ITERATIVE_ARTIFACTS === 'true';
    if (shouldWriteArtifacts) {
      try {
        const artifactWriteResult = await this.writeIterativeArtifacts({
          finalContent: canonicalMergedPRD,
          mergedPRD: canonicalMergedPRD,
          iterationLog,
          iterations,
          finalReview,
          totalTokens,
          modelsUsed: Array.from(modelsUsed),
          diagnostics
        });
        diagnostics.artifactWriteConsistency = artifactWriteResult.ok;
        diagnostics.artifactWriteIssues = artifactWriteResult.issues.length;
        if (!artifactWriteResult.ok) {
          console.warn('⚠️ Service-level artifact write consistency issues detected:');
          for (const issue of artifactWriteResult.issues) {
            console.warn(`   - ${issue}`);
          }
        } else {
          console.log(`🗂️ Service artifacts updated: ${artifactWriteResult.files.join(', ')}`);
        }
      } catch (artifactError: any) {
        diagnostics.artifactWriteConsistency = false;
        diagnostics.artifactWriteIssues = 1;
        console.warn(`⚠️ Service artifact write failed: ${artifactError.message}`);
      }
    } else {
      console.log('🗂️ Service artifact write skipped (WRITE_ITERATIVE_ARTIFACTS != true)');
    }

    onProgress?.({ type: 'complete', totalTokens });
    return {
      finalContent: canonicalMergedPRD,
      mergedPRD: canonicalMergedPRD,
      iterationLog,
      iterations,
      finalReview,
      totalTokens,
      modelsUsed: Array.from(modelsUsed),
      diagnostics,
      structuredContent: finalHardenedStructure,
    };
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
  }): Promise<{ ok: boolean; issues: string[]; files: string[] }> {
    const issues: string[] = [];
    const repoRoot = process.cwd();
    const targets = [
      path.join(repoRoot, '.tmp_run_response.json'),
      path.join(repoRoot, '.tmp_run_final_gate_verify.json'),
    ];

    const preStats = new Map<string, fs.Stats | null>();
    await Promise.all(
      targets.map(async (target) => {
        try {
          preStats.set(target, await fs.promises.stat(target));
        } catch {
          preStats.set(target, null);
        }
      }),
    );

    const serialized = JSON.stringify(payload, null, 2) + '\n';
    await Promise.all(targets.map((target) => fs.promises.writeFile(target, serialized, 'utf8')));

    for (const target of targets) {
      const after = await fs.promises.stat(target);
      const before = preStats.get(target);
      if (after.size <= 0) {
        issues.push(`${path.basename(target)} has zero size`);
      }
      if (before && after.mtimeMs <= before.mtimeMs) {
        issues.push(`${path.basename(target)} mtime did not advance`);
      }
    }

    return {
      ok: issues.length === 0,
      issues,
      files: targets.map(t => path.basename(t)),
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

  private ensureRequiredSections(
    structure: PRDStructure,
    context: { workflowInputText: string; iterationNumber: number; contentLanguage?: string | null }
  ): { structure: PRDStructure; addedSections: Array<keyof PRDStructure> } {
    const { workflowInputText, iterationNumber, contentLanguage } = context;
    const updated: PRDStructure = {
      ...structure,
      otherSections: { ...structure.otherSections },
    };
    const addedSections: Array<keyof PRDStructure> = [];
    const inputSummary = this.safeTruncateAtWord(workflowInputText, 260);
    const language = this.resolveScaffoldLanguage(contentLanguage, workflowInputText);
    const isGerman = language === 'de';

    const templates: Array<{ key: keyof PRDStructure; content: string }> = [
      {
        key: 'domainModel',
        content: isGerman
          ? [
              '- Kern-Entitaeten: Nutzer/Besucher, Feature, Anforderung und Iteration.',
              '- Beziehungen: Eine Anforderung aggregiert Features; jede Iteration verfeinert bestehende Features und kann neue ueber ein strukturiertes Delta hinzufuegen.',
              '- Datenkonsistenz: Feature-IDs bleiben ueber Iterationen stabil und gelten als unveraenderliche Kennungen.',
              inputSummary ? `- Quellkontext (Iteration ${iterationNumber}): ${inputSummary}` : '',
            ].filter(Boolean).join('\n')
          : [
              '- Core entities: User/Visitor, Feature, Requirement, and Iteration.',
              '- Relations: A Requirement aggregates Features; each Iteration refines existing Features and may add new ones via structured delta.',
              '- Data consistency: feature IDs remain stable across iterations and are treated as immutable identifiers.',
              inputSummary ? `- Source context (iteration ${iterationNumber}): ${inputSummary}` : '',
            ].filter(Boolean).join('\n'),
      },
      {
        key: 'globalBusinessRules',
        content: isGerman
          ? [
              '- Bestehende Features duerfen waehrend der iterativen Verfeinerung nicht entfernt werden.',
              '- Neue Features werden nur ueber validiertes Feature-Delta-JSON akzeptiert.',
              '- Doppelte Features (gleiche Intention/Bezeichnung) werden deterministisch verworfen.',
              '- Akzeptanzkriterien aller Features muessen testbar und beobachtbar bleiben.',
            ].join('\n')
          : [
              '- Existing features must not be removed during iterative refinement.',
              '- New features are only accepted through validated Feature Delta JSON.',
              '- Duplicate features (same intent/name) are rejected deterministically.',
              '- Acceptance criteria for all features must stay testable and observable.',
            ].join('\n'),
      },
      {
        key: 'nonFunctional',
        content: isGerman
          ? [
              '- Zuverlaessigkeit: Ein iterativer Lauf muss ohne Verlust bereits akzeptierter Features abschliessen.',
              '- Determinismus: Freeze-Baseline und Feature-IDs bleiben ueber Iterationen stabil.',
              '- Performance: In Freeze-Mode wird Section-Patching gegenueber Vollregeneration bevorzugt.',
              '- Beobachtbarkeit: Diagnostics muessen Feature-Anzahl, blockierte Versuche und Integritaetsereignisse ausweisen.',
            ].join('\n')
          : [
              '- Reliability: iterative run must complete without losing previously accepted features.',
              '- Determinism: freeze baseline and feature IDs remain stable across iterations.',
              '- Performance: iteration patching is preferred over full regeneration in freeze mode.',
              '- Observability: diagnostics must report feature count, blocked attempts, and structural integrity events.',
            ].join('\n'),
      },
      {
        key: 'errorHandling',
        content: isGerman
          ? [
              '- Ungueltiges oder fehlendes strukturiertes Delta erzwingt einen strikten Fallback auf den vorherigen stabilen PRD-Zustand.',
              '- Fehler bei Section-Regeneration im Freeze-Mode fallen sicher zurueck, ohne Feature-Verlust.',
              '- Parse-Fehler gelten nur dann als non-blocking, wenn Integritaet weiterhin garantiert ist.',
              '- Alle Fallback-Pfade werden mit explizitem Grund und Iterationsnummer protokolliert.',
            ].join('\n')
          : [
              '- Invalid or missing structured delta triggers strict fallback to previous stable PRD state.',
              '- Section regeneration failures in freeze mode fall back safely without feature loss.',
              '- Parsing failures are treated as non-blocking only when integrity can still be guaranteed.',
              '- All fallback paths must be logged with explicit reason and iteration number.',
            ].join('\n'),
      },
      {
        key: 'deployment',
        content: isGerman
          ? [
              '- Runtime: Node.js-Service mit Endpunkten fuer den iterativen Compiler.',
              '- Umgebung: Dockerisierte Local/Dev-Ausfuehrung mit reproduzierbarem Build und Health-Endpoint.',
              '- Abhaengigkeiten: LLM-Provider-Integration mit Model-Fallback-Strategie.',
              '- Auslieferung: Aenderungen werden mit TypeScript-Check und End-to-End-API-Smoke-Run validiert.',
            ].join('\n')
          : [
              '- Runtime: Node.js service with iterative compiler endpoints.',
              '- Environment: Dockerized local/dev execution with reproducible build and health endpoint.',
              '- Dependencies: LLM provider integration with model fallback strategy.',
              '- Delivery: changes are validated with TypeScript check and end-to-end API smoke run.',
            ].join('\n'),
      },
      {
        key: 'definitionOfDone',
        content: isGerman
          ? [
              '- Erforderliche PRD-Sektionen sind vorhanden und nicht leer.',
              '- Die Feature-Anzahl faellt nicht unter die gefrorene Baseline.',
              '- Es bleiben keine doppelten Feature-IDs oder doppelten Feature-Namen bestehen.',
              '- Der iterative Lauf schliesst mit gueltigem finalen PRD und Diagnostics ab.',
            ].join('\n')
          : [
              '- Required PRD sections are present and non-empty.',
              '- Feature count does not drop below the frozen baseline.',
              '- No duplicate feature IDs or duplicate feature names remain.',
              '- Iterative run completes with valid final PRD and diagnostics.',
            ].join('\n'),
      },
    ];

    for (const template of templates) {
      const existing = updated[template.key];
      if (typeof existing === 'string' && existing.trim().length > 0) continue;
      (updated as any)[template.key] = template.content;
      addedSections.push(template.key);
    }

    return { structure: updated, addedSections };
  }

  private resolveScaffoldLanguage(contentLanguage: string | null | undefined, text: string): 'de' | 'en' {
    if (contentLanguage === 'de') return 'de';
    if (contentLanguage === 'en') return 'en';

    const sample = (text || '').toLowerCase();
    const germanHints = [
      ' und ',
      ' mit ',
      ' fuer ',
      ' für ',
      ' bitte ',
      ' erstelle ',
      ' landingpage',
      'kontaktformular',
      'kursuebersicht',
      'kursübersicht',
    ];
    const hasGermanUmlaut = /[äöüß]/i.test(sample);
    const hasGermanHint = germanHints.some(h => sample.includes(h));
    return hasGermanUmlaut || hasGermanHint ? 'de' : 'en';
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
        compiledRaw = [
          `Feature ID: ${resolvedId}`,
          `Feature Name: ${candidate.name}`,
          ``,
          `1. Purpose`,
          `${candidate.name} provides a deterministic, testable feature outcome.`,
          ``,
          `2. Actors`,
          `- Primary: End user`,
          `- Secondary: System process`,
          ``,
          `3. Trigger`,
          `Triggered by user interaction or a system event relevant to this feature.`,
          ``,
          `4. Preconditions`,
          `- Required input is available.`,
          `- Runtime dependencies are available.`,
          ``,
          `5. Main Flow`,
          `1. Validate input and context for ${candidate.name}.`,
          `2. Execute core feature logic and update state consistently.`,
          `3. Return success result and update UI-facing state.`,
          ``,
          `6. Alternate Flows`,
          `- Validation error: no write performed and error message returned.`,
          `- Runtime error: request fails safely with logged reason.`,
          ``,
          `7. Postconditions`,
          `Feature state is consistent and observable after completion.`,
          ``,
          `8. Data Impact`,
          `Only required entities are read/updated; no unrelated data is changed.`,
          ``,
          `9. UI Impact`,
          `UI reflects success/error state and any changed data.`,
          ``,
          `10. Acceptance Criteria`,
          `- Feature executes end-to-end with deterministic behavior.`,
          `- Error and validation paths are explicit and testable.`,
          `- Final state is consistent across UI and persistence layers.`,
        ].join('\n');
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

  private mergeWithFreezeBaseline(current: PRDStructure, freezeBaseline: PRDStructure): PRDStructure {
    const byId = new Map<string, FeatureSpec>();
    for (const feature of freezeBaseline.features) {
      byId.set(feature.id, { ...feature });
    }
    for (const feature of current.features) {
      const existing = byId.get(feature.id);
      if (!existing) {
        byId.set(feature.id, { ...feature });
        continue;
      }
      // Keep the richer version while preserving frozen IDs.
      if ((feature.rawContent || '').length > (existing.rawContent || '').length) {
        byId.set(feature.id, { ...feature });
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
    const lang = this.resolveScaffoldLanguage(contentLanguage, structure.systemVision || structure.systemBoundaries || '');
    const isGerman = lang === 'de';
    const deduped = new Map<string, FeatureSpec>();

    for (const rawFeature of structure.features) {
      const feature = { ...rawFeature };
      const idMatch = String(feature.id || '').toUpperCase().match(/F-(\d+)/);
      if (!idMatch) continue;
      const id = `F-${idMatch[1].padStart(2, '0')}`;
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

      // --- purpose ---
      normalizedFeature.purpose = normalizedFeature.purpose?.trim() || pick(isGerman ? [
        `"${n}" deckt einen eigenstaendigen Anwendungsfall ab und liefert ein klar definiertes Ergebnis.`,
        `Das Feature "${n}" ermoeglicht eine abgeschlossene Nutzerinteraktion mit pruefbarem Resultat.`,
        `"${n}" stellt eine atomare Funktionseinheit dar, die unabhaengig getestet und ausgeliefert werden kann.`,
      ] : [
        `"${n}" covers a self-contained use case and produces a well-defined outcome.`,
        `The feature "${n}" enables a complete user interaction with a verifiable result.`,
        `"${n}" represents an atomic functional unit that can be tested and shipped independently.`,
      ], fi);

      // --- actors ---
      normalizedFeature.actors = normalizedFeature.actors?.trim() || pick(isGerman ? [
        `Hauptakteur: Endnutzer, der "${n}" auslöst. Unterstuetzend: Backend-Services zur Datenverarbeitung.`,
        `Anwender im Kontext von "${n}". Sekundaer: Datenhaltungs- und Validierungskomponenten.`,
        `Nutzer interagiert direkt mit "${n}". Systemseitig: Persistenz- und Benachrichtigungsdienste.`,
      ] : [
        `Primary actor: end user invoking "${n}". Supporting: backend services for data processing.`,
        `Application user in the context of "${n}". Secondary: persistence and validation layers.`,
        `User interacts directly with "${n}". System-side: storage and notification services.`,
      ], fi);

      // --- trigger ---
      normalizedFeature.trigger = normalizedFeature.trigger?.trim() || pick(isGerman ? [
        `Nutzer startet "${n}" ueber die entsprechende Aktion in der Oberflaeche.`,
        `Ausgeloest durch explizite Nutzerinteraktion im Kontext von "${n}".`,
        `Systemereignis oder Nutzereingabe initiiert den Ablauf von "${n}".`,
      ] : [
        `User starts "${n}" via the corresponding action in the interface.`,
        `Triggered by explicit user interaction in the context of "${n}".`,
        `System event or user input initiates the "${n}" workflow.`,
      ], fi);

      // --- preconditions ---
      normalizedFeature.preconditions = normalizedFeature.preconditions?.trim() || pick(isGerman ? [
        `Anwendung ist geladen, Nutzerkontext fuer "${n}" ist verfuegbar, Datenquellen erreichbar.`,
        `System ist betriebsbereit und alle fuer "${n}" benoetigten Abhaengigkeiten sind initialisiert.`,
        `Authentifizierung (falls erforderlich) ist abgeschlossen, "${n}" kann aufgerufen werden.`,
      ] : [
        `Application is loaded, user context for "${n}" is available, data sources reachable.`,
        `System is operational and all dependencies required by "${n}" are initialized.`,
        `Authentication (if required) is complete, "${n}" can be invoked.`,
      ], fi);

      // --- mainFlow ---
      const mainFlow = Array.isArray(normalizedFeature.mainFlow) ? normalizedFeature.mainFlow.filter(Boolean) : [];
      if (mainFlow.length < 4) {
        const fallbackStepsDE = [
          [`Nutzer loest "${n}" aus und das System validiert die Eingabe.`,
           `Kernlogik von "${n}" wird ausgefuehrt und Ergebnis berechnet.`,
           `Zustandsaenderungen werden persistent und nachvollziehbar gespeichert.`,
           `Oberflaeche wird mit dem Ergebnis von "${n}" aktualisiert.`],
          [`System empfaengt die Anfrage fuer "${n}" und prueft Vorbedingungen.`,
           `Geschaeftsregeln fuer "${n}" werden angewendet.`,
           `Resultierende Daten werden transaktional in die Persistenzschicht geschrieben.`,
           `Nutzer erhaelt visuelles Feedback ueber den Abschluss von "${n}".`],
          [`Eingabedaten fuer "${n}" werden entgegengenommen und validiert.`,
           `"${n}"-spezifische Verarbeitungslogik wird durchlaufen.`,
           `Aenderungen werden atomar gespeichert und protokolliert.`,
           `UI spiegelt den neuen Zustand nach "${n}" wider.`],
        ];
        const fallbackStepsEN = [
          [`User triggers "${n}" and the system validates the input.`,
           `Core logic of "${n}" executes and computes the result.`,
           `State changes are persisted durably and traceably.`,
           `Interface is updated with the outcome of "${n}".`],
          [`System receives the "${n}" request and checks preconditions.`,
           `Business rules for "${n}" are applied.`,
           `Resulting data is written transactionally to the persistence layer.`,
           `User receives visual feedback on "${n}" completion.`],
          [`Input data for "${n}" is received and validated.`,
           `"${n}"-specific processing logic is executed.`,
           `Changes are stored atomically and logged.`,
           `UI reflects the new state after "${n}".`],
        ];
        const steps = pick(isGerman ? fallbackStepsDE : fallbackStepsEN, fi);
        while (mainFlow.length < 4) {
          const stepNo = mainFlow.length + 1;
          mainFlow.push(`${stepNo}. ${steps[Math.min(mainFlow.length, steps.length - 1)]}`);
        }
      }
      normalizedFeature.mainFlow = mainFlow;

      // --- alternateFlows ---
      const altFlows = Array.isArray(normalizedFeature.alternateFlows) ? normalizedFeature.alternateFlows.filter(Boolean) : [];
      if (altFlows.length === 0) {
        altFlows.push(pick(isGerman ? [
          `Fehlerfall fuer "${n}": Bei ungueltiger Eingabe zeigt das System eine Validierungsmeldung und behaelt den Eingabekontext.`,
          `Alternativpfad fuer "${n}": Bei fehlenden Daten wird der Nutzer zur Korrektur aufgefordert, ohne bisherige Eingaben zu verlieren.`,
          `Abbruchpfad fuer "${n}": Nutzer kann den Vorgang jederzeit abbrechen; bereits erfasste Daten bleiben im Entwurfszustand erhalten.`,
        ] : [
          `Error path for "${n}": on invalid input, the system shows validation feedback and preserves user input.`,
          `Alternate path for "${n}": on missing data, the user is prompted to correct input without losing prior entries.`,
          `Cancellation path for "${n}": user can abort at any time; already captured data is kept in draft state.`,
        ], fi));
      }
      normalizedFeature.alternateFlows = altFlows;

      // --- postconditions ---
      normalizedFeature.postconditions = normalizedFeature.postconditions?.trim() || pick(isGerman ? [
        `Nach Abschluss von "${n}" ist der Zustand konsistent gespeichert und fuer Folgeprozesse verfuegbar.`,
        `"${n}" hinterlaesst einen nachvollziehbaren Datenzustand, der von nachgelagerten Features genutzt werden kann.`,
        `Alle durch "${n}" ausgeloesten Aenderungen sind persistiert und das System ist fuer die naechste Aktion bereit.`,
      ] : [
        `After "${n}" completes, state is stored consistently and available for downstream processes.`,
        `"${n}" leaves a traceable data state that downstream features can consume.`,
        `All changes triggered by "${n}" are persisted and the system is ready for the next action.`,
      ], fi);

      // --- dataImpact ---
      normalizedFeature.dataImpact = normalizedFeature.dataImpact?.trim() || pick(isGerman ? [
        `"${n}" liest und schreibt die zugehoerigen Entitaeten; Aenderungen sind atomar und nachvollziehbar.`,
        `Datenbankoperationen von "${n}" betreffen die Kern-Entitaeten des Features und werden transaktional ausgefuehrt.`,
        `"${n}" erzeugt oder aktualisiert Datensaetze, die fuer die Integritaet des Gesamtsystems relevant sind.`,
      ] : [
        `"${n}" reads and writes its associated entities; changes are atomic and traceable.`,
        `Database operations of "${n}" affect the feature's core entities and execute transactionally.`,
        `"${n}" creates or updates records relevant to overall system integrity.`,
      ], fi);

      // --- uiImpact ---
      normalizedFeature.uiImpact = normalizedFeature.uiImpact?.trim() || pick(isGerman ? [
        `Die Oberflaeche zeigt den Zustand von "${n}" transparent an und gibt klare Erfolgs- oder Fehlerrueckmeldung.`,
        `"${n}" aktualisiert die betroffenen UI-Komponenten in Echtzeit und zeigt Ladezustaende bei laengeren Operationen.`,
        `Nach Ausfuehrung von "${n}" wird das relevante UI-Element visuell aktualisiert, ohne vollstaendigen Seitenneuladen.`,
      ] : [
        `The interface displays "${n}" state transparently and provides clear success or error feedback.`,
        `"${n}" updates affected UI components in real time and shows loading states for longer operations.`,
        `After "${n}" executes, the relevant UI element is visually refreshed without a full page reload.`,
      ], fi);

      // --- acceptanceCriteria ---
      const acceptance = Array.isArray(normalizedFeature.acceptanceCriteria) ? normalizedFeature.acceptanceCriteria.filter(Boolean) : [];
      if (acceptance.length < 3) {
        const criteriaPoolDE = [
          [`"${n}" kann vom Endnutzer erfolgreich durchgefuehrt werden und das erwartete Ergebnis ist sichtbar.`,
           `Fehlerfaelle in "${n}" fuehren zu verstaendlichen Meldungen ohne Datenverlust.`,
           `"${n}" ist innerhalb der definierten Performanz-Grenzen ausfuehrbar.`],
          [`Ein Testnutzer kann "${n}" ohne externe Hilfe abschliessen.`,
           `Alle Zustandsaenderungen durch "${n}" sind nach Ausfuehrung in der Datenschicht verifizierbar.`,
           `"${n}" verhaelt sich bei wiederholter Ausfuehrung identisch (idempotent, soweit zutreffend).`],
          [`"${n}" erzeugt bei korrekter Eingabe stets das gleiche definierte Ergebnis.`,
           `Randfaelle und Fehlereingaben in "${n}" sind abgefangen und dokumentiert.`,
           `"${n}" ist ueber die Oberflaeche und optional per API ausloesbar.`],
        ];
        const criteriaPoolEN = [
          [`"${n}" can be completed successfully by the end user and the expected outcome is visible.`,
           `Error cases in "${n}" produce understandable messages without data loss.`,
           `"${n}" executes within defined performance boundaries.`],
          [`A test user can complete "${n}" without external assistance.`,
           `All state changes from "${n}" are verifiable in the data layer after execution.`,
           `"${n}" behaves identically on repeated execution (idempotent where applicable).`],
          [`"${n}" produces the same defined outcome given correct input.`,
           `Edge cases and invalid inputs in "${n}" are handled and documented.`,
           `"${n}" is invocable through the UI and optionally via API.`],
        ];
        const pool = pick(isGerman ? criteriaPoolDE : criteriaPoolEN, fi);
        while (acceptance.length < 3) {
          const idx = acceptance.length;
          acceptance.push(`${idx + 1}. ${pool[Math.min(idx, pool.length - 1)]}`);
        }
      }
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

  private buildCanonicalMergedPRD(currentPRD: string, iterations: IterativeResponse['iterations']): string {
    const latestMerged = iterations.length > 0 ? iterations[iterations.length - 1].mergedPRD : '';
    let canonical = (latestMerged && latestMerged.trim()) ? latestMerged : currentPRD;
    canonical = this.sanitizeFinalMarkdown(canonical);

    try {
      const normalized = this.normalizeSectionAliases(parsePRDToStructure(canonical));
      canonical = assembleStructureToMarkdown(normalized);
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
    const headingTestPattern = /([^\n])[ \t]+(##\s+(?:System Vision|System Boundaries|Domain Model|Global Business Rules|Functional Feature Catalogue|Non-Functional Requirements|Error Handling & Recovery|Deployment & Infrastructure|Definition of Done)\b)/;
    const headingReplacePattern = /([^\n])[ \t]+(##\s+(?:System Vision|System Boundaries|Domain Model|Global Business Rules|Functional Feature Catalogue|Non-Functional Requirements|Error Handling & Recovery|Deployment & Infrastructure|Definition of Done)\b)/g;
    let safetyCounter = 0;
    while (headingTestPattern.test(normalized)) {
      const next = normalized.replace(headingReplacePattern, '$1\n\n$2');
      // Stop if replacement converges to a fixed point.
      if (next === normalized) break;
      normalized = next;
      safetyCounter++;
      if (safetyCounter > 1000) {
        console.warn('⚠️ normalizeInlineHeadings safety break triggered');
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
    ];

    for (const { label, pattern } of requiredHeadings) {
      const matches = finalPRD.match(new RegExp(pattern.source, 'gm')) || [];
      if (matches.length !== 1) {
        errors.push(`## ${label} expected exactly once, found ${matches.length}`);
      }
    }

    if (/[^\n]\s##\s(?:System Vision|Executive Summary|Vision|System Boundaries|Boundaries|Scope|System Scope|Domain Model|Data Model|Domain|Global Business Rules|Business Rules|Functional Feature Catalogue|Feature Catalogue|Features|Non-?Functional Requirements|NFR|Quality Attributes|Error Handling|Deployment|Infrastructure|Definition of Done|Done Criteria)\b/.test(finalPRD)) {
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
    const lang = this.resolveScaffoldLanguage(contentLanguage, structure.nonFunctional || structure.systemVision || '');
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

    const nfrCriterionPattern = /(performance|latency|response time|security|xss|csrf|accessibility|wcag|aria|reliability|availability|monitor|logging|metrics|zuverlaess|zuverläss|sicherheit|barriere|antwortzeit|beobacht)/i;
    let featureCriteriaAdds = 0;
    for (const feature of updated.features) {
      const criteria = Array.isArray(feature.acceptanceCriteria)
        ? [...feature.acceptanceCriteria]
        : [];
      const hasNfrCriterion = criteria.some(c => nfrCriterionPattern.test(String(c)));
      if (!hasNfrCriterion) {
        criteria.push(isGerman
          ? 'NFR: Funktion erfuellt definierte Performance-, Sicherheits- und Accessibility-Basisanforderungen ohne Laufzeitfehler.'
          : 'NFR: Feature meets defined baseline performance, security, and accessibility requirements without runtime errors.');
        feature.acceptanceCriteria = criteria;
        feature.rawContent = this.renderCanonicalFeatureRaw(feature);
        featureCriteriaAdds++;
      }
    }

    return { structure: updated, globalCategoryAdds, featureCriteriaAdds };
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

    const anchorFeatures = Array.isArray(anchor?.features)
      ? anchor!.features
        .map((f: FeatureSpec) => ({
          id: String(f.id || '').trim().toUpperCase(),
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
          const tier = prefs.tier || 'production';
          const activeTierModels = prefs.tierModels?.[tier] || {};
          const tierDefaults = MODEL_TIERS[tier as keyof typeof MODEL_TIERS] || MODEL_TIERS.production;
          const resolvedGeneratorModel = activeTierModels.generatorModel || prefs.generatorModel || tierDefaults.generator;
          const resolvedReviewerModel = activeTierModels.reviewerModel || prefs.reviewerModel || tierDefaults.reviewer;
          const resolvedFallbackModel = activeTierModels.fallbackModel || prefs.fallbackModel;

          console.log(`🤖 User AI preferences loaded:`, {
            tier,
            tierGenerator: activeTierModels.generatorModel || '(not set)',
            tierReviewer: activeTierModels.reviewerModel || '(not set)',
            globalGenerator: prefs.generatorModel || '(not set)',
            globalReviewer: prefs.reviewerModel || '(not set)',
            resolvedGenerator: resolvedGeneratorModel,
            resolvedReviewer: resolvedReviewerModel,
            resolvedFallback: resolvedFallbackModel || '(none)',
          });

          if (resolvedGeneratorModel) {
            client.setPreferredModel('generator', resolvedGeneratorModel);
          }
          if (resolvedReviewerModel) {
            client.setPreferredModel('reviewer', resolvedReviewerModel);
          }
          if (resolvedFallbackModel) {
            client.setPreferredModel('fallback', resolvedFallbackModel);
          }
          if (tier) {
            client.setPreferredTier(tier);
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
