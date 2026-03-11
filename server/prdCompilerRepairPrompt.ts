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

// ÄNDERUNG 09.03.2026: Maximale Zeichenanzahl für den aktuellen PRD-Inhalt im Repair-Prompt.
// Bei sehr langen Dokumenten (>20 Features) würden Free-Tier-Modelle truncaten, was zu
// Placeholder-Feldern führt und den Repair ablehnt. Truncation verhindert dieses Kaskaden.
const MAX_REPAIR_CURRENT_CONTENT_CHARS = 12000;

function truncateRepairContent(content: string, maxChars: number): { text: string; truncated: boolean } {
  if (content.length <= maxChars) return { text: content, truncated: false };
  // Schneide an einer sauberen Feature-Grenze ab, nicht mitten in einem Feature
  const truncated = content.slice(0, maxChars);
  const lastFeatureBreak = truncated.lastIndexOf('\n### F-');
  const cutPoint = lastFeatureBreak > maxChars * 0.7 ? lastFeatureBreak : maxChars;
  return {
    text: content.slice(0, cutPoint) + '\n\n[...more features present in original - all feature IDs and sections from ALLOWED CHANGE SCOPE retained...]',
    truncated: true,
  };
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
  const { text: safeCurrentContent, truncated: contentTruncated } = truncateRepairContent(
    currentContent,
    MAX_REPAIR_CURRENT_CONTENT_CHARS
  );
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
${safeCurrentContent}

ORIGINAL REQUEST:
${originalRequest}

Return a COMPLETE corrected PRD in Markdown.${contentTruncated ? '\nNOTE: The current output above was truncated for brevity. You MUST output ALL feature IDs listed in the scope block above — do not skip any.' : ''}

STRICT OUTPUT RULES:
- Use only this top-level heading set exactly once each (H2):
${canonicalHeadings}
- Follow this template context:
${templateInstruction}
- Feature headings MUST use canonical syntax: "### F-01: Feature Name"
- Feature body ID lines MUST use canonical syntax: "Feature ID: F-01"
- Never output non-canonical feature IDs such as F001 or F01.
- Never use en-dash heading variants as the canonical feature heading form.
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
${safeCurrentContent}

ORIGINAL REQUEST:
${originalRequest}

Return a COMPLETE corrected PRD in Markdown.${contentTruncated ? '\nNOTE: The current output above was truncated for brevity. You MUST output ALL feature IDs listed in the scope block above — do not skip any.' : ''}

STRICT OUTPUT RULES:
- Use only this top-level heading set exactly once each (H2):
${canonicalHeadings}
- Follow this template context:
${templateInstruction}
- Feature headings MUST use canonical syntax: "### F-01: Feature Name"
- Feature body ID lines MUST use canonical syntax: "Feature ID: F-01"
- Never output non-canonical feature IDs such as F001 or F01.
- Never use en-dash heading variants as the canonical feature heading form.
- Do not add any extra top-level sections.
- Only modify sections directly needed to resolve the listed issues.
- Keep all existing feature IDs present and in the same order.
- Resolve repeated boilerplate phrasing so each feature spec stays concrete and unique.
- Remove prompt/meta artifacts (e.g., Iteration X, Questions Identified, Answer:, Reasoning:, ORIGINAL PRD, REVIEW FEEDBACK).
- Target language: ${language || 'en'}. Write ALL body content in this language. Keep only the canonical H2 headings in English.
- In "Domain Model", keep technical entity, field, API, and schema identifiers in their canonical code form if needed; only the explanatory prose around them must follow the target language.
- No truncation, placeholders, or unfinished bullets/sentences.`;
}
