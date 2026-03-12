/**
 * PRD Content Reviewer - Post-Compiler Content-Quality Review & Refinement
 *
 * Runs AFTER the structural compiler and repair loop. Checks for:
 * - Cross-section repetition (near-identical text in different sections)
 * - Compiler fallback filler (generic text inserted by ensurePrdRequiredSections)
 * - AI-typical phrasing (generic boilerplate language)
 * - Project-specificity (does the section reference actual features/domain?)
 *
 * If issues are found, an AI model rewrites the affected sections
 * with project-specific content derived from the Feature Catalogue.
 */

// ÄNDERUNG 07.03.2026: Semantische Feature-Prüfung und Feature-Placeholder-Enrichment ergänzt
// Formal gefüllte, aber inhaltlich falsch zugeordnete Features werden jetzt gezielt umgeschrieben
// ÄNDERUNG 10.03.2026: Vision-/Timeline-Cluster im gezielten Semantic-Repair geschaerft
// Fruehe Kernfeatures werden jetzt gemeinsam mit System Vision und Timeline priorisiert, damit feature/simple bei Vision-/Support-/Timeline-Konflikten stabiler repariert wird

import type { PRDStructure } from './prdStructure';
import type { TokenUsage } from '@shared/schema';
import {
  buildTemplateInstruction,
  getTemplateProfile,
  isGenericFallback,
  type RequiredSectionKey,
} from './prdTemplateIntent';
import { tokenizeToSet, jaccardSimilarity, normalizeForMatch } from './prdTextUtils';
import { parsePRDToStructure } from './prdParser';
import { assembleStructureToMarkdown } from './prdAssembler';
import {
  collectDeterministicSemanticIssues,
  type DeterministicSemanticIssue,
} from './prdDeterministicSemanticLints';
import {
  analyzeFeatureSemanticIssues,
  extractFeatureTargetFields,
  FEATURE_ENRICHABLE_FIELDS,
  type FeatureEnrichableField,
  isFeatureForceRewriteIssue,
} from './prdFeatureSemantics';
import { CANONICAL_PRD_HEADINGS } from './prdCompiler';
import { logger } from './logger';

type SupportedLanguage = 'de' | 'en';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ContentIssue {
  code: string;
  sectionKey: string;
  message: string;
  severity: 'error' | 'warning';
  suggestedAction: 'rewrite' | 'expand' | 'enrich' | 'keep';
  targetFields?: FeatureEnrichableField[];
  suggestedFix?: string;
}

export interface SectionQualityScore {
  specificity: number;   // 0-100: How project-specific is the text?
  depth: number;         // 0-100: How detailed/structured is the text?
  uniqueness: number;    // 0-100: How unique vs. other sections?
  aiPhrasing: number;    // 0-100: 100 = no AI phrases, 0 = full AI boilerplate
  overall: number;       // Weighted average adjusted by aiPhrasing
}

export interface ContentReviewResult {
  issues: ContentIssue[];
  overallScore: number;
  sectionsToRewrite: string[];
  sectionScores: Record<string, SectionQualityScore>;
}

export interface ContentRefineResult {
  content: string;
  structure: PRDStructure;
  reviewResult: ContentReviewResult;
  refined: boolean;
  enrichedFeatureCount?: number;
  reviewerAttempts?: ReviewerRefineResult[];
}

export interface ReviewerRefineResult {
  content: string;
  model: string;
  usage: TokenUsage;
  finishReason?: string;
}

export interface TargetedContentRefineResult {
  content: string;
  structure: PRDStructure;
  refined: boolean;
  enrichedFeatureCount?: number;
  reviewerAttempts: ReviewerRefineResult[];
}

export interface SemanticPatchRefineResult {
  content: string;
  structure: PRDStructure;
  refined: boolean;
  reviewerAttempts: ReviewerRefineResult[];
  truncated: boolean;
  changedSections: string[];
  structuralChange: boolean;
}

export type ReviewerContentGenerator = (prompt: string) => Promise<ReviewerRefineResult>;

// ---------------------------------------------------------------------------
// Section keys used for pairwise comparison (non-feature, non-intro sections)
// ---------------------------------------------------------------------------

const COMPARABLE_SECTION_KEYS: RequiredSectionKey[] = [
  'systemVision',
  'systemBoundaries',
  'domainModel',
  'globalBusinessRules',
  'nonFunctional',
  'errorHandling',
  'deployment',
  'definitionOfDone',
  'outOfScope',
  'timelineMilestones',
  'successCriteria',
];

const TARGETABLE_SECTION_KEYS: Array<keyof PRDStructure> = [
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

type PatchableSectionKey = typeof TARGETABLE_SECTION_KEYS[number];

const PATCHABLE_SECTION_KEY_SET = new Set<string>(
  TARGETABLE_SECTION_KEYS.map(key => String(key))
);

const FEATURE_SEMANTIC_CLUSTER_FIELDS: FeatureEnrichableField[] = [
  'name',
  'purpose',
  'mainFlow',
  'preconditions',
  'postconditions',
  'dataImpact',
];

// ---------------------------------------------------------------------------
// Fallback-pattern detection (matches text generated by buildSectionFallback)
// ---------------------------------------------------------------------------

// Gemeinsame Compiler-/Reviewer-Fallback-Erkennung wird zentral ueber
// isGenericFallback in prdTemplateIntent.ts gehalten.

// ---------------------------------------------------------------------------
// AI-typical phrasing patterns (generic filler language)
// ---------------------------------------------------------------------------

const AI_PHRASING_PATTERNS_EN: RegExp[] = [
  /delivers a clearly scoped user capability with an observable outcome/i,
  /defines an independent,? testable workflow/i,
  /implemented as a deterministic functional unit/i,
  /reads and updates only in-scope entities/i,
  /surfaces loading,? success,? and error states.*consistently/i,
  /verifiable by end users directly in the UI without manual reload/i,
  /error paths? (?:for|of) .+ provide clear user feedback and keep state consistent/i,
  /data mutations caused by .+ are observable after execution/i,
];

const AI_PHRASING_PATTERNS_DE: RegExp[] = [
  /liefert einen klar abgegrenzten Nutzerwert mit messbarem Ergebnis/i,
  /beschreibt einen eigenst(?:ae|ä)ndigen,? testbaren Anwendungsfall/i,
  /als implementierbare Funktionseinheit mit eindeutiger Wirkung/i,
  /liest und aktualisiert nur die relevanten Entit(?:ae|ä)ten/i,
  /Oberfl(?:ae|ä)che zeigt Lade-,? Erfolg- und Fehlerzust(?:ae|ä)nde/i,
  /f(?:ue|ü)r einen Nutzer ohne manuelles Nachladen in der UI verifizierbar/i,
  /Fehlerfaelle von .+ liefern klare Nutzerhinweise/i,
  /verursachten Daten(?:ae|ä)nderungen sind nach Ausf(?:ue|ü)hrung nachvollziehbar/i,
];

// ---------------------------------------------------------------------------
// General AI filler phrases (common LLM boilerplate, not compiler-specific)
// ---------------------------------------------------------------------------

const GENERAL_AI_FILLER_PATTERNS: RegExp[] = [
  /\bleverage\s+(?:existing|the)\b/i,
  /\brobust\s+and\s+scalable\b/i,
  /\bseamless(?:ly)?\s+integrat/i,
  /\bintuitive\s+user\s+experience\b/i,
  /\bstate[- ]of[- ]the[- ]art\b/i,
  /\bensure(?:s)?\s+(?:a\s+)?smooth\b/i,
  /\bcomprehensive\s+(?:set|suite|range|solution)\b/i,
  /\bstreamline(?:s|d)?\s+(?:the\s+)?(?:process|workflow|operation)/i,
  /\bnahtlos(?:e[rns]?)?\s+Integr/i,
  /\brobust(?:e[rns]?)?\s+und\s+skalierbar/i,
  /\bintuitive[rns]?\s+Benutzer(?:erfahrung|erlebnis)/i,
  /\bumfassend(?:e[rns]?)?\s+(?:Loesung|L(?:ö|oe)sung)/i,
];

// All AI phrasing patterns combined (for scoring)
const ALL_AI_PATTERNS: RegExp[] = [
  ...AI_PHRASING_PATTERNS_EN,
  ...AI_PHRASING_PATTERNS_DE,
  ...GENERAL_AI_FILLER_PATTERNS,
];

// tokenizeToSet and jaccardSimilarity imported from prdTextUtils

// ---------------------------------------------------------------------------
// Helper: extract feature names for specificity check
// ---------------------------------------------------------------------------

function extractProjectTerms(structure: PRDStructure): Set<string> {
  const terms = new Set<string>();
  for (const feature of structure.features || []) {
    const name = String(feature.name || '').toLowerCase();
    for (const word of name.split(/\s+/)) {
      if (word.length >= 4) terms.add(word);
    }
    const id = String(feature.id || '').toLowerCase();
    if (id) terms.add(id);
  }
  // Add terms from system vision (domain-specific keywords)
  const vision = String(structure.systemVision || '').toLowerCase();
  for (const word of vision.split(/[\s,.;:!?]+/)) {
    if (word.length >= 5) terms.add(word);
  }
  return terms;
}

function sectionSpecificityScore(text: string, projectTerms: Set<string>): number {
  if (!text.trim() || projectTerms.size === 0) return 0;
  const words = text.toLowerCase().split(/[\s,.;:!?]+/).filter(w => w.length >= 4);
  if (words.length === 0) return 0;
  const hits = words.filter(w => projectTerms.has(w)).length;
  return Math.min(100, Math.round((hits / words.length) * 400));
}

// ---------------------------------------------------------------------------
// Per-section quality scoring
// ---------------------------------------------------------------------------

const DEFAULT_QUALITY_WEIGHTS = { specificity: 25, uniqueness: 25, depth: 50 };

function scoreSectionQuality(
  text: string,
  key: string,
  projectTerms: Set<string>,
  allSectionTokens: Map<string, Set<string>>,
  weights: { specificity: number; uniqueness: number; depth: number }
): SectionQualityScore {
  // Specificity: reuse existing scorer
  const specificity = sectionSpecificityScore(text, projectTerms);

  // Depth: based on word count + structural markers
  const words = text.split(/\s+/).length;
  const hasBullets = /^[\-\*•]/m.test(text);
  const hasNumbers = /\b\d+\b/.test(text);
  const depth = Math.min(100, Math.round(
    (Math.min(words, 200) / 200) * 60 +
    (hasBullets ? 20 : 0) +
    (hasNumbers ? 20 : 0)
  ));

  // Uniqueness: 100 minus max Jaccard similarity to any other section
  const myTokens = allSectionTokens.get(key);
  let maxSimilarity = 0;
  if (myTokens) {
    for (const [otherKey, otherTokens] of allSectionTokens) {
      if (otherKey === key) continue;
      const sim = jaccardSimilarity(myTokens, otherTokens);
      maxSimilarity = Math.max(maxSimilarity, sim);
    }
  }
  const uniqueness = Math.round((1 - maxSimilarity) * 100);

  // AI phrasing: 100 minus penalty per pattern hit
  const hitCount = ALL_AI_PATTERNS.filter(p => p.test(text)).length;
  const aiPhrasing = Math.max(0, 100 - hitCount * 20);

  // Weighted average of specificity, depth, uniqueness
  const total = weights.specificity + weights.uniqueness + weights.depth;
  const baseOverall = total > 0
    ? Math.round(
        (specificity * weights.specificity +
         depth * weights.depth +
         uniqueness * weights.uniqueness) / total
      )
    : Math.round((specificity + depth + uniqueness) / 3);

  // Apply aiPhrasing as a multiplier (boilerplate reduces overall)
  const overall = Math.round(baseOverall * (aiPhrasing / 100));

  return { specificity, depth, uniqueness, aiPhrasing, overall };
}

// ---------------------------------------------------------------------------
// Core: Deterministic content analysis (no AI needed)
// ---------------------------------------------------------------------------

export function analyzeContentQuality(
  structure: PRDStructure,
  options?: {
    templateCategory?: string;
    fallbackSections?: string[];
  }
): ContentReviewResult {
  const issues: ContentIssue[] = [];
  const sectionsToRewrite = new Set<string>();
  const projectTerms = extractProjectTerms(structure);

  // 1. Check for compiler-generated fallback filler
  // Use the explicit list of fallback-filled sections (from ensurePrdRequiredSections
  // and ensurePrdSectionDepth) as primary signal; regex as secondary safety net.
  const knownFallbackSections = new Set(options?.fallbackSections || []);
  const sectionLabelToKey = new Map<string, RequiredSectionKey>();
  for (const key of COMPARABLE_SECTION_KEYS) {
    // Match both the section key and common heading labels to the key
    sectionLabelToKey.set(key, key);
  }

  for (const key of COMPARABLE_SECTION_KEYS) {
    const text = String((structure as any)[key] || '').trim();
    if (!text) continue;

    // Primary: check if this section was explicitly filled by fallback pipeline
    const isFallbackFilled = knownFallbackSections.has(key)
      || [...knownFallbackSections].some(label =>
        label.toLowerCase().replace(/[^a-z]/g, '').includes(key.toLowerCase().replace(/[^a-z]/g, ''))
        || key.toLowerCase().replace(/[^a-z]/g, '').includes(label.toLowerCase().replace(/[^a-z]/g, ''))
      );

    // Secondary: gemeinsame Fallback-Erkennung fuer Legacy-, Compiler- und
    // Template-Opener (single source of truth)
    const matchesRegex = isGenericFallback(text);

    if (isFallbackFilled || matchesRegex) {
      issues.push({
        code: 'compiler_fallback_filler',
        sectionKey: key,
        message: `Section "${key}" contains compiler-generated fallback text that is not project-specific.`,
        severity: 'error',
        suggestedAction: 'rewrite',
      });
      sectionsToRewrite.add(key);
    }
  }

  // 2. Cross-section similarity check
  const sectionTexts = new Map<string, { text: string; tokens: Set<string> }>();
  for (const key of COMPARABLE_SECTION_KEYS) {
    const text = String((structure as any)[key] || '').trim();
    if (text.length >= 20) {
      sectionTexts.set(key, { text, tokens: tokenizeToSet(text) });
    }
  }

  const keys = Array.from(sectionTexts.keys());
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = sectionTexts.get(keys[i])!;
      const b = sectionTexts.get(keys[j])!;
      const similarity = jaccardSimilarity(a.tokens, b.tokens);
      if (similarity > 0.7) {
        issues.push({
          code: 'cross_section_repetition',
          sectionKey: keys[i],
          message: `Sections "${keys[i]}" and "${keys[j]}" have near-identical content (${Math.round(similarity * 100)}% similarity).`,
          severity: 'error',
          suggestedAction: 'rewrite',
        });
        sectionsToRewrite.add(keys[i]);
        sectionsToRewrite.add(keys[j]);
      }
    }
  }

  // 3. AI-phrasing detection in non-feature sections (compiler + general)
  for (const key of COMPARABLE_SECTION_KEYS) {
    const text = String((structure as any)[key] || '').trim();
    if (!text) continue;
    const hitCount = ALL_AI_PATTERNS.filter(p => p.test(text)).length;
    if (hitCount >= 2) {
      issues.push({
        code: 'ai_phrasing_detected',
        sectionKey: key,
        message: `Section "${key}" contains ${hitCount} AI-typical boilerplate phrases.`,
        severity: 'warning',
        suggestedAction: 'rewrite',
      });
      sectionsToRewrite.add(key);
    }
  }

  // 4. AI-phrasing detection in features
  for (const feature of structure.features || []) {
    const featureTexts = [
      feature.purpose, feature.actors, feature.trigger,
      feature.preconditions, feature.postconditions,
      feature.dataImpact, feature.uiImpact,
    ].filter(Boolean).join(' ');

    const hitCount = ALL_AI_PATTERNS.filter(p => p.test(featureTexts)).length;
    if (hitCount >= 3) {
      issues.push({
        code: 'feature_ai_boilerplate',
        sectionKey: `feature:${feature.id}`,
        message: `Feature "${feature.id}: ${feature.name}" has ${hitCount} AI-generated boilerplate fields.`,
        severity: 'warning',
        suggestedAction: 'rewrite',
        targetFields: collectFeatureAiTargetFields(feature),
      });
    }
  }

  for (const issue of analyzeFeatureSemanticIssues(structure.features || [])) {
    issues.push(issue);
  }

  // 5. Feature field incompleteness — detect features with mostly empty structured fields
  const INCOMPLETE_FIELD_THRESHOLD = 5;

  for (const feature of structure.features || []) {
    const missingFields: FeatureEnrichableField[] = [];
    for (const field of FEATURE_ENRICHABLE_FIELDS) {
      const value = (feature as any)[field];
      const filled = Array.isArray(value) ? value.length > 0 : Boolean(value && String(value).trim());
      if (!filled) missingFields.push(field);
    }
    if (missingFields.length >= INCOMPLETE_FIELD_THRESHOLD) {
      issues.push({
        code: 'feature_fields_incomplete',
        sectionKey: `feature:${feature.id}`,
        message: `Feature "${feature.id}: ${feature.name}" has ${FEATURE_ENRICHABLE_FIELDS.length - missingFields.length}/${FEATURE_ENRICHABLE_FIELDS.length} fields filled. Missing: ${missingFields.join(', ')}`,
        severity: 'warning',
        suggestedAction: 'enrich',
        targetFields: missingFields,
      });
    }
  }

  // 5b. Feature content shallow — fields are filled but lack substance
  for (const feature of structure.features || []) {
    const featureNameLower = (feature.name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const featureNameWords = new Set(featureNameLower.split(/\s+/).filter(w => w.length >= 3));
    let substantialCount = 0;
    const shallowFields: FeatureEnrichableField[] = [];

    for (const field of FEATURE_ENRICHABLE_FIELDS) {
      const value = (feature as any)[field];
      let isSubstantial = false;

      if (Array.isArray(value)) {
        const minItems = field === 'mainFlow' ? 3 : field === 'acceptanceCriteria' ? 2 : 1;
        const meaningful = value.filter((entry: string) => String(entry || '').trim().length >= 10);
        isSubstantial = meaningful.length >= minItems;
      } else if (typeof value === 'string') {
        const text = value.trim();
        const minLen = field === 'purpose' ? 30 : 20;
        if (text.length >= minLen) {
          const textWords = new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length >= 3));
          const overlap = [...featureNameWords].filter(w => textWords.has(w)).length;
          const echoRatio = featureNameWords.size > 0 ? overlap / featureNameWords.size : 0;
          isSubstantial = !(echoRatio > 0.8 && text.length < 60);
        }
      }

      if (isSubstantial) {
        substantialCount++;
      } else {
        const val = (feature as any)[field];
        const filled = Array.isArray(val) ? val.length > 0 : Boolean(val && String(val).trim());
        if (filled) shallowFields.push(field);
      }
    }

    if (substantialCount < 4 && shallowFields.length > 0) {
      issues.push({
        code: 'feature_content_shallow',
        sectionKey: `feature:${feature.id}`,
        message: `Feature "${feature.id}: ${feature.name}" has ${substantialCount}/10 substantial fields. Shallow: ${shallowFields.join(', ')}`,
        severity: 'warning',
        suggestedAction: 'enrich',
        targetFields: shallowFields.filter((field): field is FeatureEnrichableField =>
          FEATURE_ENRICHABLE_FIELDS.includes(field as FeatureEnrichableField)
        ),
      });
    }
  }

  // 6. Low specificity check (sections don't reference project terms)
  for (const key of COMPARABLE_SECTION_KEYS) {
    const text = String((structure as any)[key] || '').trim();
    if (!text || text.length < 40) continue;
    const score = sectionSpecificityScore(text, projectTerms);
    if (score < 20 && !sectionsToRewrite.has(key)) {
      issues.push({
        code: 'low_specificity',
        sectionKey: key,
        message: `Section "${key}" has low project-specificity (score: ${score}/100). It may be generic filler.`,
        severity: 'warning',
        suggestedAction: 'expand',
      });
    }
  }

  // 7. Template-specific checks (via profile)
  const profile = getTemplateProfile(options?.templateCategory);
  if (profile.contentReviewHints?.requiredSectionContent) {
    for (const [sectionKey, patterns] of Object.entries(profile.contentReviewHints.requiredSectionContent)) {
      const text = String((structure as any)[sectionKey] || '').trim();
      if (!text) continue;
      const missing = (patterns as RegExp[]).filter(p => !p.test(text));
      if (missing.length > 0) {
        issues.push({
          code: 'template_content_mismatch',
          sectionKey,
          message: `Section "${sectionKey}" is missing ${missing.length} expected content pattern(s) for template "${profile.category}".`,
          severity: 'warning',
          suggestedAction: 'expand',
        });
      }
    }
  }

  // Per-section quality scoring (reuses `profile` from template-specific checks above)
  const weights = profile.contentReviewHints?.qualityWeights || DEFAULT_QUALITY_WEIGHTS;
  const allTokens = new Map<string, Set<string>>();
  for (const [k, v] of sectionTexts) allTokens.set(k, v.tokens);

  const sectionScores: Record<string, SectionQualityScore> = {};
  for (const key of COMPARABLE_SECTION_KEYS) {
    const text = String((structure as any)[key] || '').trim();
    if (!text) continue;
    sectionScores[key] = scoreSectionQuality(text, key, projectTerms, allTokens, weights);
  }

  // Overall score: average of section scores (penalty-adjusted)
  const scoreValues = Object.values(sectionScores);
  let score: number;
  if (scoreValues.length > 0) {
    const sum = scoreValues.reduce((acc, s) => acc + s.overall, 0);
    score = Math.round(sum / scoreValues.length);
  } else {
    score = 0;
  }
  // Apply issue penalties on top (errors are structural, not captured by section scores)
  for (const issue of issues) {
    score -= issue.severity === 'error' ? 8 : 2;
  }
  score = Math.max(0, Math.min(100, score));

  return {
    issues,
    overallScore: score,
    sectionsToRewrite: Array.from(sectionsToRewrite),
    sectionScores,
  };
}

// ---------------------------------------------------------------------------
// Feature enrichment: build prompt to fill empty feature fields via AI
// ---------------------------------------------------------------------------

function collectFeatureAiTargetFields(feature: PRDStructure['features'][number]): FeatureEnrichableField[] {
  const targetedFields: FeatureEnrichableField[] = [];

  for (const field of FEATURE_ENRICHABLE_FIELDS) {
    const text = Array.isArray((feature as any)[field])
      ? ((feature as any)[field] as string[]).join(' ')
      : String((feature as any)[field] || '');
    if (!text.trim()) continue;
    if (ALL_AI_PATTERNS.some(pattern => pattern.test(text))) {
      targetedFields.push(field);
    }
  }

  return targetedFields.length > 0 ? targetedFields : [...FEATURE_ENRICHABLE_FIELDS];
}

export function buildFeatureEnrichPrompt(params: {
  features: Array<{ id: string; name: string; rawContent?: string; missingFields: FeatureEnrichableField[] }>;
  projectContext: {
    systemVision: string;
    domainModel: string;
    otherFeatures: Array<{ id: string; name: string }>;
  };
  language: SupportedLanguage;
}): string {
  const { features, projectContext, language } = params;
  const langNote = language === 'de'
    ? 'Schreibe ALLE Inhalte auf Deutsch. Verwende projektspezifische Begriffe aus dem Kontext.'
    : 'Write ALL content in English. Use project-specific terms from the context.';

  const featureBlocks = features.map(f => {
    const rawSnippet = f.rawContent
      ? `\nRaw description:\n${f.rawContent.slice(0, 800)}`
      : '';
    return `### ${f.id}: ${f.name}
Target fields: ${f.missingFields.join(', ')}${rawSnippet}`;
  }).join('\n\n');

  const otherFeatureList = projectContext.otherFeatures
    .slice(0, 10)
    .map(f => `- ${f.id}: ${f.name}`)
    .join('\n');

  return `You are enriching incomplete PRD feature specifications with project-specific content.

PROJECT CONTEXT:
- Vision: ${projectContext.systemVision.slice(0, 400)}
- Domain Model: ${projectContext.domainModel.slice(0, 400)}
- Other features in this project:
${otherFeatureList}

FEATURES TO ENRICH:

${featureBlocks}

INSTRUCTIONS:
1. For each feature, generate ONLY the target fields listed above.
2. ${langNote}
3. Each field must be project-specific — reference the actual feature, its domain, and its interactions with other features.
4. Do NOT generate generic template text. Every sentence must be specific to this exact feature in this exact project.
5. If the current feature content contradicts the feature name, rewrite the requested fields so they match the feature name exactly and do not copy behavior from neighboring features.
6. Field format rules:
   - purpose: 1-2 sentences describing what this feature achieves
   - actors: Who triggers and who is affected (e.g., "User", "Admin", "Backend Service")
   - trigger: What action or event starts this feature
   - preconditions: What must be true before this feature can execute
   - mainFlow: Numbered steps (1. ..., 2. ..., etc.) — 3-6 steps
   - alternateFlows: 1-2 error/edge-case paths
   - postconditions: What state exists after successful completion
   - dataImpact: Which data entities are read, created, updated, or deleted
   - uiImpact: How the UI changes (components, states, visual feedback)
   - acceptanceCriteria: 2-4 testable criteria (use checkmark format: "- [ ] ...")

OUTPUT FORMAT:
For each feature, output a labeled block:

=== F-XX: FeatureName ===
**purpose**: ...
**actors**: ...
**trigger**: ...
**mainFlow**:
1. ...
2. ...
**acceptanceCriteria**:
- [ ] ...
- [ ] ...

Only output the fields that were listed above. Do NOT output any extra fields.`;
}

export function parseFeatureEnrichResponse(
  response: string,
  featureIds: string[]
): Map<string, Record<string, string | string[]>> {
  const enriched = new Map<string, Record<string, string | string[]>>();
  const allowedIds = new Set(featureIds.map(id => id.toUpperCase()));
  const featureBlocks = response.split(/^===\s*/m).filter(Boolean);

  for (const block of featureBlocks) {
    // Match feature ID from block header
    const idMatch = block.match(/^(F-\d+)/i);
    if (!idMatch) continue;
    const fId = idMatch[1].toUpperCase();
    if (!allowedIds.has(fId)) continue;

    const fields: Record<string, string | string[]> = {};

    for (const fieldName of FEATURE_ENRICHABLE_FIELDS) {
      // Match **fieldName**: content or **fieldName**:\n content
      const pattern = new RegExp(
        `\\*\\*${fieldName}\\*\\*:\\s*([\\s\\S]*?)(?=\\*\\*(?:${FEATURE_ENRICHABLE_FIELDS.join('|')})\\*\\*:|===\\s*F-|$)`,
        'i'
      );
      const match = block.match(pattern);
      if (!match) continue;

      const raw = match[1].trim();
      if (!raw) continue;

      // Array fields: mainFlow, alternateFlows, acceptanceCriteria
      if (fieldName === 'mainFlow' || fieldName === 'alternateFlows' || fieldName === 'acceptanceCriteria') {
        const steps = raw
          .split(/\n/)
          .map(line => line.replace(/^\d+\.\s*/, '').replace(/^-\s*\[.\]\s*/, '').replace(/^-\s*/, '').trim())
          .filter(line => line.length > 5);
        if (steps.length > 0) fields[fieldName] = steps;
      } else {
        fields[fieldName] = raw;
      }
    }

    if (Object.keys(fields).length > 0) {
      enriched.set(fId, fields);
    }
  }

  return enriched;
}

function normalizeSectionValue(value: unknown): string {
  return normalizeForMatch(String(value || ''));
}

function normalizeFeatureFieldValue(
  feature: PRDStructure['features'][number],
  field: FeatureEnrichableField
): string {
  const value = (feature as any)[field];
  if (Array.isArray(value)) {
    return value.map(entry => normalizeForMatch(String(entry || ''))).join('|');
  }
  return normalizeForMatch(String(value || ''));
}

function featureHasStructuredContent(feature: PRDStructure['features'][number]): boolean {
  return FEATURE_ENRICHABLE_FIELDS.some(field => field !== 'name' && normalizeFeatureFieldValue(feature, field).length > 0);
}

function normalizeOtherSectionsForGuard(otherSections: Record<string, string>): string {
  return Object.entries(otherSections || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${normalizeForMatch(value)}`)
    .join('|');
}

function isFeatureTargeted(issue: ContentIssue): boolean {
  return issue.sectionKey.startsWith('feature:') && issue.suggestedAction !== 'keep';
}

function resolveFeatureTargetFields(issue: ContentIssue) {
  if (issue.targetFields && issue.targetFields.length > 0) {
    return Array.from(new Set(issue.targetFields));
  }
  const fromMessage = extractFeatureTargetFields(issue.message);
  if (fromMessage.length > 0) return fromMessage;
  return [...FEATURE_ENRICHABLE_FIELDS];
}

function validateTargetedRefinement(params: {
  original: PRDStructure;
  refined: PRDStructure;
  allowedSections: string[];
}): boolean {
  const allowedSections = new Set(params.allowedSections);

  if (normalizeOtherSectionsForGuard(params.original.otherSections || {}) !== normalizeOtherSectionsForGuard(params.refined.otherSections || {})) {
    return false;
  }

  for (const key of TARGETABLE_SECTION_KEYS) {
    if (allowedSections.has(String(key))) continue;
    if (normalizeSectionValue((params.original as any)[key]) !== normalizeSectionValue((params.refined as any)[key])) {
      return false;
    }
  }

  const originalFeatures = params.original.features || [];
  const refinedFeatures = params.refined.features || [];
  if (originalFeatures.length !== refinedFeatures.length) return false;

  for (let index = 0; index < originalFeatures.length; index++) {
    const originalFeature = originalFeatures[index];
    const refinedFeature = refinedFeatures[index];
    if (!refinedFeature || originalFeature.id !== refinedFeature.id) return false;
    if (normalizeForMatch(String(originalFeature.name || '')) !== normalizeForMatch(String(refinedFeature.name || ''))) {
      return false;
    }

    for (const field of FEATURE_ENRICHABLE_FIELDS) {
      if (normalizeFeatureFieldValue(originalFeature, field) !== normalizeFeatureFieldValue(refinedFeature, field)) {
        return false;
      }
    }

    const originalHasStructuredContent = featureHasStructuredContent(originalFeature);
    const refinedHasStructuredContent = featureHasStructuredContent(refinedFeature);
    if (originalHasStructuredContent !== refinedHasStructuredContent) {
      return false;
    }

    if (
      !originalHasStructuredContent
      && normalizeForMatch(String(originalFeature.rawContent || '')) !== normalizeForMatch(String(refinedFeature.rawContent || ''))
    ) {
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Semantic repair: targeted JSON patches for verifier blocking issues
// ---------------------------------------------------------------------------

type SemanticRepairTarget =
  | {
      kind: 'section';
      sectionKey: PatchableSectionKey;
      issueCodes: string[];
      messages: string[];
      suggestedFixes: string[];
      evidence: SemanticRepairEvidence[];
    }
  | {
      kind: 'feature';
      sectionKey: string;
      featureId: string;
      featureName: string;
      issueCodes: string[];
      messages: string[];
      suggestedFixes: string[];
      targetFields: FeatureEnrichableField[];
      evidence: SemanticRepairEvidence[];
    };

interface NormalizedSemanticPatch {
  sections: Partial<Record<PatchableSectionKey, string>>;
  features: Array<{
    id: string;
    fields: Partial<Record<FeatureEnrichableField, string | string[]>>;
  }>;
}

interface SemanticRepairEvidence {
  code: string;
  message: string;
  evidencePath?: string;
  evidenceSnippet?: string;
}

const SEMANTIC_CLUSTER_SECTION_ORDER: PatchableSectionKey[] = [
  'systemVision',
  'domainModel',
  'globalBusinessRules',
  'systemBoundaries',
  'outOfScope',
];

const SCHEMA_EVIDENCE_CODES = new Set([
  'schema_field_reference_mismatch',
  'schema_field_reference_missing',
  'schema_field_identifier_mismatch',
]);

function summarizeSemanticContext(value: unknown, maxLength = 320): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized.slice(0, maxLength) || '(missing)';
}

function deterministicIssueSupportsVerifierCode(
  verifierCode: string,
  deterministicCode: string
): boolean {
  switch (verifierCode) {
    case 'schema_field_mismatch':
      return SCHEMA_EVIDENCE_CODES.has(deterministicCode) || deterministicCode === 'rule_schema_property_coverage_missing';
    case 'business_rule_contradiction':
      return deterministicCode === 'business_rule_constraint_conflict' || deterministicCode === 'rule_schema_property_coverage_missing';
    case 'scope_meta_leakage':
      return deterministicCode === 'out_of_scope_reintroduced' || deterministicCode === 'out_of_scope_future_leakage';
    default:
      return false;
  }
}

function targetMatchesDeterministicIssue(
  target: SemanticRepairTarget,
  issue: DeterministicSemanticIssue
): boolean {
  const evidencePath = String(issue.evidencePath || '').trim();
  if (evidencePath) {
    if (evidencePath === target.sectionKey || evidencePath.startsWith(`${target.sectionKey}.`)) {
      return true;
    }
  }

  if (target.kind === 'section') {
    if (target.sectionKey === 'systemVision' && issue.code === 'feature_core_semantic_gap') {
      return true;
    }
    if (target.sectionKey === 'domainModel' && SCHEMA_EVIDENCE_CODES.has(issue.code)) {
      return true;
    }
    if (target.sectionKey === 'domainModel' && issue.code === 'rule_schema_property_coverage_missing') {
      return true;
    }
    if (target.sectionKey === 'globalBusinessRules' && issue.code === 'business_rule_constraint_conflict') {
      return true;
    }
    if (target.sectionKey === 'globalBusinessRules' && issue.code === 'rule_schema_property_coverage_missing') {
      return true;
    }
    if (target.sectionKey === 'outOfScope' && issue.code === 'out_of_scope_reintroduced') {
      return true;
    }
    if (target.sectionKey === 'outOfScope' && issue.code === 'out_of_scope_future_leakage') {
      return true;
    }
    if (target.sectionKey === 'deployment' && issue.code === 'deployment_runtime_contradiction') {
      return true;
    }

    return target.issueCodes.some(code => deterministicIssueSupportsVerifierCode(code, issue.code));
  }

  return target.issueCodes.some(code => deterministicIssueSupportsVerifierCode(code, issue.code))
    && Boolean(evidencePath && (evidencePath === target.sectionKey || evidencePath.startsWith(`${target.sectionKey}.`)));
}

function attachSemanticRepairEvidence(params: {
  structure: PRDStructure;
  targets: SemanticRepairTarget[];
  language: SupportedLanguage;
}): SemanticRepairTarget[] {
  const deterministicIssues = collectDeterministicSemanticIssues(params.structure, {
    language: params.language,
  });

  return params.targets.map(target => {
    const evidence = Array.from(new Map(
      deterministicIssues
        .filter(issue => targetMatchesDeterministicIssue(target, issue))
        .map(issue => {
          const normalizedEvidence: SemanticRepairEvidence = {
            code: issue.code,
            message: issue.message,
            ...(issue.evidencePath ? { evidencePath: issue.evidencePath } : {}),
            ...(issue.evidenceSnippet ? { evidenceSnippet: summarizeSemanticContext(issue.evidenceSnippet, 220) } : {}),
          };
          return [
            [
              normalizedEvidence.code,
              normalizedEvidence.evidencePath || '',
              normalizedEvidence.message,
            ].join('|'),
            normalizedEvidence,
          ] as const;
        })
    ).values()).slice(0, 4);

    return {
      ...target,
      evidence,
    };
  });
}

function buildSemanticRepairBatches(targets: SemanticRepairTarget[]): SemanticRepairTarget[][] {
  const features = targets
    .filter((target): target is Extract<SemanticRepairTarget, { kind: 'feature' }> => target.kind === 'feature')
    .sort((left, right) => left.featureId.localeCompare(right.featureId));
  const sectionsByKey = new Map(
    targets
      .filter((target): target is Extract<SemanticRepairTarget, { kind: 'section' }> => target.kind === 'section')
      .map(target => [target.sectionKey, target] as const)
  );
  const batches: SemanticRepairTarget[][] = [];

  const takeSection = (sectionKey: PatchableSectionKey) => {
    const target = sectionsByKey.get(sectionKey);
    if (target) sectionsByKey.delete(sectionKey);
    return target;
  };

  const pushBatch = (entries: Array<SemanticRepairTarget | undefined>) => {
    const batch = entries.filter((entry): entry is SemanticRepairTarget => Boolean(entry));
    if (batch.length > 0) batches.push(batch);
  };

  // ÄNDERUNG 10.03.2026: System Vision und Timeline werden fuer deterministische
  // Vision-/Priorisierungsfehler bewusst mit den fruehesten betroffenen Features gebuendelt.
  const firstFeature = features.shift();
  const systemVisionTarget = takeSection('systemVision');
  const timelineTarget = takeSection('timelineMilestones');
  if (firstFeature && (timelineTarget || systemVisionTarget)) {
    pushBatch([systemVisionTarget, timelineTarget, firstFeature, features.shift()]);
  } else if (firstFeature) {
    pushBatch([firstFeature, takeSection('domainModel')]);
  } else if (timelineTarget || systemVisionTarget) {
    pushBatch([systemVisionTarget, timelineTarget]);
  }

  if (sectionsByKey.has('domainModel') && sectionsByKey.has('globalBusinessRules')) {
    pushBatch([takeSection('domainModel'), takeSection('globalBusinessRules')]);
  } else if (sectionsByKey.has('globalBusinessRules')) {
    pushBatch([takeSection('globalBusinessRules')]);
  } else if (sectionsByKey.has('domainModel')) {
    pushBatch([takeSection('domainModel')]);
  }

  if (sectionsByKey.has('systemBoundaries') && sectionsByKey.has('outOfScope')) {
    pushBatch([takeSection('systemBoundaries'), takeSection('outOfScope')]);
  }

  while (features.length > 0) {
    pushBatch(features.splice(0, 2));
  }

  const remainingSections = [
    ...SEMANTIC_CLUSTER_SECTION_ORDER
      .map(sectionKey => sectionsByKey.get(sectionKey))
      .filter((target): target is Extract<SemanticRepairTarget, { kind: 'section' }> => Boolean(target)),
    ...TARGETABLE_SECTION_KEYS
      .filter(sectionKey => !SEMANTIC_CLUSTER_SECTION_ORDER.includes(sectionKey))
      .map(sectionKey => sectionsByKey.get(sectionKey))
      .filter((target): target is Extract<SemanticRepairTarget, { kind: 'section' }> => Boolean(target)),
  ];

  for (let index = 0; index < remainingSections.length; index += 2) {
    pushBatch(remainingSections.slice(index, index + 2));
  }

  return batches;
}

function buildSemanticConsistencyClusterContext(
  structure: PRDStructure,
  targets: SemanticRepairTarget[]
): string {
  const includesConsistencyCluster = targets.some(target =>
    target.kind === 'feature' || SEMANTIC_CLUSTER_SECTION_ORDER.includes(target.sectionKey as PatchableSectionKey)
  );
  if (!includesConsistencyCluster) return '';

  const targetedFeatures = targets
    .filter((target): target is Extract<SemanticRepairTarget, { kind: 'feature' }> => target.kind === 'feature')
    .map(target => {
      const feature = (structure.features || []).find(entry =>
        String(entry.id || '').trim().toUpperCase() === target.featureId
      );
      return [
        `- ${target.featureId}: ${target.featureName}`,
        `  Purpose: ${summarizeSemanticContext(feature?.purpose, 180)}`,
        `  Preconditions: ${summarizeSemanticContext(feature?.preconditions, 180)}`,
        `  Postconditions: ${summarizeSemanticContext(feature?.postconditions, 180)}`,
        `  Data Impact: ${summarizeSemanticContext(feature?.dataImpact, 180)}`,
        `  UI Impact: ${summarizeSemanticContext(feature?.uiImpact, 180)}`,
      ].join('\n');
    });

  const lines = [
    'CONSISTENCY CLUSTER SNAPSHOT',
    `- System Vision: ${summarizeSemanticContext(structure.systemVision, 280)}`,
    `- System Boundaries: ${summarizeSemanticContext(structure.systemBoundaries, 280)}`,
    `- Domain Model: ${summarizeSemanticContext(structure.domainModel, 280)}`,
    `- Global Business Rules: ${summarizeSemanticContext(structure.globalBusinessRules, 280)}`,
    `- Out of Scope: ${summarizeSemanticContext(structure.outOfScope, 280)}`,
    `- Timeline & Milestones: ${summarizeSemanticContext(structure.timelineMilestones, 280)}`,
  ];

  if (targetedFeatures.length > 0) {
    lines.push('- Targeted Features:');
    lines.push(...targetedFeatures);
  }

  return lines.join('\n');
}

function buildSemanticRepairTargets(
  issues: ContentIssue[],
  structure: PRDStructure
): SemanticRepairTarget[] {
  const targets = new Map<string, SemanticRepairTarget>();

  for (const issue of issues) {
    const sectionKey = String(issue.sectionKey || '').trim();
    if (!sectionKey) continue;

    if (sectionKey.startsWith('feature:')) {
      const featureId = sectionKey.replace(/^feature:/i, '').trim().toUpperCase();
      const feature = (structure.features || []).find(entry => String(entry.id || '').trim().toUpperCase() === featureId);
      if (!feature) continue;

      const existing = targets.get(sectionKey);
      if (existing && existing.kind === 'feature') {
        existing.issueCodes = Array.from(new Set([...existing.issueCodes, issue.code].filter(Boolean)));
        existing.messages = Array.from(new Set([...existing.messages, issue.message].filter(Boolean)));
        if (issue.suggestedFix) existing.suggestedFixes.push(issue.suggestedFix);
        existing.targetFields = Array.from(new Set([
          ...existing.targetFields,
          ...resolveFeatureTargetFields(issue),
        ]));
        continue;
      }

      targets.set(sectionKey, {
        kind: 'feature',
        sectionKey,
        featureId,
        featureName: feature.name,
        issueCodes: issue.code ? [issue.code] : [],
        messages: issue.message ? [issue.message] : [],
        suggestedFixes: issue.suggestedFix ? [issue.suggestedFix] : [],
        targetFields: resolveFeatureTargetFields(issue),
        evidence: [],
      });
      continue;
    }

    if (!PATCHABLE_SECTION_KEY_SET.has(sectionKey)) continue;
    const normalizedSectionKey = sectionKey as PatchableSectionKey;
    const existing = targets.get(normalizedSectionKey);
    if (existing && existing.kind === 'section') {
      existing.issueCodes = Array.from(new Set([...existing.issueCodes, issue.code].filter(Boolean)));
      existing.messages = Array.from(new Set([...existing.messages, issue.message].filter(Boolean)));
      if (issue.suggestedFix) existing.suggestedFixes.push(issue.suggestedFix);
      continue;
    }

    targets.set(normalizedSectionKey, {
      kind: 'section',
      sectionKey: normalizedSectionKey,
      issueCodes: issue.code ? [issue.code] : [],
      messages: issue.message ? [issue.message] : [],
      suggestedFixes: issue.suggestedFix ? [issue.suggestedFix] : [],
      evidence: [],
    });
  }

  if (targets.has('systemVision') || targets.has('globalBusinessRules')) {
    for (const target of targets.values()) {
      if (target.kind !== 'feature') continue;
      target.targetFields = Array.from(new Set([
        ...target.targetFields,
        ...FEATURE_SEMANTIC_CLUSTER_FIELDS,
      ]));
    }
  }

  if (targets.has('timelineMilestones')) {
    for (const target of targets.values()) {
      if (target.kind !== 'feature') continue;
      target.targetFields = Array.from(new Set([
        ...target.targetFields,
        'name',
        'purpose',
        'mainFlow',
      ]));
    }
  }

  return Array.from(targets.values());
}

function summarizeFeatureField(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map(entry => String(entry || '').trim())
      .filter(Boolean)
      .map((entry, index) => `${index + 1}. ${entry}`)
      .join(' | ');
  }
  return String(value || '').trim();
}

function buildSemanticRepairPrompt(params: {
  structure: PRDStructure;
  targets: SemanticRepairTarget[];
  language: SupportedLanguage;
  templateCategory?: string;
  originalRequest?: string;
}): string {
  const { structure, targets, language, templateCategory, originalRequest } = params;
  const templateInstruction = buildTemplateInstruction(templateCategory, language);
  const langNote = language === 'de'
    ? 'Schreibe alle erklaerenden Inhalte auf Deutsch. Technische Bezeichner, Entity-Namen und Feldnamen duerfen in ihrer kanonischen Schreibweise bleiben.'
    : 'Write all explanatory prose in English. Keep technical identifiers, entity names, and field names in their canonical form where needed.';
  const consistencyClusterContext = buildSemanticConsistencyClusterContext(structure, targets);
  const touchesAcceptanceCriteria = targets.some(
    target => target.kind === 'feature' && target.targetFields.includes('acceptanceCriteria')
  );
  const touchesAlternateFlows = targets.some(
    target => target.kind === 'feature' && target.targetFields.includes('alternateFlows')
  );
  const preservesFeatureIdentity = targets.some(target => target.kind === 'feature');
  const issueCodes = new Set(targets.flatMap(target => target.issueCodes));
  const reinforcesVisionFirstWindow = issueCodes.has('vision_capability_coverage_missing')
    || issueCodes.has('support_features_overweight');
  const reinforcesTimelineIdentity = issueCodes.has('timeline_feature_reference_mismatch');
  const leadingFeatureWindow = (reinforcesVisionFirstWindow || reinforcesTimelineIdentity)
    ? (structure.features || [])
      .slice(0, 6)
      .map((feature, index) => `- ${index + 1}. ${feature.id}: ${feature.name} — ${summarizeSemanticContext(feature.purpose || feature.rawContent, 140)}`)
      .join('\n') || '- (none)'
    : '';

  const targetBlocks = targets.map(target => {
    const deterministicEvidence = target.evidence.length > 0
      ? [
          'Deterministic Evidence:',
          ...target.evidence.map(issue => {
            const source = [
              issue.evidencePath ? `path=${issue.evidencePath}` : '',
              issue.evidenceSnippet ? `snippet=${issue.evidenceSnippet}` : '',
            ].filter(Boolean).join(' | ');
            return source
              ? `- [${issue.code}] ${issue.message} (${source})`
              : `- [${issue.code}] ${issue.message}`;
          }),
        ]
      : ['Deterministic Evidence: none'];

    if (target.kind === 'section') {
      const suggestedFixLines = target.suggestedFixes.length > 0
        ? ['Suggested Fixes:', ...target.suggestedFixes.map(fix => `- ${fix}`)]
        : [];
      return [
        `## Target Section: ${target.sectionKey}`,
        `Issue Codes: ${target.issueCodes.join(', ') || 'unknown'}`,
        'Blocking Issues:',
        ...target.messages.map(message => `- ${message}`),
        ...suggestedFixLines,
        ...deterministicEvidence,
        'Current Section Content:',
        String((structure as any)[target.sectionKey] || '(missing)').trim() || '(missing)',
      ].join('\n');
    }

    const feature = (structure.features || []).find(entry => String(entry.id || '').trim().toUpperCase() === target.featureId);
    const featurePosition = (structure.features || []).findIndex(entry =>
      String(entry.id || '').trim().toUpperCase() === target.featureId
    );
    const fieldLines = target.targetFields.map(field => `- ${field}: ${summarizeFeatureField((feature as any)?.[field]) || '(missing)'}`);
    const suggestedFixLines = target.suggestedFixes.length > 0
      ? ['Suggested Fixes:', ...target.suggestedFixes.map(fix => `- ${fix}`)]
      : [];
    return [
      `## Target Feature: ${target.featureId} - ${target.featureName}`,
      `Feature List Position: ${featurePosition >= 0 ? featurePosition + 1 : 'unknown'}`,
      `Issue Codes: ${target.issueCodes.join(', ') || 'unknown'}`,
      `Target Fields: ${target.targetFields.join(', ')}`,
      'Blocking Issues:',
      ...target.messages.map(message => `- ${message}`),
      ...suggestedFixLines,
      ...deterministicEvidence,
      'Current Target Field Content:',
      ...fieldLines,
      'Current Raw Feature Context:',
      String(feature?.rawContent || '(missing)').trim() || '(missing)',
    ].join('\n');
  }).join('\n\n');

  const featureIndex = (structure.features || [])
    .slice(0, 20)
    .map(feature => `- ${feature.id}: ${feature.name}`)
    .join('\n') || '- (none)';

  return `You are repairing specific blocking semantic issues in a compiled PRD.

TASK
- Repair ONLY the targeted sections and feature fields listed below.
- Do NOT rewrite the whole PRD.
- Keep untouched content unchanged.
- ${langNote}

PROJECT CONTEXT
- Original request: ${String(originalRequest || '(missing)').slice(0, 600)}
- Template guidance: ${templateInstruction}
- System Vision: ${String(structure.systemVision || '(missing)').slice(0, 500)}
- System Boundaries: ${String(structure.systemBoundaries || '(missing)').slice(0, 500)}
- Domain Model: ${String(structure.domainModel || '(missing)').slice(0, 500)}
- Global Business Rules: ${String(structure.globalBusinessRules || '(missing)').slice(0, 500)}
- Out of Scope: ${String(structure.outOfScope || '(missing)').slice(0, 500)}
- Feature Index:
${featureIndex}
${leadingFeatureWindow ? `- Leading Feature Window (fixed order; strengthen content instead of reordering):\n${leadingFeatureWindow}` : ''}
${consistencyClusterContext ? `\n${consistencyClusterContext}` : ''}

TARGETS
${targetBlocks}

OUTPUT FORMAT
Return JSON only with this shape:
{
  "sections": {
    "definitionOfDone": "replacement markdown for the full section body"
  },
  "features": [
    {
      "id": "F-03",
      "fields": {
        "purpose": "replacement text",
        "mainFlow": ["step 1", "step 2"]
      }
    }
  ]
}

STRICT RULES
- Include ONLY targeted sections and targeted feature IDs from this prompt.
- Omit any target that does not need a change.
- For section patches, provide the full replacement body for that section only.
- For feature patches, provide ONLY the requested fields.
- Use strings for scalar fields and arrays of strings for list fields.
- Do not wrap JSON in markdown fences.
- Do not include commentary, explanations, or extra keys.
- Keep Features, Domain Model, Global Business Rules, System Boundaries, and Out of Scope mutually consistent.
- If System Vision or Global Business Rules define a mechanic, state transition, or progression concept, affected feature Preconditions, Postconditions, and Data Impact must encode it explicitly.
- Do not reintroduce anything excluded by Out of Scope.
- Domain Model entities and field identifiers must match every referenced schema identifier exactly.
- For Domain Model patches, describe entity fields in plain prose (for example: "GameSession stores sessionId, activePowerUpId, and score.") instead of pseudo-signature syntax like "GameSession(sessionId, activePowerUpId, score)".
- Global Business Rules are hard constraints; do not contradict them in features, milestones, success criteria, or scope text.
- Remove scope/meta leakage: only product facts belong in these sections, never planning instructions or reviewer commentary.
- Out of Scope must contain strict exclusions only; remove future options, roadmap language, or implied later expansions.
${preservesFeatureIdentity ? '- Preserve each target feature identity. Do not rename a feature to its bare ID and do not strip a descriptive feature name.' : ''}
${reinforcesVisionFirstWindow ? '- When repairing vision coverage or support overweight, strengthen the earliest targeted features so the leading feature window clearly expresses the primary end-user capabilities promised by System Vision.' : ''}
${reinforcesVisionFirstWindow ? '- Support, admin, setup, configuration, or enabler mechanics may remain, but they must read as subordinate enablers and must not overshadow core user-value capabilities in the leading feature window.' : ''}
${reinforcesVisionFirstWindow ? '- Because feature order is fixed, repair prioritization by sharpening Purpose, Trigger, Main Flow, Preconditions, Postconditions, Data Impact, and Acceptance Criteria of the targeted core features instead of inventing new scope or generic filler.' : ''}
${reinforcesTimelineIdentity ? '- Timeline & Milestones must reference the canonical feature identity and user outcome of the matching feature. Never let one feature ID describe the workflow, state change, or responsibility of a neighboring feature.' : ''}
${reinforcesTimelineIdentity ? '- If two targeted features are semantically adjacent, separate them cleanly: each feature must keep its own trigger, main flow, and acceptance criteria, and the timeline wording must align to that separation.' : ''}
${touchesAcceptanceCriteria ? '- Acceptance criteria must be feature-specific, directly derivable from Trigger, Main Flow, Postconditions, and Data Impact, and must not reuse near-identical generic criteria across different features.' : ''}
${touchesAlternateFlows ? '- Alternate Flows must contain at least one concrete exception, rejection, or edge case. Never return placeholder bullets, bare markdown markers, or dummy one-line entries.' : ''}`;
}

function extractJsonObjectFromText(text: string): string {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fencedMatch?.[1]?.trim() || trimmed;
  const firstBrace = source.indexOf('{');
  if (firstBrace === -1) return '';

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = firstBrace; index < source.length; index++) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(firstBrace, index + 1);
      }
    }
  }

  return source.slice(firstBrace);
}

function isPatchPlaceholderText(value: string): boolean {
  const normalized = String(value || '')
    .replace(/[*_`>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!normalized) return true;
  if (normalized === '**' || normalized === '*' || normalized === '-') return true;
  if (normalized === 'tbd' || normalized === 'todo' || normalized === 'placeholder') return true;
  if (normalized === 'n/a' || normalized === 'na') return true;
  return /^f-\d+$/.test(normalized) || /^feature id[:\s-]*f-\d+$/i.test(normalized);
}

function normalizePatchedArrayField(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const items = value
      .map(entry => String(entry || '').trim())
      .map(entry => entry.replace(/^\d+\.\s*/, '').replace(/^-\s*\[.\]\s*/, '').replace(/^-\s*/, '').trim())
      .filter(entry => entry.length > 0 && !isPatchPlaceholderText(entry));
    return items.length > 0 ? items : null;
  }

  if (typeof value === 'string') {
    const items = value
      .split(/\n+/)
      .map(entry => entry.replace(/^\d+\.\s*/, '').replace(/^-\s*\[.\]\s*/, '').replace(/^-\s*/, '').trim())
      .filter(entry => entry.length > 0 && !isPatchPlaceholderText(entry));
    return items.length > 0 ? items : null;
  }

  return null;
}

function normalizePatchedScalarField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const next = value.trim();
  return next.length > 0 && !isPatchPlaceholderText(next) ? next : null;
}

function parseSemanticPatchResponse(
  response: string,
  targets: SemanticRepairTarget[]
): NormalizedSemanticPatch | null {
  const rawJson = extractJsonObjectFromText(response);
  if (!rawJson) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawJson) as Record<string, unknown>;
  } catch {
    return null;
  }

  const allowedSectionKeys = new Set(
    targets
      .filter((target): target is Extract<SemanticRepairTarget, { kind: 'section' }> => target.kind === 'section')
      .map(target => String(target.sectionKey))
  );
  const allowedFeatureFields = new Map<string, Set<FeatureEnrichableField>>();
  for (const target of targets) {
    if (target.kind !== 'feature') continue;
    allowedFeatureFields.set(target.featureId, new Set(target.targetFields));
  }

  const sections: Partial<Record<PatchableSectionKey, string>> = {};
  if (parsed.sections && typeof parsed.sections === 'object' && parsed.sections !== null) {
    for (const [sectionKey, value] of Object.entries(parsed.sections as Record<string, unknown>)) {
      if (!allowedSectionKeys.has(sectionKey)) continue;
      const normalizedValue = normalizePatchedScalarField(value);
      if (!normalizedValue) continue;
      sections[sectionKey as PatchableSectionKey] = normalizedValue;
    }
  }

  const features: Array<{ id: string; fields: Partial<Record<FeatureEnrichableField, string | string[]>> }> = [];
  if (Array.isArray(parsed.features)) {
    for (const entry of parsed.features) {
      if (!entry || typeof entry !== 'object') continue;
      const featureId = String((entry as any).id || '').trim().toUpperCase();
      const allowedFields = allowedFeatureFields.get(featureId);
      if (!featureId || !allowedFields) continue;

      const rawFields = (entry as any).fields;
      if (!rawFields || typeof rawFields !== 'object') continue;

      const fields: Partial<Record<FeatureEnrichableField, string | string[]>> = {};
      for (const field of FEATURE_ENRICHABLE_FIELDS) {
        if (!allowedFields.has(field)) continue;
        const nextValue = (rawFields as Record<string, unknown>)[field];
        if (nextValue === undefined) continue;
        if (field === 'mainFlow' || field === 'alternateFlows' || field === 'acceptanceCriteria') {
          const normalizedArray = normalizePatchedArrayField(nextValue);
          if (normalizedArray) fields[field] = normalizedArray;
          continue;
        }
        const normalizedScalar = normalizePatchedScalarField(nextValue);
        if (normalizedScalar) fields[field] = normalizedScalar;
      }

      if (Object.keys(fields).length > 0) {
        features.push({ id: featureId, fields });
      }
    }
  }

  if (Object.keys(sections).length === 0 && features.length === 0) {
    return null;
  }

  return { sections, features };
}

function applySemanticPatchToStructure(params: {
  structure: PRDStructure;
  patch: NormalizedSemanticPatch;
}): { structure: PRDStructure; changed: boolean; changedSections: string[] } {
  let changed = false;
  let nextStructure: PRDStructure = params.structure;
  const changedSections = new Set<string>();

  if (Object.keys(params.patch.sections).length > 0) {
    const updatedSections = { ...nextStructure } as PRDStructure;
    for (const [sectionKey, value] of Object.entries(params.patch.sections)) {
      const typedKey = sectionKey as PatchableSectionKey;
      const currentValue = String((nextStructure as any)[typedKey] || '').trim();
      if (normalizeForMatch(currentValue) === normalizeForMatch(value)) continue;
      (updatedSections as any)[typedKey] = value;
      changed = true;
      changedSections.add(String(typedKey));
    }
    nextStructure = updatedSections;
  }

  if (params.patch.features.length > 0) {
    const patchByFeatureId = new Map(
      params.patch.features.map(feature => [feature.id.toUpperCase(), feature.fields] as const)
    );
    const updatedFeatures = (nextStructure.features || []).map(feature => {
      const fields = patchByFeatureId.get(String(feature.id || '').trim().toUpperCase());
      if (!fields) return feature;

      let featureChanged = false;
      const updatedFeature = { ...feature };
      for (const field of FEATURE_ENRICHABLE_FIELDS) {
        const nextValue = fields[field];
        if (nextValue === undefined) continue;

        if (field === 'mainFlow' || field === 'alternateFlows' || field === 'acceptanceCriteria') {
          if (!Array.isArray(nextValue)) continue;
          const normalizedCurrent = normalizeFeatureFieldValue(feature, field);
          const normalizedNext = nextValue.map(entry => normalizeForMatch(entry)).join('|');
          if (!normalizedNext || normalizedCurrent === normalizedNext) continue;
          (updatedFeature as any)[field] = nextValue;
          featureChanged = true;
          continue;
        }

        if (typeof nextValue !== 'string') continue;
        const normalizedCurrent = normalizeFeatureFieldValue(feature, field);
        const normalizedNext = normalizeForMatch(nextValue);
        if (!normalizedNext || normalizedCurrent === normalizedNext) continue;
        (updatedFeature as any)[field] = nextValue;
        featureChanged = true;
      }

      if (featureChanged) {
        changed = true;
        changedSections.add(`feature:${String(feature.id || '').trim().toUpperCase()}`);
        return updatedFeature;
      }

      return feature;
    });

    if (changed) {
      nextStructure = {
        ...nextStructure,
        features: updatedFeatures,
      };
    }
  }

  return { structure: nextStructure, changed, changedSections: Array.from(changedSections) };
}

export async function applySemanticPatchRefinement(options: {
  content: string;
  structure: PRDStructure;
  issues: ContentIssue[];
  language: SupportedLanguage;
  templateCategory?: string;
  originalRequest?: string;
  reviewer?: ReviewerContentGenerator;
}): Promise<SemanticPatchRefineResult> {
  const { issues, language, templateCategory, originalRequest, reviewer } = options;
  let { content, structure } = options;
  const reviewerAttempts: ReviewerRefineResult[] = [];
  const targets = buildSemanticRepairTargets(issues, structure);
  const batches = buildSemanticRepairBatches(targets);

  if (!reviewer || targets.length === 0) {
    return { content, structure, refined: false, reviewerAttempts, truncated: false, changedSections: [], structuralChange: false };
  }

  let refined = false;
  let truncated = false;
  const changedSections = new Set<string>();

  const processBatch = async (
    batch: SemanticRepairTarget[],
    allowSplit: boolean
  ): Promise<boolean> => {
    const batchWithEvidence = attachSemanticRepairEvidence({
      structure,
      targets: batch,
      language,
    });
    const prompt = buildSemanticRepairPrompt({
      structure,
      targets: batchWithEvidence,
      language,
      templateCategory,
      originalRequest,
    });
    const result = await reviewer(prompt);
    reviewerAttempts.push(result);

    if (result.finishReason === 'length') {
      truncated = true;
      if (allowSplit && batch.length > 1) {
        let changed = false;
        for (const target of batch) {
          changed = (await processBatch([target], false)) || changed;
        }
        return changed;
      }
      return false;
    }

    const patch = parseSemanticPatchResponse(result.content, batchWithEvidence);
    if (!patch) return false;

    const applied = applySemanticPatchToStructure({ structure, patch });
    if (!applied.changed) return false;
    applied.changedSections.forEach(sectionKey => changedSections.add(sectionKey));

    structure = applied.structure;
    content = assembleStructureToMarkdown(structure);
    return true;
  };

  for (const batch of batches) {
    refined = (await processBatch(batch, true)) || refined;
  }

  return {
    content,
    structure,
    refined,
    reviewerAttempts,
    truncated,
    changedSections: Array.from(changedSections),
    structuralChange: changedSections.size > 0,
  };
}

// ---------------------------------------------------------------------------
// AI-based content refinement prompt builder
// ---------------------------------------------------------------------------

function buildContentRefinePrompt(params: {
  assembledMarkdown: string;
  structure: PRDStructure;
  issues: ContentIssue[];
  sectionsToRewrite: string[];
  language: SupportedLanguage;
  templateCategory?: string;
}): string {
  const { issues, sectionsToRewrite, language, templateCategory } = params;
  const canonicalHeadings = CANONICAL_PRD_HEADINGS.map(h => `- ## ${h}`).join('\n');
  const templateInstruction = buildTemplateInstruction(templateCategory, language);

  // Build feature context summary for the AI
  const featureSummary = (params.structure.features || [])
    .slice(0, 8)
    .map(f => `- ${f.id}: ${f.name}`)
    .join('\n');

  const visionSnippet = String(params.structure.systemVision || '').trim().slice(0, 300);

  const issueList = issues
    .filter(i => sectionsToRewrite.includes(i.sectionKey))
    .map(i => `- [${i.sectionKey}] ${i.message} → Action: ${i.suggestedAction}`)
    .join('\n');

  const sectionList = sectionsToRewrite.join(', ');
  const targetList = [
    sectionList ? `Sections: ${sectionList}` : '',
  ].filter(Boolean).join(' | ');

  const langNote = language === 'de'
    ? 'Schreibe ALLE Inhalte auf Deutsch. Behalte nur die englischen H2-Headings bei.'
    : 'Write ALL content in English.';

  return `You are rewriting specific sections of a PRD document to replace generic filler with project-specific content.

PROJECT CONTEXT:
- Vision: ${visionSnippet || '(not available)'}
- Features:
${featureSummary || '(none)'}

ISSUES FOUND:
${issueList}

TARGETS TO REWRITE: ${targetList || '(none)'}

CURRENT DOCUMENT:
${params.assembledMarkdown}

INSTRUCTIONS:
1. Rewrite ONLY the targeted top-level section fields listed above (${targetList || 'none'}).
2. Keep ALL other sections and ALL feature blocks EXACTLY as they are - do not modify them.
3. Do NOT add, remove, rename, or reorder features. Preserve all existing feature IDs and their order.
4. Do NOT add any extra top-level sections or hidden headings.
5. Make each rewritten section project-specific:
   - Reference actual features by name/ID where appropriate
   - Use concrete, domain-specific language instead of generic filler
   - Each section must have distinct, unique content (no repetition between sections)
6. Section-specific guidance:
   - "definitionOfDone": Write as a concrete checklist (what must be true for release)
   - "outOfScope": List specific exclusions relevant to THIS project
   - "timelineMilestones": Define phases with feature assignments
   - "successCriteria": Define measurable, testable success metrics
7. ${langNote}

STRICT OUTPUT RULES:
- Output the COMPLETE PRD in Markdown (all sections, not just the rewritten ones)
- Use exactly these H2 headings:
${canonicalHeadings}
- ${templateInstruction}
- No meta-commentary, no introductory text
- Start directly with the first ## heading`;
}

// ---------------------------------------------------------------------------
// Public: Full content review + optional AI refinement
// ---------------------------------------------------------------------------

export async function applyTargetedContentRefinement(options: {
  content: string;
  structure: PRDStructure;
  issues: ContentIssue[];
  language: SupportedLanguage;
  templateCategory?: string;
  reviewer?: ReviewerContentGenerator;
}): Promise<TargetedContentRefineResult> {
  const { language, templateCategory, issues, reviewer } = options;
  let { content, structure } = options;
  const reviewerAttempts: ReviewerRefineResult[] = [];
  let enrichedFeatureCount = 0;

  if (!reviewer) {
    return { content, structure, refined: false, reviewerAttempts };
  }

  const featureIssues = issues.filter(isFeatureTargeted);
  if (featureIssues.length > 0) {
    const enrichTargets = new Map<string, { id: string; name: string; rawContent?: string; missingFields: FeatureEnrichableField[] }>();
    const forceReplaceFeatureIds = new Set<string>();

    for (const issue of featureIssues) {
      const featureId = issue.sectionKey.replace('feature:', '');
      const feature = (structure.features || []).find(entry => entry.id === featureId);
      const existing = enrichTargets.get(featureId) || {
        id: featureId,
        name: feature?.name || featureId,
        rawContent: feature?.rawContent,
        missingFields: [],
      };
      existing.missingFields = Array.from(new Set([
        ...existing.missingFields,
        ...resolveFeatureTargetFields(issue),
      ]));
      enrichTargets.set(featureId, existing);
      if (isFeatureForceRewriteIssue(issue.code) || issue.suggestedAction === 'rewrite') {
        forceReplaceFeatureIds.add(featureId);
      }
    }

    const featuresToEnrich = Array.from(enrichTargets.values()).filter(feature => feature.missingFields.length > 0);
    if (featuresToEnrich.length > 0) {
      const enrichPrompt = buildFeatureEnrichPrompt({
        features: featuresToEnrich,
        projectContext: {
          systemVision: String(structure.systemVision || '').trim(),
          domainModel: String(structure.domainModel || '').trim(),
          otherFeatures: (structure.features || []).map(feature => ({ id: feature.id, name: feature.name })),
        },
        language,
      });

      let enrichmentAttempts = 0;
      const maxEnrichmentAttempts = 2;
      let enrichmentSucceeded = false;

      while (enrichmentAttempts < maxEnrichmentAttempts && !enrichmentSucceeded) {
        enrichmentAttempts++;
        try {
          const enrichResult = await reviewer(enrichPrompt);
          reviewerAttempts.push(enrichResult);
          const enrichResponse = String(enrichResult.content || '').trim();
          if (enrichResponse.length <= 50) continue;

          const enriched = parseFeatureEnrichResponse(
            enrichResponse,
            featuresToEnrich.map(feature => feature.id)
          );
          const shallowFeatureIds = new Set(
            featureIssues
              .filter(issue => issue.code === 'feature_content_shallow')
              .map(issue => issue.sectionKey.replace('feature:', ''))
          );

          if (enriched.size === 0) continue;

          let appliedFieldsThisPass = 0;
          const updatedFeatures = (structure.features || []).map(feature => {
            const fields = enriched.get(feature.id);
            if (!fields) return feature;
            const updated = { ...feature };
            const isShallow = shallowFeatureIds.has(feature.id);
            const forceReplace = forceReplaceFeatureIds.has(feature.id);
            const allowedFields = new Set(
              (enrichTargets.get(feature.id)?.missingFields || []).map(field => String(field))
            );
            for (const [key, value] of Object.entries(fields)) {
              if (!allowedFields.has(key)) continue;
              const existing = (updated as any)[key];
              const isEmpty = Array.isArray(existing)
                ? existing.length === 0
                : !existing || !String(existing).trim();
              const shouldReplace = forceReplace || isEmpty || (isShallow && (() => {
                const existingLen = Array.isArray(existing) ? existing.join(' ').length : String(existing || '').length;
                const newLen = Array.isArray(value) ? (value as string[]).join(' ').length : String(value || '').length;
                return newLen > existingLen * 1.5;
              })());
              if (shouldReplace) {
                (updated as any)[key] = value;
                enrichedFeatureCount++;
                appliedFieldsThisPass++;
              }
            }
            return updated;
          });
          if (appliedFieldsThisPass === 0) continue;
          structure = { ...structure, features: updatedFeatures };
          content = assembleStructureToMarkdown(structure);
          enrichmentSucceeded = true;
        } catch (err) {
          logger.warn(`Feature enrichment attempt ${enrichmentAttempts}/${maxEnrichmentAttempts} failed`, {
            error: err instanceof Error ? err.message : 'Unknown error',
            stage: 'feature_enrichment',
            attempt: enrichmentAttempts,
          });
        }
      }

      if (!enrichmentSucceeded) {
        logger.warn('Targeted feature enrichment produced no usable update', {
          stage: 'feature_enrichment',
          targetCount: featuresToEnrich.length,
        });
      }
    }
  }

  const sectionsToRewrite = Array.from(new Set(
    issues
      .filter(issue => issue.suggestedAction === 'rewrite' && !issue.sectionKey.startsWith('feature:'))
      .map(issue => issue.sectionKey)
      .filter(Boolean)
  ));
  if (sectionsToRewrite.length === 0) {
    return {
      content,
      structure,
      refined: enrichedFeatureCount > 0,
      enrichedFeatureCount,
      reviewerAttempts,
    };
  }

  const refinePrompt = buildContentRefinePrompt({
    assembledMarkdown: content,
    structure,
    issues,
    sectionsToRewrite,
    language,
    templateCategory,
  });

  try {
    const result = await reviewer(refinePrompt);
    reviewerAttempts.push(result);
    const refinedContent = String(result.content || '').trim();

    if (!refinedContent || refinedContent.length < content.length * 0.5) {
      return {
        content,
        structure,
        refined: enrichedFeatureCount > 0,
        enrichedFeatureCount,
        reviewerAttempts,
      };
    }

    let refinedStructure: PRDStructure;
    try {
      refinedStructure = parsePRDToStructure(refinedContent);
    } catch {
      return {
        content,
        structure,
        refined: enrichedFeatureCount > 0,
        enrichedFeatureCount,
        reviewerAttempts,
      };
    }

    if (!validateTargetedRefinement({
      original: structure,
      refined: refinedStructure,
      allowedSections: sectionsToRewrite,
    })) {
      return {
        content,
        structure,
        refined: enrichedFeatureCount > 0,
        enrichedFeatureCount,
        reviewerAttempts,
      };
    }

    return {
      content: refinedContent,
      structure: refinedStructure,
      refined: true,
      enrichedFeatureCount,
      reviewerAttempts,
    };
  } catch {
    return {
      content,
      structure,
      refined: enrichedFeatureCount > 0,
      enrichedFeatureCount,
      reviewerAttempts,
    };
  }
}

export async function reviewAndRefineContent(options: {
  content: string;
  structure: PRDStructure;
  language: SupportedLanguage;
  templateCategory?: string;
  fallbackSections?: string[];
  reviewer?: ReviewerContentGenerator;
}): Promise<ContentRefineResult> {
  const { language, templateCategory, fallbackSections, reviewer } = options;
  let { content, structure } = options;

  // Step 1: Deterministic content analysis
  const reviewResult = analyzeContentQuality(structure, {
    templateCategory,
    fallbackSections,
  });

  if (!reviewer) {
    return { content, structure, reviewResult, refined: false, reviewerAttempts: [] };
  }

  const refineResult = await applyTargetedContentRefinement({
    content,
    structure,
    issues: reviewResult.issues,
    language,
    templateCategory,
    reviewer,
  });

  if (!refineResult.refined && reviewResult.issues.some(issue => isFeatureTargeted(issue))) {
    reviewResult.issues.push({
      code: 'feature_enrichment_failed',
      sectionKey: 'features',
      message: 'Reviewer-based feature repair produced no safe targeted update.',
      severity: 'warning',
      suggestedAction: 'enrich',
    });
  }

  return {
    content: refineResult.content,
    structure: refineResult.structure,
    reviewResult,
    refined: refineResult.refined,
    enrichedFeatureCount: refineResult.enrichedFeatureCount,
    reviewerAttempts: refineResult.reviewerAttempts,
  };
}
