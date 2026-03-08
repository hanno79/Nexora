/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Extrahierte Prompt-Bausteine fuer Guided-Workflow, Refinement und Finalisierung
*/

// ÄNDERUNG 08.03.2026: Mehrzeilige Guided-Prompt-Erzeugung aus `guidedAiService.ts` ausgelagert.
import { buildTemplateInstruction, type SupportedLanguage } from './prdTemplateIntent';

type GuidedWorkflowMode = 'generate' | 'improve';

interface GuidedPromptBaseParams {
  templateCategory?: string;
  language: SupportedLanguage;
}

export function buildGuidedAnalysisInput(params: GuidedPromptBaseParams & {
  workflowMode: GuidedWorkflowMode;
  projectIdea: string;
  existingContent?: string;
}): string {
  const templateInstruction = buildTemplateInstruction(params.templateCategory, params.language);
  return params.workflowMode === 'improve'
    ? `You are refining an existing PRD.\n\nCHANGE REQUEST:\n${params.projectIdea}\n\nEXISTING PRD BASELINE:\n${params.existingContent || ''}\n\nAnalyze what should be preserved and what should be improved. Focus on concrete user-facing refinements and missing sections.`
    : `Analyze this project idea:\n\n${params.projectIdea}\n\n${templateInstruction}`;
}

export function buildGuidedQuestionContext(params: GuidedPromptBaseParams & {
  workflowMode: GuidedWorkflowMode;
  featureOverview: string;
  projectIdea: string;
  existingContent?: string;
}): string {
  const templateInstruction = buildTemplateInstruction(params.templateCategory, params.language);
  return params.workflowMode === 'improve'
    ? `Based on this analysis of an EXISTING PRD and requested refinements, generate 3-5 clarifying questions with multiple choice answers.\n\nAnalysis:\n${params.featureOverview}\n\nChange request: ${params.projectIdea}\n\nExisting PRD:\n${params.existingContent || ''}\n\n${templateInstruction}`
    : `Based on this project analysis, generate 3-5 clarifying questions with multiple choice answers:\n\n${params.featureOverview}\n\nOriginal idea: ${params.projectIdea}\n\n${templateInstruction}`;
}

export function buildGuidedRefinementInput(params: GuidedPromptBaseParams & {
  workflowMode: GuidedWorkflowMode;
  existingContent?: string;
  projectIdea: string;
  featureOverview: string;
  formattedAnswers: string;
}): string {
  const templateInstruction = buildTemplateInstruction(params.templateCategory, params.language);
  return params.workflowMode === 'improve'
    ? `Existing PRD baseline:\n${params.existingContent || '(no baseline provided)'}\n\nChange request:\n${params.projectIdea}\n\nCurrent refined overview:\n${params.featureOverview}\n\nUser's answers:\n${params.formattedAnswers}\n\nRefine the plan as an incremental improvement to the existing PRD. Preserve existing valid content and target the requested changes.\n\n${templateInstruction}`
    : `Original project idea:\n${params.projectIdea}\n\nCurrent feature overview:\n${params.featureOverview}\n\nUser's answers:\n${params.formattedAnswers}\n\nRefine the product vision and features based on these answers.\n\n${templateInstruction}`;
}

export function buildGuidedFinalizeUserPrompt(params: GuidedPromptBaseParams & {
  isImproveWorkflow: boolean;
  existingContent?: string;
  projectIdea: string;
  featureOverview: string;
  allAnswers: string;
}): string {
  const templateInstruction = buildTemplateInstruction(params.templateCategory, params.language);
  return params.isImproveWorkflow
    ? `Refine the existing PRD by incorporating the requested improvements and guided decisions.\n\nEXISTING PRD (PRESERVE AND IMPROVE):\n${params.existingContent || ''}\n\nCHANGE REQUEST:\n${params.projectIdea}\n\nREFINED FEATURE OVERVIEW:\n${params.featureOverview}\n\nUSER DECISIONS & PREFERENCES:\n${params.allAnswers || 'No specific user preferences collected.'}\n\n${templateInstruction}\n\nReturn the complete improved PRD.`
    : `Create a complete PRD based on:\n\nORIGINAL PROJECT IDEA:\n${params.projectIdea}\n\nREFINED FEATURE OVERVIEW:\n${params.featureOverview}\n\nUSER DECISIONS & PREFERENCES:\n${params.allAnswers || 'No specific user preferences collected.'}\n\n${templateInstruction}\n\nGenerate a complete, professional PRD that incorporates all gathered requirements.`;
}

export function buildGuidedDirectFinalizeAnalysisInput(params: GuidedPromptBaseParams & {
  isImproveWorkflow: boolean;
  projectIdea: string;
  existingContent?: string;
}): string {
  const templateInstruction = buildTemplateInstruction(params.templateCategory, params.language);
  return params.isImproveWorkflow
    ? `Analyze the existing PRD and the requested refinements.\n\nCHANGE REQUEST:\n${params.projectIdea}\n\nEXISTING PRD:\n${params.existingContent || ''}\n\n${templateInstruction}`
    : `Analyze this project idea:\n\n${params.projectIdea}\n\n${templateInstruction}`;
}

export function buildGuidedDirectFinalizeUserPrompt(params: GuidedPromptBaseParams & {
  isImproveWorkflow: boolean;
  projectIdea: string;
  analysisContent: string;
  existingContent?: string;
}): string {
  const templateInstruction = buildTemplateInstruction(params.templateCategory, params.language);
  return params.isImproveWorkflow
    ? `Refine the existing PRD based on the requested changes.\n\nEXISTING PRD:\n${params.existingContent || ''}\n\nCHANGE REQUEST:\n${params.projectIdea}\n\nFEATURE ANALYSIS:\n${params.analysisContent}\n\n${templateInstruction}\n\nReturn the complete improved PRD.`
    : `Create a complete PRD based on:\n\nPROJECT IDEA:\n${params.projectIdea}\n\nFEATURE ANALYSIS:\n${params.analysisContent}\n\n${templateInstruction}\n\nGenerate a complete, professional PRD.`;
}
