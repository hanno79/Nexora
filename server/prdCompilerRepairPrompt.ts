/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Hilfsfunktionen zum Erzeugen von Repair-Prompts fuer den PRD-Compiler-Finalizer
*/

// ÄNDERUNG 08.03.2026: Repair-Prompt-Aufbau aus `prdCompilerFinalizer.ts`
// extrahiert, um die Datei groessenarm und ohne Verhaltensaenderung unter die
// Projektgrenze zu bringen.

import type { PRDStructure } from './prdStructure';
import { CANONICAL_PRD_HEADINGS } from './prdCompiler';
import { buildTemplateInstruction } from './prdTemplateIntent';

type SupportedLanguage = 'de' | 'en';

export interface RepairHistoryEntry {
  pass: number;
  score: number;
  issueCount: number;
  topIssues: string[];
}

function formatRepairHistory(history: RepairHistoryEntry[]): string {
  if (history.length === 0) return '';

  const lines = history.map(entry =>
    `- Pass ${entry.pass}: score ${entry.score}, ${entry.issueCount} issue(s): ${entry.topIssues.join(', ') || 'none'}`
  );
  const allIssueSets = history.map(entry => new Set(entry.topIssues));
  const persistentIssues = history[0].topIssues.filter(code =>
    allIssueSets.every(issueSet => issueSet.has(code))
  );
  const focusHint = persistentIssues.length > 0
    ? `\nFocus on fixing the persistent issue(s): ${persistentIssues.join(', ')}`
    : '';

  return `\nREPAIR HISTORY (do NOT repeat failed approaches):
${lines.join('\n')}${focusHint}\n`;
}

function collectRepairSectionKeys(structure: PRDStructure): string[] {
  const sections = new Set<string>();
  const sectionMap: Array<keyof PRDStructure> = [
    'systemVision',
    'systemBoundaries',
    'domainModel',
    'globalBusinessRules',
    'featureCatalogueIntro',
    'nonFunctional',
    'errorHandling',
    'deployment',
    'definitionOfDone',
    'outOfScope',
    'timelineMilestones',
    'successCriteria',
  ];

  for (const key of sectionMap) {
    if (String(structure[key] || '').trim()) {
      sections.add(String(key));
    }
  }

  if ((structure.features || []).length > 0) {
    sections.add('features');
  }

  return Array.from(sections);
}

function collectFeatureIds(structure: PRDStructure): string[] {
  return (structure.features || []).map(feature => feature.id).filter(Boolean);
}

export function buildRepairPrompt(params: {
  mode: 'generate' | 'improve';
  issueSummary: string;
  existingContent?: string;
  currentContent: string;
  currentStructure: PRDStructure;
  originalRequest: string;
  templateCategory?: string;
  language?: SupportedLanguage;
  repairHistory?: RepairHistoryEntry[];
}): string {
  const {
    mode,
    issueSummary,
    existingContent,
    currentContent,
    currentStructure,
    originalRequest,
    templateCategory,
    language,
    repairHistory,
  } = params;
  const canonicalHeadings = CANONICAL_PRD_HEADINGS.map(heading => `- ## ${heading}`).join('\n');
  const templateInstruction = buildTemplateInstruction(templateCategory, language || 'en');
  const historyBlock = formatRepairHistory(repairHistory || []);
  const allowedSections = collectRepairSectionKeys(currentStructure);
  const protectedFeatureIds = collectFeatureIds(currentStructure);
  const allowedScopeBlock = [
    'ALLOWED CHANGE SCOPE:',
    `- Sections that may be edited to fix the listed issues: ${allowedSections.join(', ') || '(none)'}`,
    `- Feature IDs that must remain present and in the same order: ${protectedFeatureIds.join(', ') || '(none)'}`,
  ].join('\n');

  if (mode === 'improve') {
    return `The previous PRD output failed quality gates and must be repaired.

QUALITY ISSUES:
${issueSummary}
${historyBlock}
${allowedScopeBlock}

BASELINE PRD (must remain intact unless directly improved):
${existingContent || '(no baseline provided)'}

CURRENT INCOMPLETE OUTPUT:
${currentContent}

ORIGINAL REQUEST:
${originalRequest}

Return a COMPLETE corrected PRD in Markdown.

STRICT OUTPUT RULES:
- Use only this top-level heading set exactly once each (H2):
${canonicalHeadings}
- Follow this template context:
${templateInstruction}
- Do not add any extra top-level sections.
- Only modify sections directly needed to resolve the listed issues.
- Keep existing feature IDs stable and preserve baseline content unless directly improved.
- Keep all existing feature IDs present and in the same order.
- Resolve repeated boilerplate phrasing so each feature spec stays concrete and unique.
- Remove prompt/meta artifacts (e.g., Iteration X, Questions Identified, Answer:, Reasoning:, ORIGINAL PRD, REVIEW FEEDBACK).
- Target language: ${language || 'en'}. Write ALL body content in this language. Keep only the canonical H2 headings in English.
- In "Domain Model", keep technical entity, field, API, and schema identifiers in their canonical code form if needed; only the explanatory prose around them must follow the target language.
- No truncation, placeholders, or unfinished bullets/sentences.`;
  }

  return `The previous PRD output failed quality gates and must be repaired.

QUALITY ISSUES:
${issueSummary}
${historyBlock}
${allowedScopeBlock}

CURRENT INCOMPLETE OUTPUT:
${currentContent}

ORIGINAL REQUEST:
${originalRequest}

Return a COMPLETE corrected PRD in Markdown.

STRICT OUTPUT RULES:
- Use only this top-level heading set exactly once each (H2):
${canonicalHeadings}
- Follow this template context:
${templateInstruction}
- Do not add any extra top-level sections.
- Only modify sections directly needed to resolve the listed issues.
- Keep all existing feature IDs present and in the same order.
- Resolve repeated boilerplate phrasing so each feature spec stays concrete and unique.
- Remove prompt/meta artifacts (e.g., Iteration X, Questions Identified, Answer:, Reasoning:, ORIGINAL PRD, REVIEW FEEDBACK).
- Target language: ${language || 'en'}. Write ALL body content in this language. Keep only the canonical H2 headings in English.
- In "Domain Model", keep technical entity, field, API, and schema identifiers in their canonical code form if needed; only the explanatory prose around them must follow the target language.
- No truncation, placeholders, or unfinished bullets/sentences.`;
}
