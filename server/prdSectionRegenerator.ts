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
  { regex: /system\s*kontext/i, sectionKey: 'systemVision', weight: 10 },
  { regex: /zielbild/i, sectionKey: 'systemVision', weight: 7 },
  { regex: /problem\s*statement/i, sectionKey: 'systemVision', weight: 6 },
  { regex: /\bvision\b/i, sectionKey: 'systemVision', weight: 5 },
  { regex: /system\s*boundaries/i, sectionKey: 'systemBoundaries', weight: 10 },
  { regex: /system\s*grenzen/i, sectionKey: 'systemBoundaries', weight: 10 },
  { regex: /abgrenzung/i, sectionKey: 'systemBoundaries', weight: 8 },
  { regex: /target\s*audience/i, sectionKey: 'systemBoundaries', weight: 6 },
  { regex: /\bboundaries\b/i, sectionKey: 'systemBoundaries', weight: 5 },
  { regex: /\bdomain\s*model\b/i, sectionKey: 'domainModel', weight: 10 },
  { regex: /dom[aä]nen\s*modell/i, sectionKey: 'domainModel', weight: 10 },
  { regex: /daten\s*modell/i, sectionKey: 'domainModel', weight: 8 },
  { regex: /global\s*business\s*rules/i, sectionKey: 'globalBusinessRules', weight: 10 },
  { regex: /gesch[aä]fts\s*regeln/i, sectionKey: 'globalBusinessRules', weight: 10 },
  { regex: /\bbusiness\s*rules\b/i, sectionKey: 'globalBusinessRules', weight: 7 },
  { regex: /non[- ]?functional/i, sectionKey: 'nonFunctional', weight: 10 },
  { regex: /nicht[\s-]*funktional/i, sectionKey: 'nonFunctional', weight: 10 },
  { regex: /qualit[aä]ts[\s-]*anforder/i, sectionKey: 'nonFunctional', weight: 8 },
  { regex: /\bnfr\b/i, sectionKey: 'nonFunctional', weight: 6 },
  { regex: /\berror\s*handling\b/i, sectionKey: 'errorHandling', weight: 10 },
  { regex: /fehler\s*behandlung/i, sectionKey: 'errorHandling', weight: 10 },
  { regex: /wiederherstellung/i, sectionKey: 'errorHandling', weight: 8 },
  { regex: /\berror\s*recovery\b/i, sectionKey: 'errorHandling', weight: 8 },
  { regex: /\bdeployment\b/i, sectionKey: 'deployment', weight: 7 },
  { regex: /bereitstellung/i, sectionKey: 'deployment', weight: 7 },
  { regex: /betrieb/i, sectionKey: 'deployment', weight: 5 },
  { regex: /\binfrastructure\b/i, sectionKey: 'deployment', weight: 5 },
  { regex: /definition\s*of\s*done/i, sectionKey: 'definitionOfDone', weight: 10 },
  { regex: /abnahme\s*kriterien/i, sectionKey: 'definitionOfDone', weight: 8 },
  { regex: /out\s*of\s*scope/i, sectionKey: 'outOfScope', weight: 10 },
  { regex: /au[ßs]erhalb\s*(?:des|vom)?\s*scope/i, sectionKey: 'outOfScope', weight: 10 },
  { regex: /timeline/i, sectionKey: 'timelineMilestones', weight: 8 },
  { regex: /zeitplan/i, sectionKey: 'timelineMilestones', weight: 8 },
  { regex: /milestones?/i, sectionKey: 'timelineMilestones', weight: 8 },
  { regex: /meilensteine?/i, sectionKey: 'timelineMilestones', weight: 8 },
  { regex: /success\s*criteria/i, sectionKey: 'successCriteria', weight: 10 },
  { regex: /erfolgs\s*kriterien/i, sectionKey: 'successCriteria', weight: 10 },
  { regex: /akzeptanz\s*kriterien/i, sectionKey: 'successCriteria', weight: 8 },
  { regex: /acceptance\s*testing/i, sectionKey: 'successCriteria', weight: 7 },
  { regex: /akzeptanz\s*test/i, sectionKey: 'successCriteria', weight: 7 },
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
  outOfScope: 'Out of Scope',
  timelineMilestones: 'Timeline & Milestones',
  successCriteria: 'Success Criteria & Acceptance Testing',
};

const DISPLAY_NAME_TO_KEY: Record<string, keyof PRDStructure> = {};
for (const [key, name] of Object.entries(SECTION_DISPLAY_NAMES)) {
  DISPLAY_NAME_TO_KEY[name.toLowerCase()] = key as keyof PRDStructure;
}

const EXPLICIT_SECTION_ALIASES: Array<{ key: keyof PRDStructure; aliases: RegExp[] }> = [
  { key: 'systemVision', aliases: [/^system\s*vision$/, /^vision$/, /^system\s*kontext$/, /^zielbild$/, /^problem\s*statement$/] },
  { key: 'systemBoundaries', aliases: [/^system\s*boundaries$/, /^boundaries$/, /^system\s*grenzen$/, /^abgrenzung$/, /^scope$/, /^target\s*audience$/] },
  { key: 'domainModel', aliases: [/^domain\s*model$/, /^data\s*model$/, /^dom[aä]nen\s*modell$/, /^daten\s*modell$/] },
  { key: 'globalBusinessRules', aliases: [/^global\s*business\s*rules$/, /^business\s*rules$/, /^gesch[aä]fts\s*regeln$/] },
  { key: 'nonFunctional', aliases: [/^non[\s-]*functional(?:\s*requirements)?$/, /^nfr$/, /^qualit[aä]ts[\s-]*anforderungen$/, /^nicht[\s-]*funktionale?\s*anforderungen$/] },
  { key: 'errorHandling', aliases: [/^error\s*handling(?:\s*&\s*recovery)?$/, /^fehler\s*behandlung(?:\s*&\s*wiederherstellung)?$/] },
  { key: 'deployment', aliases: [/^deployment(?:\s*&\s*infrastructure)?$/, /^infrastructure$/, /^bereitstellung(?:\s*&\s*infrastruktur)?$/, /^betrieb$/] },
  { key: 'definitionOfDone', aliases: [/^definition\s*of\s*done$/, /^done\s*criteria$/, /^abnahme\s*kriterien$/, /^akzeptanz\s*kriterien$/] },
  { key: 'outOfScope', aliases: [/^out\s*of\s*scope$/, /^au[ßs]erhalb\s*(?:des|vom)?\s*scope$/] },
  { key: 'timelineMilestones', aliases: [/^timeline(?:\s*&\s*milestones?)?$/, /^milestones?$/, /^zeitplan(?:\s*&\s*meilensteine?)?$/, /^meilensteine?$/] },
  { key: 'successCriteria', aliases: [/^success\s*criteria(?:\s*&\s*acceptance\s*testing)?$/, /^acceptance\s*testing$/, /^erfolgs\s*kriterien(?:\s*&\s*akzeptanz\s*tests?)?$/, /^akzeptanz\s*kriterien$/, /^akzeptanz\s*tests?$/] },
];

function normalizeSectionLabel(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß\s&-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveExplicitSectionKey(value: string): keyof PRDStructure | null {
  const normalized = normalizeSectionLabel(value);
  if (!normalized) return null;

  const displayMapped = DISPLAY_NAME_TO_KEY[normalized];
  if (displayMapped) return displayMapped;

  for (const alias of EXPLICIT_SECTION_ALIASES) {
    if (alias.aliases.some(pattern => pattern.test(normalized))) {
      return alias.key;
    }
  }

  return null;
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
    const mappedKey = resolveExplicitSectionKey(match[1]);
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

  const featurePatterns = [
    /\bf-\d{2,}\b/i,
    /\bfeature\s+(spec|catalogue|catalog)\b/i,
    /\b(?:feature|funktion)[\s-]*(?:katalog|catalog(?:ue)?|spezifikation)\b/i,
  ];
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

const MIN_CONTENT_LENGTH = 20;

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
  if (content.length < MIN_CONTENT_LENGTH) {
    throw new Error(`Section regeneration produced insufficient content (actual ${content.length} chars, expected >= ${MIN_CONTENT_LENGTH} chars)`);
  }

  logger.debug('Section regeneration completed', {
    sectionName: displayName,
    completionTokens: result.usage.completion_tokens,
    model: result.model,
  });
  return content;
}
