import type { TokenUsage } from '@shared/schema';
import { buildTemplateInstruction } from './prdTemplateIntent';
import type { PRDStructure } from './prdStructure';
import {
  FEATURE_ENRICHABLE_FIELDS,
  type FeatureEnrichableField,
} from './prdFeatureSemantics';

type SupportedLanguage = 'de' | 'en';

export interface SemanticBlockingIssue {
  code: string;
  message: string;
  sectionKey: string;
  suggestedAction?: 'rewrite' | 'enrich';
  targetFields?: FeatureEnrichableField[];
  suggestedFix?: string;
}

export interface SemanticVerificationResult {
  verdict: 'pass' | 'fail';
  blockingIssues: SemanticBlockingIssue[];
  model: string;
  usage: TokenUsage;
  sameFamilyFallback?: boolean;
  blockedFamilies?: string[];
}

export interface SemanticVerifierInput {
  content: string;
  structure: PRDStructure;
  mode: 'generate' | 'improve';
  existingContent?: string;
  language: SupportedLanguage;
  templateCategory?: string;
  originalRequest: string;
  avoidModelFamilies?: string[];
}

const ALLOWED_CODES = new Set([
  'cross_section_inconsistency',
  'business_rule_contradiction',
  'schema_field_mismatch',
  'scope_meta_leakage',
  'feature_section_semantic_mismatch',
]);

const SECTION_KEY_ALIASES: Record<string, string> = {
  'system vision': 'systemVision',
  systemvision: 'systemVision',
  'system boundaries': 'systemBoundaries',
  systemboundaries: 'systemBoundaries',
  'domain model': 'domainModel',
  domainmodel: 'domainModel',
  'global business rules': 'globalBusinessRules',
  globalbusinessrules: 'globalBusinessRules',
  'feature catalogue intro': 'featureCatalogueIntro',
  featurecatalogueintro: 'featureCatalogueIntro',
  'non-functional requirements': 'nonFunctional',
  nonfunctional: 'nonFunctional',
  'error handling & recovery': 'errorHandling',
  errorhandling: 'errorHandling',
  'deployment & infrastructure': 'deployment',
  deploymentinfrastructure: 'deployment',
  'definition of done': 'definitionOfDone',
  definitionofdone: 'definitionOfDone',
  'out of scope': 'outOfScope',
  outofscope: 'outOfScope',
  'timeline & milestones': 'timelineMilestones',
  timelinemilestones: 'timelineMilestones',
  'success criteria & acceptance testing': 'successCriteria',
  successcriteria: 'successCriteria',
};

function sectionSnippet(value: string | undefined, maxLength = 420): string {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function buildFeatureSummary(structure: PRDStructure): string {
  const features = structure.features || [];
  if (features.length === 0) return '(none)';

  return features
    .slice(0, 12)
    .map(feature => {
      const summary = [
        `- ${feature.id}: ${feature.name}`,
        `  Purpose: ${sectionSnippet(feature.purpose, 180) || '(missing)'}`,
        `  Trigger: ${sectionSnippet(feature.trigger, 140) || '(missing)'}`,
        `  dataImpact: ${sectionSnippet(feature.dataImpact, 140) || '(missing)'}`,
        `  uiImpact: ${sectionSnippet(feature.uiImpact, 140) || '(missing)'}`,
      ];
      return summary.join('\n');
    })
    .join('\n');
}

export function buildSemanticVerificationPrompt(input: SemanticVerifierInput): string {
  const templateInstruction = buildTemplateInstruction(input.templateCategory, input.language);
  const langNote = input.language === 'de'
    ? 'Pruefe die Semantik des PRD in deutscher Sprache. Die kanonischen H2-Heading-Namen bleiben Englisch.'
    : 'Review the PRD semantics in English. Canonical H2 headings remain English.';
  const structureSummary = [
    `System Vision: ${sectionSnippet(input.structure.systemVision) || '(missing)'}`,
    `System Boundaries: ${sectionSnippet(input.structure.systemBoundaries) || '(missing)'}`,
    `Domain Model: ${sectionSnippet(input.structure.domainModel) || '(missing)'}`,
    `Global Business Rules: ${sectionSnippet(input.structure.globalBusinessRules) || '(missing)'}`,
    `Non-Functional Requirements: ${sectionSnippet(input.structure.nonFunctional) || '(missing)'}`,
    `Error Handling: ${sectionSnippet(input.structure.errorHandling) || '(missing)'}`,
    `Deployment: ${sectionSnippet(input.structure.deployment) || '(missing)'}`,
    `Definition of Done: ${sectionSnippet(input.structure.definitionOfDone) || '(missing)'}`,
    `Out of Scope: ${sectionSnippet(input.structure.outOfScope) || '(missing)'}`,
    `Timeline & Milestones: ${sectionSnippet(input.structure.timelineMilestones) || '(missing)'}`,
    `Success Criteria: ${sectionSnippet(input.structure.successCriteria) || '(missing)'}`,
  ].join('\n');

  return `You are a strict semantic verifier for compiled PRD documents.

TASK
- Review the normalized PRD below for blocking semantic defects only.
- Ignore style, tone, and minor omissions unless they create a factual contradiction.
- ${langNote}

ALLOWED BLOCKING ISSUE CODES
- cross_section_inconsistency
- business_rule_contradiction
- schema_field_mismatch
- scope_meta_leakage
- feature_section_semantic_mismatch

RESPONSE FORMAT
Return JSON only:
{
  "verdict": "pass" | "fail",
  "blockingIssues": [
    {
      "code": "one of the allowed codes",
      "sectionKey": "canonical section key like systemBoundaries or feature:F-01",
      "message": "short concrete explanation",
      "suggestedAction": "rewrite" | "enrich",
      "targetFields": ["purpose", "mainFlow"],  // ONLY use these exact camelCase names: name, purpose, actors, trigger, preconditions, mainFlow, alternateFlows, postconditions, dataImpact, uiImpact, acceptanceCriteria
      "suggestedFix": "concrete correction describing what the content SHOULD say"
    }
  ]
}

RULES
1. Report at most 5 blocking issues.
2. Use sectionKey "feature:F-XX" for feature-specific issues.
3. Only use "enrich" for feature issues; use "rewrite" for section-level issues.
4. If you choose "feature_section_semantic_mismatch", include targetFields and ensure the message ends with "Rewrite: field1, field2, ...".
5. If no blocking issues exist, return verdict "pass" and an empty blockingIssues array.
6. Missing or empty enrichment fields (UI Impact, Data Impact, Trigger, Alternate Flows, Preconditions, Postconditions) are NOT blocking semantic defects — even when the feature describes visual or data-heavy functionality. Only report a feature_section_semantic_mismatch when the absence creates a FACTUAL CONTRADICTION with another section (e.g., Main Flow references a UI element defined nowhere). A field simply being empty is never blocking.
7. For each blocking issue, provide a suggestedFix with a concrete, actionable correction describing what the content SHOULD say. Do not restate the problem — provide the corrected text or a precise description of what needs to change.
8. Content that EXISTS but is described as 'generic', 'incomplete', or 'lacking technical detail' is a QUALITY issue, not a semantic defect. Only report semantic defects when there is a FACTUAL CONTRADICTION between sections — e.g., Section A says "ratio 50:1" and Section B says "ratio 100:1". A section being less detailed than another is never a semantic defect.
9. Mathematical equivalences are NOT cross_section_inconsistency. For example: "ratio 100:1", "divided by 100", and "multiply by 0.01" all express the same conversion and are consistent. Only flag an inconsistency when the actual VALUES disagree.
10. Truncated or placeholder text (e.g., 'freigesch', single dashes, 'TBD') AND incomplete sentences that break off mid-word or mid-phrase in a field are content quality issues, not semantic mismatches. Do not report feature_section_semantic_mismatch for incomplete, empty, or truncated text unless it creates a factual contradiction with another section. An empty or truncated dataImpact or uiImpact field is NEVER a blocking issue.

REQUEST CONTEXT
- Mode: ${input.mode}
- Original request: ${input.originalRequest.slice(0, 1200)}
- Existing baseline (improve mode only): ${sectionSnippet(input.existingContent, 500) || '(none)'}
- Template instruction: ${templateInstruction}

NORMALIZED STRUCTURE SUMMARY
${structureSummary}

FEATURE SUMMARY
${buildFeatureSummary(input.structure)}

NORMALIZED PRD MARKDOWN
${input.content}`;
}

function extractJsonObject(text: string): string {
  const trimmed = String(text || '').trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) return fencedMatch[1].trim();

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

function normalizeSectionKey(value: unknown): string {
  const normalized = String(value || '').trim();
  if (!normalized) return 'systemVision';
  if (/^feature\s*:\s*f-\d+/i.test(normalized)) {
    return `feature:${normalized.split(':').slice(1).join(':').trim().toUpperCase()}`;
  }
  if (/^f-\d+$/i.test(normalized)) {
    return `feature:${normalized.toUpperCase()}`;
  }

  const key = normalized
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();

  return SECTION_KEY_ALIASES[key] || SECTION_KEY_ALIASES[key.replace(/\s+/g, '')] || normalized;
}

function normalizeIssueCode(code: unknown, sectionKey: string): string {
  const normalized = String(code || '').trim().toLowerCase();
  if (ALLOWED_CODES.has(normalized)) return normalized;

  if (sectionKey.startsWith('feature:')) return 'feature_section_semantic_mismatch';
  if (normalized.includes('scope') || normalized.includes('meta')) return 'scope_meta_leakage';
  if (normalized.includes('schema') || normalized.includes('field')) return 'schema_field_mismatch';
  if (normalized.includes('rule') || normalized.includes('contrad')) return 'business_rule_contradiction';
  return 'cross_section_inconsistency';
}

function normalizeTargetFields(value: unknown): FeatureEnrichableField[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const fields = value
    .map(entry => String(entry || '').trim())
    .filter((entry): entry is FeatureEnrichableField =>
      FEATURE_ENRICHABLE_FIELDS.includes(entry as FeatureEnrichableField)
    );
  return fields.length > 0 ? Array.from(new Set(fields)) : undefined;
}

export function parseSemanticVerificationResponse(params: {
  content: string;
  model: string;
  usage: TokenUsage;
}): SemanticVerificationResult {
  const rawJson = extractJsonObject(params.content);
  let parsed: {
    verdict?: string;
    blockingIssues?: Array<Record<string, unknown>>;
  };
  try {
    parsed = JSON.parse(rawJson || '{}') as {
      verdict?: string;
      blockingIssues?: Array<Record<string, unknown>>;
    };
  } catch (error) {
    console.error('Failed to parse semantic verification response JSON', {
      model: params.model,
      rawJson,
      error,
    });
    return {
      verdict: 'fail',
      blockingIssues: [
        {
          code: 'cross_section_inconsistency',
          sectionKey: 'semanticVerifier',
          message: 'Semantic verifier returned invalid JSON output.',
          suggestedAction: 'rewrite',
        },
      ],
      model: params.model,
      usage: params.usage,
    };
  }

  const rawIssues = Array.isArray(parsed.blockingIssues) ? parsed.blockingIssues : [];
  const blockingIssues: SemanticBlockingIssue[] = rawIssues
    .slice(0, 5)
    .map(issue => {
      const sectionKey = normalizeSectionKey(issue.sectionKey);
      const targetFields = normalizeTargetFields(issue.targetFields);
      const suggestedAction = sectionKey.startsWith('feature:') ? 'enrich' : 'rewrite';
      const message = String(issue.message || '').trim()
        || (sectionKey.startsWith('feature:')
          ? `Feature block "${sectionKey}" needs semantic correction. Rewrite: ${(targetFields || FEATURE_ENRICHABLE_FIELDS).join(', ')}`
          : `Section "${sectionKey}" contains a blocking semantic inconsistency.`);

      const suggestedFix = String(issue.suggestedFix || '').trim() || undefined;

      return {
        code: normalizeIssueCode(issue.code, sectionKey),
        sectionKey,
        message: sectionKey.startsWith('feature:') && !/Rewrite:\s/i.test(message)
          ? `${message} Rewrite: ${(targetFields || FEATURE_ENRICHABLE_FIELDS).join(', ')}`
          : message,
        suggestedAction,
        ...(targetFields ? { targetFields } : {}),
        ...(suggestedFix ? { suggestedFix } : {}),
      };
    });

  const hasBlockingIssues = blockingIssues.length > 0;
  const verdict = String(parsed.verdict || '').trim().toLowerCase() === 'pass' && !hasBlockingIssues
    ? 'pass'
    : (hasBlockingIssues ? 'fail' : 'pass');

  return {
    verdict,
    blockingIssues,
    model: params.model,
    usage: params.usage,
  };
}
