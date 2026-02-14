import type { PRDStructure } from './prdStructure';
import type { OpenRouterClient } from './openrouter';

const SECTION_KEYWORDS: Record<string, keyof PRDStructure> = {
  'vision': 'systemVision',
  'system vision': 'systemVision',
  'boundaries': 'systemBoundaries',
  'system boundaries': 'systemBoundaries',
  'domain model': 'domainModel',
  'business rules': 'globalBusinessRules',
  'global business rules': 'globalBusinessRules',
  'non-functional': 'nonFunctional',
  'nonfunctional': 'nonFunctional',
  'non functional': 'nonFunctional',
  'error handling': 'errorHandling',
  'error recovery': 'errorHandling',
  'deployment': 'deployment',
  'infrastructure': 'deployment',
  'definition of done': 'definitionOfDone',
};

const SECTION_DISPLAY_NAMES: Partial<Record<keyof PRDStructure, string>> = {
  systemVision: 'System Vision',
  systemBoundaries: 'System Boundaries',
  domainModel: 'Domain Model',
  globalBusinessRules: 'Global Business Rules',
  nonFunctional: 'Non-Functional Requirements',
  errorHandling: 'Error Handling & Recovery',
  deployment: 'Deployment & Infrastructure',
  definitionOfDone: 'Definition of Done',
};

export function detectTargetSection(reviewText: string): keyof PRDStructure | null {
  const lower = reviewText.toLowerCase();

  let bestMatch: keyof PRDStructure | null = null;
  let bestLength = 0;

  for (const [keyword, sectionKey] of Object.entries(SECTION_KEYWORDS)) {
    if (lower.includes(keyword) && keyword.length > bestLength) {
      bestMatch = sectionKey;
      bestLength = keyword.length;
    }
  }

  if (bestMatch) {
    const featurePatterns = [/\bf-\d{2}\b/i, /\bfeature\s+(spec|catalogue|catalog)\b/i];
    const hasFeatureContext = featurePatterns.some(p => p.test(lower));
    if (hasFeatureContext) {
      return null;
    }
  }

  return bestMatch;
}

const SECTION_REGEN_SYSTEM_PROMPT = `You are a senior product architect specializing in PRD section refinement.

RULES:
- Regenerate ONLY the specific section provided
- Do not modify, reference, or regenerate any other sections
- Incorporate the reviewer feedback directly into the section content
- Maintain professional product management language
- Output ONLY the section content (no headings, no preamble, no meta-commentary)
- Do not wrap output in markdown code blocks
- Do not add section titles — return raw section body only`;

export async function regenerateSection(
  sectionName: keyof PRDStructure,
  currentStructure: PRDStructure,
  feedback: string,
  visionContext: string,
  client: OpenRouterClient,
  langInstruction: string = ''
): Promise<string> {
  const currentContent = currentStructure[sectionName];
  const displayName = SECTION_DISPLAY_NAMES[sectionName] || sectionName;

  if (typeof currentContent !== 'string' || !currentContent.trim()) {
    throw new Error(`Section "${sectionName}" has no content to regenerate`);
  }

  const userPrompt = `SECTION TO REGENERATE: ${displayName}

CURRENT SECTION CONTENT:
${currentContent.trim()}

SYSTEM VISION (for context only — do NOT regenerate this):
${visionContext}

REVIEWER FEEDBACK TO INCORPORATE:
${feedback}

Regenerate ONLY the "${displayName}" section content. Incorporate the feedback. Output the improved section body only.`;

  const result = await client.callWithFallback(
    'reviewer',
    SECTION_REGEN_SYSTEM_PROMPT + langInstruction,
    userPrompt,
    2000
  );

  const content = result.content.trim();
  if (content.length < 20) {
    throw new Error(`Section regeneration produced insufficient content (${content.length} chars)`);
  }

  console.log(`📝 Section "${displayName}" regenerated: ${result.usage.completion_tokens} tokens using ${result.model}`);
  return content;
}
