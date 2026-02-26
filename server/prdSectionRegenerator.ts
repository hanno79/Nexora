import type { PRDStructure } from './prdStructure';
import type { OpenRouterClient } from './openrouter';
import { logger } from './logger';

interface SectionPattern {
  regex: RegExp;
  sectionKey: keyof PRDStructure;
  weight: number;
}

const SECTION_PATTERNS: SectionPattern[] = [
  { regex: /system\s*vision/i, sectionKey: 'systemVision', weight: 10 },
  { regex: /\bvision\b/i, sectionKey: 'systemVision', weight: 5 },
  { regex: /system\s*boundaries/i, sectionKey: 'systemBoundaries', weight: 10 },
  { regex: /\bboundaries\b/i, sectionKey: 'systemBoundaries', weight: 5 },
  { regex: /\bdomain\s*model\b/i, sectionKey: 'domainModel', weight: 10 },
  { regex: /global\s*business\s*rules/i, sectionKey: 'globalBusinessRules', weight: 10 },
  { regex: /\bbusiness\s*rules\b/i, sectionKey: 'globalBusinessRules', weight: 7 },
  { regex: /non[- ]?functional/i, sectionKey: 'nonFunctional', weight: 10 },
  { regex: /\berror\s*handling\b/i, sectionKey: 'errorHandling', weight: 10 },
  { regex: /\berror\s*recovery\b/i, sectionKey: 'errorHandling', weight: 8 },
  { regex: /\bdeployment\b/i, sectionKey: 'deployment', weight: 7 },
  { regex: /\binfrastructure\b/i, sectionKey: 'deployment', weight: 5 },
  { regex: /definition\s*of\s*done/i, sectionKey: 'definitionOfDone', weight: 10 },
];

const EXPLICIT_SECTION_REGEX = /(?:section|abschnitt|bereich)\s*[:\-–]?\s*["']?([^"'\n,]+)["']?/gi;

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

const DISPLAY_NAME_TO_KEY: Record<string, keyof PRDStructure> = {};
for (const [key, name] of Object.entries(SECTION_DISPLAY_NAMES)) {
  DISPLAY_NAME_TO_KEY[name.toLowerCase()] = key as keyof PRDStructure;
}

interface DetectTargetSectionOptions {
  allowFeatureContext?: boolean;
}

export function detectTargetSection(
  reviewText: string,
  options?: DetectTargetSectionOptions
): keyof PRDStructure | null {
  logger.debug('Section targeting started', { reviewLength: reviewText.length });

  const scoreMap: Map<keyof PRDStructure, number> = new Map();

  for (const pattern of SECTION_PATTERNS) {
    const matches = reviewText.match(new RegExp(pattern.regex, 'gi'));
    if (matches) {
      const current = scoreMap.get(pattern.sectionKey) || 0;
      scoreMap.set(pattern.sectionKey, current + pattern.weight * matches.length);
    }
  }

  let match: RegExpExecArray | null;
  while ((match = EXPLICIT_SECTION_REGEX.exec(reviewText)) !== null) {
    const namedSection = match[1].trim().toLowerCase();
    const mappedKey = DISPLAY_NAME_TO_KEY[namedSection];
    if (mappedKey) {
      const current = scoreMap.get(mappedKey) || 0;
      scoreMap.set(mappedKey, current + 20);
      logger.debug('Section targeting explicit section match', {
        sectionKey: String(mappedKey),
      });
    }
  }

  if (scoreMap.size === 0) {
    logger.warn('Section targeting found no matching section; using full regeneration fallback');
    return null;
  }

  const sorted = Array.from(scoreMap.entries()).sort((a, b) => b[1] - a[1]);
  logger.debug('Section targeting scores computed', {
    topSection: String(sorted[0][0]),
    topScore: sorted[0][1],
  });

  const bestKey = sorted[0][0];
  const bestScore = sorted[0][1];

  const featurePatterns = [/\bf-\d{2}\b/i, /\bfeature\s+(spec|catalogue|catalog)\b/i];
  const hasFeatureContext = featurePatterns.some(p => p.test(reviewText));
  const allowFeatureContext = options?.allowFeatureContext === true;
  if (hasFeatureContext && !allowFeatureContext) {
    logger.debug('Section targeting skipped because feature context was detected');
    return null;
  }
  if (hasFeatureContext && allowFeatureContext) {
    logger.debug('Section targeting feature context allowed (freeze patch mode)');
  }

  const displayName = (SECTION_DISPLAY_NAMES as Record<string, string>)[bestKey as string] || String(bestKey);
  logger.debug('Section targeting selected section', {
    sectionName: displayName,
    sectionKey: String(bestKey),
    confidence: bestScore,
  });
  return bestKey;
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
  const normalizedCurrentContent = typeof currentContent === 'string' ? currentContent.trim() : '';
  const sectionContext = normalizedCurrentContent.length > 0
    ? normalizedCurrentContent
    : '(This section is currently empty and must be created from reviewer feedback and system vision.)';

  const userPrompt = `SECTION TO REGENERATE: ${displayName}

CURRENT SECTION CONTENT:
${sectionContext}

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

  logger.debug('Section regeneration completed', {
    sectionName: displayName,
    completionTokens: result.usage.completion_tokens,
    model: result.model,
  });
  return content;
}
