import { assembleStructureToMarkdown } from './prdAssembler';
import type { PRDStructure, FeatureSpec } from './prdStructure';
import {
  applyConservativeFeatureAggregation,
  findFeatureAggregationCandidates,
  sanitizeMetaLeaksInStructure,
  type FeatureAggregationAnalysis,
} from './prdQualitySignals';
import {
  extractFieldHintsFromRaw,
  ensurePrdFeatureDepth,
} from './prdFeatureDepth';
import {
  collectUnknownSectionHeadings,
  detectLanguage,
  normalizeStructureForCompiler,
  safeParseStructure,
} from './prdCompilerNormalization';
import {
  validatePrdStructureInternal,
  type PrdQualityReport,
  type ValidationOptions,
} from './prdCompilerValidation';
import {
  ensurePrdRequiredSectionsInternal,
  ensurePrdSectionDepthInternal,
} from './prdCompilerSectionPolicy';
import {
  looksLikeTruncatedOutput,
  mergeStructuresForImprove as mergeStructuresForImproveInternal,
  mergeStructuresForImproveWithDiagnostics,
  type RequiredSectionDefinition,
} from './prdCompilerMerge';
import { hasText } from './prdTextUtils';

type SupportedLanguage = 'de' | 'en';

// ÄNDERUNG 08.03.2026: Interne Normalisierungs-/Parse-Helfer nach `server/prdCompilerNormalization.ts` ausgelagert.

// ÄNDERUNG 08.03.2026: Merge-/Improve-Helfer nach `server/prdCompilerMerge.ts` ausgelagert.

// ÄNDERUNG 08.03.2026: Required-Section-/Depth-Helfer nach `server/prdCompilerSectionPolicy.ts` ausgelagert.

// ÄNDERUNG 08.03.2026: Validierungs-Helfer nach `server/prdCompilerValidation.ts` ausgelagert.

export { extractFieldHintsFromRaw, ensurePrdFeatureDepth, looksLikeTruncatedOutput };
export type { PrdQualityIssue, PrdQualityReport } from './prdCompilerValidation';

export interface CompilePrdOptions {
  mode: 'generate' | 'improve';
  existingContent?: string;
  language?: SupportedLanguage;
  strictCanonical?: boolean;
  improveMaxNewFeatures?: number;
  strictLanguageConsistency?: boolean;
  enableFeatureAggregation?: boolean;
  aggregationStrictness?: 'conservative';
  templateCategory?: string;
  contextHint?: string;
}

export interface CompilePrdResult {
  content: string;
  structure: PRDStructure;
  quality: PrdQualityReport;
}

export type CompilePrdDocumentFn = (
  rawContent: string,
  options: CompilePrdOptions
) => CompilePrdResult;

const REQUIRED_SECTION_DEFS: RequiredSectionDefinition[] = [
  {
    key: 'systemVision',
    label: 'System Vision',
    fallbackEn: 'The product delivers clear user value for the defined audience and outcome.',
    fallbackDe: 'Das Produkt liefert einen klaren Nutzerwert fuer die definierte Zielgruppe und das Zielergebnis.',
  },
  {
    key: 'systemBoundaries',
    label: 'System Boundaries',
    fallbackEn: 'The scope, runtime boundaries, and integrations are explicitly defined for this version.',
    fallbackDe: 'Scope, Laufzeitgrenzen und Integrationen sind fuer diese Version explizit definiert.',
  },
  {
    key: 'domainModel',
    label: 'Domain Model',
    fallbackEn: 'Core entities, relationships, and constraints are defined in a deterministic way.',
    fallbackDe: 'Kernentitaeten, Beziehungen und Randbedingungen sind deterministisch beschrieben.',
  },
  {
    key: 'globalBusinessRules',
    label: 'Global Business Rules',
    fallbackEn: 'Global rules define invariants and constraints across all feature workflows.',
    fallbackDe: 'Globale Regeln definieren Invarianten und Randbedingungen ueber alle Feature-Workflows.',
  },
  {
    key: 'nonFunctional',
    label: 'Non-Functional Requirements',
    fallbackEn: 'Performance, reliability, security, and accessibility requirements are explicitly documented.',
    fallbackDe: 'Performance-, Zuverlaessigkeits-, Sicherheits- und Accessibility-Anforderungen sind explizit dokumentiert.',
  },
  {
    key: 'errorHandling',
    label: 'Error Handling & Recovery',
    fallbackEn: 'Failure handling, recovery behavior, and fallback expectations are documented.',
    fallbackDe: 'Fehlerbehandlung, Recovery-Verhalten und Fallback-Erwartungen sind dokumentiert.',
  },
  {
    key: 'deployment',
    label: 'Deployment & Infrastructure',
    fallbackEn: 'Runtime environment, deployment approach, and operational dependencies are described.',
    fallbackDe: 'Laufzeitumgebung, Deployment-Ansatz und operative Abhaengigkeiten sind beschrieben.',
  },
  {
    key: 'definitionOfDone',
    label: 'Definition of Done',
    fallbackEn: 'The release is complete only when all required sections and acceptance criteria are fulfilled.',
    fallbackDe: 'Der Release ist erst abgeschlossen, wenn alle Pflichtabschnitte und Akzeptanzkriterien erfuellt sind.',
  },
  {
    key: 'outOfScope',
    label: 'Out of Scope',
    fallbackEn: 'Items outside this release are explicitly listed to avoid scope creep.',
    fallbackDe: 'Elemente ausserhalb dieses Releases sind explizit gelistet, um Scope Creep zu vermeiden.',
  },
  {
    key: 'timelineMilestones',
    label: 'Timeline & Milestones',
    fallbackEn: 'Milestones and delivery phases are defined with realistic checkpoints.',
    fallbackDe: 'Meilensteine und Lieferphasen sind mit realistischen Checkpoints definiert.',
  },
  {
    key: 'successCriteria',
    label: 'Success Criteria',
    fallbackEn: 'Success criteria and acceptance indicators are measurable and testable.',
    fallbackDe: 'Erfolgskriterien und Abnahmeindikatoren sind messbar und testbar.',
  },
];

export const CANONICAL_PRD_HEADINGS = [
  'System Vision',
  'System Boundaries',
  'Domain Model',
  'Global Business Rules',
  'Functional Feature Catalogue',
  'Non-Functional Requirements',
  'Error Handling & Recovery',
  'Deployment & Infrastructure',
  'Definition of Done',
  'Out of Scope',
  'Timeline & Milestones',
  'Success Criteria & Acceptance Testing',
] as const;

const MIN_REQUIRED_SECTION_LENGTH = 60;
const MIN_INPUT_LENGTH = 20;  // ÄNDERUNG 01.03.2026: Zentrale Konstante für Mindesteingabelänge

export function mergeStructuresForImprove(
  base: PRDStructure,
  candidate: PRDStructure
): PRDStructure {
  return mergeStructuresForImproveInternal(base, candidate, REQUIRED_SECTION_DEFS);
}

export function ensurePrdRequiredSections(
  structure: PRDStructure,
  language: SupportedLanguage,
  context?: {
    templateCategory?: string;
    contextHint?: string;
  }
): { structure: PRDStructure; addedSections: string[] } {
  return ensurePrdRequiredSectionsInternal(structure, language, REQUIRED_SECTION_DEFS, context);
}

export function ensurePrdSectionDepth(
  structure: PRDStructure,
  language: SupportedLanguage,
  context?: {
    templateCategory?: string;
    contextHint?: string;
  }
): { structure: PRDStructure; expandedSections: string[] } {
  return ensurePrdSectionDepthInternal(
    structure,
    language,
    REQUIRED_SECTION_DEFS,
    MIN_REQUIRED_SECTION_LENGTH,
    context
  );
}

export function validatePrdStructure(
  structure: PRDStructure,
  rawContent: string,
  options?: ValidationOptions
): PrdQualityReport {
  return validatePrdStructureInternal(
    structure,
    rawContent,
    REQUIRED_SECTION_DEFS,
    MIN_REQUIRED_SECTION_LENGTH,
    options
  );
}

export function compilePrdDocument(
  rawContent: string,
  options: CompilePrdOptions
): CompilePrdResult {
  const trimmedRaw = String(rawContent || '').trim();
  if (!trimmedRaw || trimmedRaw.length < MIN_INPUT_LENGTH) {
    return {
      content: '',
      structure: { features: [], otherSections: {} },
      quality: {
        valid: false,
        truncatedLikely: false,
        missingSections: REQUIRED_SECTION_DEFS.map(d => d.label),
        featureCount: 0,
        issues: [{
          code: 'empty_input',
          message: 'Input content is empty or too short to compile a valid PRD.',
          severity: 'error',
        }],
      },
    };
  }

  const strictCanonical = options.strictCanonical !== false;
  const strictLanguageConsistency = options.strictLanguageConsistency !== false;
  const enableFeatureAggregation = options.enableFeatureAggregation !== false;
  const language = detectLanguage(options.language, rawContent);
  const candidate = sanitizeMetaLeaksInStructure(safeParseStructure(rawContent)).structure;
  const candidateUnknownSections = collectUnknownSectionHeadings(candidate);

  // Determine improve baseline: only merge structures when existing content
  // has parseable features. If content exists but has no feature baseline
  // (baselinePartial), use it as contextHint so the AI considers it without
  // a structural merge that would produce empty results.
  let improveBaseStructure: PRDStructure | null = null;
  if (options.mode === 'improve' && hasText(options.existingContent)) {
    const parsed = sanitizeMetaLeaksInStructure(safeParseStructure(String(options.existingContent || '')));
    const parsedFeatureCount = Array.isArray(parsed.structure.features) ? parsed.structure.features.length : 0;
    if (parsedFeatureCount > 0) {
      improveBaseStructure = parsed.structure;
    } else if (!options.contextHint) {
      // baselinePartial: content exists but no features parsed — use as context
      options = { ...options, contextHint: String(options.existingContent || '') };
    }
  }
  const merged = improveBaseStructure
    ? mergeStructuresForImproveWithDiagnostics(
      improveBaseStructure,
      candidate,
      REQUIRED_SECTION_DEFS
    ).structure
    : candidate;

  const normalized = normalizeStructureForCompiler(merged, { strictCanonical });
  const sanitized = sanitizeMetaLeaksInStructure(normalized).structure;
  let aggregationAnalysis: FeatureAggregationAnalysis = {
    candidates: [],
    nearDuplicates: [],
  };
  let aggregatedFeatureCount = 0;
  const maybeAggregated = (() => {
    if (!enableFeatureAggregation) return sanitized;
    aggregationAnalysis = findFeatureAggregationCandidates(
      sanitized.features || [],
      options.templateCategory,
      language
    );
    const aggregated = applyConservativeFeatureAggregation(
      sanitized,
      aggregationAnalysis.candidates,
      language
    );
    aggregatedFeatureCount = aggregated.aggregatedFeatureCount;
    return aggregated.structure;
  })();

  const withRequiredContext = ensurePrdRequiredSections(maybeAggregated, language, {
    templateCategory: options.templateCategory,
    contextHint: options.contextHint || rawContent,
  });
  const withDepth = ensurePrdSectionDepth(withRequiredContext.structure, language, {
    templateCategory: options.templateCategory,
    contextHint: options.contextHint || rawContent,
  });
  const withFeatureDepth = ensurePrdFeatureDepth(withDepth.structure, language);
  const content = assembleStructureToMarkdown(withFeatureDepth.structure);
  const quality = validatePrdStructure(withFeatureDepth.structure, content, {
    sourceContent: options.mode === 'generate' ? rawContent : undefined,
    strictCanonical,
    unknownSectionHeadings: candidateUnknownSections,
    mode: options.mode,
    templateCategory: options.templateCategory,
    targetLanguage: language,
    strictLanguageConsistency,
    aggregationAppliedCount: aggregatedFeatureCount,
    aggregationNearDuplicateCount: aggregationAnalysis.nearDuplicates.length,
    fallbackSections: [...withRequiredContext.addedSections, ...withDepth.expandedSections],
  });

  // Feature count regression guard (improve mode)
  if (options.mode === 'improve' && improveBaseStructure) {
    const baselineCount = improveBaseStructure.features.length;
    const outputCount = withFeatureDepth.structure.features.length;
    if (baselineCount > 0 && outputCount < baselineCount) {
      const lossRatio = 1 - outputCount / baselineCount;
      const severity: 'error' | 'warning' = lossRatio > 0.2 ? 'error' : 'warning';
      quality.issues.push({
        code: 'feature_count_regression',
        message: `Feature count dropped from ${baselineCount} to ${outputCount} during improve (${Math.round(lossRatio * 100)}% loss)`,
        severity,
      });
      if (severity === 'error') {
        quality.valid = false;
      }
    }
  }

  // Feature loss guard (generate mode) — detect features lost during compilation pipeline
  if (options.mode === 'generate' && !improveBaseStructure) {
    const candidateFeatureCount = candidate.features.length;
    const outputCount = withFeatureDepth.structure.features.length;
    if (candidateFeatureCount > 0 && outputCount === 0) {
      quality.issues.push({
        code: 'feature_loss_during_compilation',
        message: `All ${candidateFeatureCount} features from AI output were lost during compilation.`,
        severity: 'error',
      });
      quality.valid = false;
    } else if (candidateFeatureCount > 2 && outputCount < candidateFeatureCount * 0.5) {
      quality.issues.push({
        code: 'feature_loss_during_compilation',
        message: `Feature count dropped from ${candidateFeatureCount} to ${outputCount} during generate compilation (${Math.round((1 - outputCount / candidateFeatureCount) * 100)}% loss).`,
        severity: 'error',
      });
      quality.valid = false;
    }
  }

  return {
    content,
    structure: withFeatureDepth.structure,
    quality,
  };
}
