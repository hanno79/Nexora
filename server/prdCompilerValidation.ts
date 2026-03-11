/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Validierungslogik und Qualitaetsreporting fuer den PRD-Compiler.
*/

// ÄNDERUNG 08.03.2026: Validierungs-Helfer aus `server/prdCompiler.ts` als sechster risikoarmer Phase-2-Minimalsplit extrahiert.

import { assembleStructureToMarkdown } from './prdAssembler';
import { looksLikeTruncatedOutput, type RequiredSectionDefinition } from './prdCompilerMerge';
import { collectDeterministicSemanticIssues } from './prdDeterministicSemanticLints';
import { collectVisionFirstCoverageDiagnostics } from './prdDeterministicSemanticLints';
import { collectTimelineConsistencyDiagnostics } from './prdDeterministicSemanticLints';
import { FEATURE_STRUCTURED_FIELDS } from './prdFeatureDepth';
import type { PRDStructure } from './prdStructure';
import {
  collectPlaceholderIssues,
  collectTemplateSemanticIssues,
  isGenericFallback,
  buildSectionFallback,
  type RequiredSectionKey,
} from './prdTemplateIntent';
import {
  collectBoilerplateRepetitionIssues,
  collectCrossSectionSimilarityIssues,
  collectLanguageConsistencyIssues,
  collectMetaLeakIssues,
} from './prdQualitySignals';
import { hasText, isCompilerFilledSection, normalizeForMatch } from './prdTextUtils';

type SupportedLanguage = 'de' | 'en';

export interface PrdQualityIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  evidencePath?: string;
  evidenceSnippet?: string;
  relatedPaths?: string[];
}

export interface PrdQualityReport {
  valid: boolean;
  truncatedLikely: boolean;
  missingSections: string[];
  featureCount: number;
  issues: PrdQualityIssue[];
  fallbackSections?: string[];
  structuralParseReason?: string;
  rawFeatureHeadingSamples?: string[];
  normalizationApplied?: boolean;
  normalizedFeatureCountRecovered?: number;
  primaryCapabilityAnchors?: string[];
  featurePriorityWindow?: string[];
  coreFeatureIds?: string[];
  supportFeatureIds?: string[];
  canonicalFeatureIds?: string[];
  timelineMismatchedFeatureIds?: string[];
}

export interface ValidationOptions {
  sourceContent?: string;
  strictCanonical?: boolean;
  unknownSectionHeadings?: string[];
  mode?: 'generate' | 'improve';
  templateCategory?: string;
  targetLanguage?: SupportedLanguage;
  strictLanguageConsistency?: boolean;
  aggregationAppliedCount?: number;
  aggregationNearDuplicateCount?: number;
  fallbackSections?: string[];
  structuralParseReason?: string;
  rawFeatureHeadingSamples?: string[];
  normalizationApplied?: boolean;
  normalizedFeatureCountRecovered?: number;
  contextHint?: string;
  baselineStructure?: PRDStructure;
}

function matchesCurrentSectionFallback(params: {
  section: RequiredSectionKey;
  value: string;
  structure: PRDStructure;
  language: SupportedLanguage;
  templateCategory?: string;
  contextHint?: string;
}): boolean {
  const normalizedValue = normalizeForMatch(String(params.value || ''));
  if (!normalizedValue) return false;

  const fallback = buildSectionFallback({
    section: params.section,
    language: params.language,
    category: params.templateCategory,
    structure: params.structure,
    contextHint: params.contextHint,
  });
  const normalizedFallback = normalizeForMatch(String(fallback || ''));
  if (!normalizedFallback) return false;

  return normalizedValue === normalizedFallback
    || normalizedValue.includes(normalizedFallback)
    || normalizedFallback.includes(normalizedValue);
}

export function validatePrdStructureInternal(
  structure: PRDStructure,
  rawContent: string,
  requiredSectionDefs: RequiredSectionDefinition[],
  minRequiredSectionLength: number,
  options?: ValidationOptions
): PrdQualityReport {
  const issues: PrdQualityIssue[] = [];
  const missingSections: string[] = [];
  const strictCanonical = options?.strictCanonical !== false;
  const unknownSectionHeadings = options?.unknownSectionHeadings || [];
  const structuralParseReason = String(options?.structuralParseReason || '').trim() || undefined;
  const rawFeatureHeadingSamples = Array.from(new Set(
    (options?.rawFeatureHeadingSamples || []).map(sample => String(sample || '').trim()).filter(Boolean)
  )).slice(0, 5);
  const normalizationApplied = options?.normalizationApplied;
  const normalizedFeatureCountRecovered = typeof options?.normalizedFeatureCountRecovered === 'number'
    ? options.normalizedFeatureCountRecovered
    : undefined;
  const knownFallbackSections = new Set((options?.fallbackSections || []).map(section =>
    String(section || '').toLowerCase().replace(/[^a-z]/g, '')
  ));

  for (const def of requiredSectionDefs) {
    const value = structure[def.key];
    if (!hasText(value)) {
      missingSections.push(def.label);
      issues.push({
        code: `missing_section_${String(def.key)}`,
        message: `Missing required section: ${def.label}`,
        severity: 'error',
      });
      continue;
    }

    const length = String(value).trim().length;
    if (length < minRequiredSectionLength) {
      issues.push({
        code: `too_short_${String(def.key)}`,
        message: `Section too short: ${def.label}`,
        severity: 'warning',
      });
    }

    const wasCompilerFilled = isCompilerFilledSection(String(def.key), knownFallbackSections);

    // ÄNDERUNG 07.03.2026: Template-/Fallback-Boilerplate soll frueh erkannt
    // werden, aber nicht die bewusst vom Compiler selbst eingefuegten
    // Recovery-Sektionen doppelt als generische Modellausgabe bestrafen.
    const matchesCurrentFallback = matchesCurrentSectionFallback({
      section: def.key as RequiredSectionKey,
      value: String(value || ''),
      structure,
      language: options?.targetLanguage || 'en',
      templateCategory: options?.templateCategory,
      contextHint: options?.sourceContent || rawContent,
    });

    if (!wasCompilerFilled && !matchesCurrentFallback && isGenericFallback(String(value || ''))) {
      issues.push({
        code: `generic_section_boilerplate_${String(def.key)}`,
        message: `Section appears generic and not context-specific: ${def.label}`,
        severity: options?.mode === 'generate' ? 'error' : 'warning',
      });
    }
  }

  const featureCount = Array.isArray(structure.features) ? structure.features.length : 0;
  if (featureCount === 0) {
    issues.push({
      code: structuralParseReason === 'feature_catalogue_format_mismatch' || rawFeatureHeadingSamples.length > 0
        ? 'feature_catalogue_format_mismatch'
        : 'missing_feature_catalogue',
      message: structuralParseReason === 'feature_catalogue_format_mismatch' || rawFeatureHeadingSamples.length > 0
        ? `Functional Feature Catalogue exists in raw markdown but could not be parsed into canonical F-XX features.${rawFeatureHeadingSamples.length > 0 ? ` Examples: ${rawFeatureHeadingSamples.join(' | ')}` : ''}`
        : 'Functional Feature Catalogue is missing or empty.',
      severity: 'error',
    });
  } else {
    const INCOMPLETE_THRESHOLD = 5;
    const incompleteFeatures: string[] = [];
    const emptyFeatures: string[] = [];

    for (const feature of structure.features) {
      const filledStructuredFields = FEATURE_STRUCTURED_FIELDS.reduce((count, field) => {
        const value = (feature as any)[field];
        if (Array.isArray(value)) return count + (value.length > 0 ? 1 : 0);
        return count + (hasText(value) ? 1 : 0);
      }, 0);
      if (filledStructuredFields === 0) {
        emptyFeatures.push(`${feature.id}: ${feature.name} (0/${FEATURE_STRUCTURED_FIELDS.length})`);
      } else if (filledStructuredFields < INCOMPLETE_THRESHOLD) {
        incompleteFeatures.push(`${feature.id}: ${feature.name} (${filledStructuredFields}/${FEATURE_STRUCTURED_FIELDS.length})`);
      }
    }

    if (emptyFeatures.length === featureCount) {
      issues.push({
        code: 'feature_specs_unstructured',
        message: 'All feature entries are unstructured. Each feature needs the 10-section specification template.',
        severity: 'error',
      });
    } else if (emptyFeatures.length > 0) {
      issues.push({
        code: 'feature_specs_partially_unstructured',
        message: `${emptyFeatures.length} feature(s) have no structured subsections: ${emptyFeatures.join('; ')}`,
        severity: options?.mode === 'generate' ? 'error' : 'warning',
      });
    }
    if (incompleteFeatures.length > 0) {
      issues.push({
        code: 'feature_specs_incomplete',
        message: `${incompleteFeatures.length} feature(s) have incomplete specs (<${INCOMPLETE_THRESHOLD} of ${FEATURE_STRUCTURED_FIELDS.length} fields): ${incompleteFeatures.join('; ')}`,
        severity: 'warning',
      });
    }

    const thinFeatures: string[] = [];
    const shallowFeatures: string[] = [];
    for (const feature of structure.features) {
      let substantialFieldCount = 0;
      const featureNameLower = (feature.name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
      const featureNameWords = new Set(featureNameLower.split(/\s+/).filter(w => w.length >= 3));

      for (const field of FEATURE_STRUCTURED_FIELDS) {
        const value = (feature as any)[field];
        if (Array.isArray(value)) {
          const minItems = field === 'mainFlow' ? 3 : field === 'acceptanceCriteria' ? 2 : 1;
          const meaningful = value.filter((entry: string) => String(entry || '').trim().length >= 10);
          if (meaningful.length >= minItems) {
            substantialFieldCount++;
          }
        } else if (typeof value === 'string') {
          const text = value.trim();
          const minLen = field === 'purpose' ? 30 : 20;
          if (text.length >= minLen) {
            const textLower = text.toLowerCase().replace(/[^a-z0-9\s]/g, '');
            const textWords = new Set(textLower.split(/\s+/).filter(w => w.length >= 3));
            const overlap = [...featureNameWords].filter(w => textWords.has(w)).length;
            const echoRatio = featureNameWords.size > 0 ? overlap / featureNameWords.size : 0;
            if (!(echoRatio > 0.8 && text.length < 60)) {
              substantialFieldCount++;
            }
          }
        }
      }

      if (substantialFieldCount > 0 && substantialFieldCount < 3) {
        thinFeatures.push(`${feature.id}: ${feature.name} (${substantialFieldCount} substantial fields)`);
      }
      if (substantialFieldCount < 4) {
        shallowFeatures.push(`${feature.id}: ${feature.name} (${substantialFieldCount}/10 substantial)`);
      }
    }

    if (thinFeatures.length > 0 && thinFeatures.length > featureCount * 0.3) {
      issues.push({
        code: 'feature_content_thin',
        message: `${thinFeatures.length} feature(s) have trivially thin content: ${thinFeatures.join('; ')}`,
        severity: 'warning',
      });
    }
    if (shallowFeatures.length > 0 && shallowFeatures.length > featureCount * 0.3) {
      issues.push({
        code: 'feature_content_shallow',
        message: `${shallowFeatures.length}/${featureCount} feature(s) have shallow content (< 4 substantial fields): ${shallowFeatures.slice(0, 5).join('; ')}${shallowFeatures.length > 5 ? '...' : ''}`,
        severity: 'warning',
      });
    }
  }

  const assembled = assembleStructureToMarkdown(structure);
  const sourceContent = String(options?.sourceContent || rawContent || '');
  const assembledTruncated = looksLikeTruncatedOutput(assembled);
  const truncatedLikely = assembledTruncated;
  if (assembledTruncated) {
    issues.push({
      code: 'truncated_output',
      message: 'Output appears truncated or cut off.',
      severity: 'error',
    });
  } else if (looksLikeTruncatedOutput(sourceContent)) {
    issues.push({
      code: 'truncated_output',
      message: 'Raw model output was truncated but the compiler recovered a usable structure.',
      severity: 'warning',
    });
  }

  if (!truncatedLikely) {
    const hasFeatureCatalogueIntro = hasText(structure.featureCatalogueIntro)
      || hasText((structure.otherSections as any)?.featureCatalogueIntro);
    if (hasFeatureCatalogueIntro && featureCount === 0) {
      issues.push({
        code: 'structural_incompleteness',
        message: 'Feature catalogue heading present but no features parsed — output may be structurally incomplete.',
        severity: 'warning',
      });
    }
    const skeletonFeatures = (structure.features || []).filter(f => {
      const rawLen = String(f.rawContent || '').trim().length;
      const hasAnyField = FEATURE_STRUCTURED_FIELDS.some(field => {
        const val = (f as any)[field];
        return Array.isArray(val) ? val.length > 0 : hasText(val);
      });
      return rawLen < 20 && !hasAnyField;
    });
    if (skeletonFeatures.length > 0) {
      issues.push({
        code: 'structural_incompleteness',
        message: `${skeletonFeatures.length} feature(s) have no meaningful content — possible mid-document truncation.`,
        severity: 'warning',
      });
    }
  }

  if (strictCanonical && unknownSectionHeadings.length > 0) {
    const unknownHeadingSeverity: 'error' | 'warning' = options?.mode === 'generate' ? 'error' : 'warning';
    issues.push({
      code: 'unknown_top_level_sections',
      message: `Unknown top-level section heading(s): ${unknownSectionHeadings.join(', ')}`,
      severity: unknownHeadingSeverity,
    });
  }

  issues.push(...collectTemplateSemanticIssues({
    category: options?.templateCategory,
    structure,
    content: assembled,
    mode: options?.mode || 'generate',
    fallbackSections: options?.fallbackSections || [],
  }));
  issues.push(...collectPlaceholderIssues({
    structure,
    mode: options?.mode || 'generate',
  }));
  issues.push(...collectBoilerplateRepetitionIssues(structure));
  issues.push(...collectMetaLeakIssues(structure));
  const visionFirstDiagnostics = collectVisionFirstCoverageDiagnostics(structure, {
    mode: options?.mode,
    language: options?.targetLanguage,
    fallbackSections: options?.fallbackSections || [],
    contextHint: options?.contextHint,
    baselineStructure: options?.baselineStructure,
  });
  const timelineConsistencyDiagnostics = collectTimelineConsistencyDiagnostics(structure);
  issues.push(...collectDeterministicSemanticIssues(structure, {
    mode: options?.mode,
    language: options?.targetLanguage,
    fallbackSections: options?.fallbackSections || [],
    contextHint: options?.contextHint,
    baselineStructure: options?.baselineStructure,
  }));
  issues.push(...collectCrossSectionSimilarityIssues(structure));

  const strictLanguageConsistency = options?.strictLanguageConsistency !== false;
  if (strictLanguageConsistency) {
    issues.push(...collectLanguageConsistencyIssues(
      structure,
      options?.targetLanguage || 'en',
      options?.templateCategory
    ));
  }

  if ((options?.aggregationAppliedCount || 0) > 0) {
    issues.push({
      code: 'feature_aggregation_applied',
      message: `Conservative feature aggregation merged ${options?.aggregationAppliedCount || 0} near-duplicate feature(s).`,
      severity: 'warning',
    });
  }

  if ((options?.aggregationNearDuplicateCount || 0) > 0) {
    issues.push({
      code: 'feature_near_duplicates_unmerged',
      message: `${options?.aggregationNearDuplicateCount || 0} potential near-duplicate feature pair(s) were detected but not auto-merged (low confidence).`,
      severity: 'warning',
    });
  }

  const fallbackSections = options?.fallbackSections || [];
  const totalRequiredSections = requiredSectionDefs.length;
  if (options?.mode === 'generate' && fallbackSections.length > totalRequiredSections * 0.6) {
    issues.push({
      code: 'excessive_fallback_sections',
      message: `${fallbackSections.length}/${totalRequiredSections} sections were auto-generated by the compiler. AI output is substantially incomplete.`,
      severity: 'warning',
    });
  } else if (fallbackSections.length > 3) {
    issues.push({
      code: 'high_fallback_section_count',
      message: `${fallbackSections.length} sections were auto-generated by the compiler. AI output may be substantially incomplete.`,
      severity: 'warning',
    });
  }

  const hasErrors = issues.some(issue => issue.severity === 'error');
  return {
    valid: !hasErrors,
    truncatedLikely,
    missingSections,
    featureCount,
    issues,
    fallbackSections: fallbackSections.length > 0 ? fallbackSections : undefined,
    structuralParseReason,
    rawFeatureHeadingSamples: rawFeatureHeadingSamples.length > 0 ? rawFeatureHeadingSamples : undefined,
    normalizationApplied,
    normalizedFeatureCountRecovered,
    primaryCapabilityAnchors: visionFirstDiagnostics.primaryCapabilityAnchors.length > 0
      ? visionFirstDiagnostics.primaryCapabilityAnchors
      : undefined,
    featurePriorityWindow: visionFirstDiagnostics.featurePriorityWindow.length > 0
      ? visionFirstDiagnostics.featurePriorityWindow
      : undefined,
    coreFeatureIds: visionFirstDiagnostics.coreFeatureIds.length > 0
      ? visionFirstDiagnostics.coreFeatureIds
      : undefined,
    supportFeatureIds: visionFirstDiagnostics.supportFeatureIds.length > 0
      ? visionFirstDiagnostics.supportFeatureIds
      : undefined,
    canonicalFeatureIds: timelineConsistencyDiagnostics.canonicalFeatureIds.length > 0
      ? timelineConsistencyDiagnostics.canonicalFeatureIds
      : undefined,
    timelineMismatchedFeatureIds: timelineConsistencyDiagnostics.timelineMismatchedFeatureIds.length > 0
      ? timelineConsistencyDiagnostics.timelineMismatchedFeatureIds
      : undefined,
  };
}
