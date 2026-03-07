import { assembleStructureToMarkdown } from './prdAssembler';
import { parsePRDToStructure } from './prdParser';
import type { PRDStructure, FeatureSpec } from './prdStructure';
import {
  buildSectionFallback,
  collectPlaceholderIssues,
  collectTemplateSemanticIssues,
  isGenericFallback,
  type RequiredSectionKey,
} from './prdTemplateIntent';
import {
  applyConservativeFeatureAggregation,
  collectBoilerplateRepetitionIssues,
  collectCrossSectionSimilarityIssues,
  collectLanguageConsistencyIssues,
  collectMetaLeakIssues,
  findFeatureAggregationCandidates,
  sanitizeMetaLeaksInStructure,
  type FeatureAggregationAnalysis,
} from './prdQualitySignals';
import { hasText, normalizeForMatch, cloneStructure } from './prdTextUtils';

type SupportedLanguage = 'de' | 'en';

export interface PrdQualityIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  evidencePath?: string;
  evidenceSnippet?: string;
}

export interface PrdQualityReport {
  valid: boolean;
  truncatedLikely: boolean;
  missingSections: string[];
  featureCount: number;
  issues: PrdQualityIssue[];
  fallbackSections?: string[];
}

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

const REQUIRED_SECTION_DEFS: Array<{
  key: keyof PRDStructure;
  label: string;
  fallbackEn: string;
  fallbackDe: string;
}> = [
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

const FEATURE_STRUCTURED_FIELDS: Array<keyof FeatureSpec> = [
  'purpose',
  'actors',
  'trigger',
  'preconditions',
  'mainFlow',
  'alternateFlows',
  'postconditions',
  'dataImpact',
  'uiImpact',
  'acceptanceCriteria',
];

interface ImproveMergeResult {
  structure: PRDStructure;
}

interface ValidationOptions {
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
}

function detectLanguage(
  explicitLanguage: SupportedLanguage | undefined,
  sample: string
): SupportedLanguage {
  if (explicitLanguage === 'de' || explicitLanguage === 'en') {
    return explicitLanguage;
  }

  const text = String(sample || '').toLowerCase();
  if (/[äöüß]/i.test(text)) return 'de';
  if (text.includes(' und ') || text.includes(' fuer ') || text.includes(' für ')) return 'de';
  return 'en';
}

function safeParseStructure(content: string): PRDStructure {
  try {
    return parsePRDToStructure(content);
  } catch {
    return {
      features: [],
      otherSections: {
        RawContent: content,
      },
    };
  }
}


function collectUnknownSectionHeadings(structure: PRDStructure): string[] {
  const unknownEntries = Object.entries(structure.otherSections || {})
    .filter(([heading, body]) => String(heading || '').trim().length > 0 && hasText(body))
    .map(([heading]) => String(heading).trim());

  return Array.from(new Set(unknownEntries));
}

function isLikelyFeatureIntroNoise(value: string): boolean {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^#{1,6}\s+/m.test(text)) return true;
  if (/\b(?:user\s+stories|must[- ]have|nice[- ]to[- ]have|part\s+[a-z])\b/i.test(text)) return true;
  return false;
}

function mergeFeatureCatalogueIntro(baseValue?: string, candidateValue?: string): string | undefined {
  const baseText = String(baseValue || '').trim();
  const candidateText = String(candidateValue || '').trim();

  if (!baseText && !candidateText) return undefined;
  if (baseText && !candidateText) return baseText;
  if (!baseText && candidateText) {
    if (isLikelyFeatureIntroNoise(candidateText)) return undefined;
    if (candidateText.length > 600) return undefined;
    return candidateText;
  }

  return mergeSectionWithPreservation(baseText, candidateText);
}

function normalizeStructureForCompiler(
  structure: PRDStructure,
  options: { strictCanonical: boolean }
): PRDStructure {
  const normalized = cloneStructure(structure);

  normalized.features = [...(normalized.features || [])].sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true })
  );

  if (options.strictCanonical) {
    normalized.otherSections = {};
  }

  return normalized;
}

function buildAnchor(value: string): string {
  const source = String(value || '').trim();
  if (!source) return '';

  const firstMeaningfulChunk = source
    .split(/\n|[.!?]/)
    .map(part => part.trim())
    .find(part => part.length >= 24) || source;

  const normalized = normalizeForMatch(firstMeaningfulChunk);
  if (normalized.length < 16) return '';
  return normalized.slice(0, 140);
}

export function looksLikeTruncatedOutput(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (trimmed.length < 80) return false;
  if (/\[truncated\]\s*$/i.test(trimmed)) return true;

  const lines = trimmed.split('\n').map(line => line.trim()).filter(Boolean);
  const lastLine = lines.length > 0 ? lines[lines.length - 1] : '';
  if (!lastLine) return false;

  if (/[.!?)]$/.test(lastLine)) return false;
  if (/^[-*]\s*$/.test(lastLine)) return true;
  if (/^\d+[.)]\s*$/.test(lastLine)) return true;
  if (/[*_`#:,(\-]$/.test(lastLine)) return true;

  const bulletOrNumbered = /^[-*]\s+/.test(lastLine) || /^\d+[.)]\s+/.test(lastLine);
  const lineText = lastLine
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim();
  const words = lineText.split(/\s+/).filter(Boolean);
  const startsWithIndefinite = /^(eine|ein|einer|einem|the|a|an)\b/i.test(lineText);
  const endsWithConnector = /\b(and|or|to|with|mit|und|oder|sowie|inklusive|von|for|in)\b$/i.test(lineText);

  if (bulletOrNumbered) {
    if (!lineText) return true;
    if (lineText.length < 10) return true;
    if (/[,:;(]$/.test(lineText)) return true;
    if (endsWithConnector) return true;
    if (startsWithIndefinite && words.length <= 5) return true;
    return false;
  }

  if (lineText.length < 12) return true;
  if (endsWithConnector) return true;
  return false;
}

function mergeFeatureSpecs(base: FeatureSpec, candidate: FeatureSpec): FeatureSpec {
  const merged: FeatureSpec = {
    ...base,
    ...candidate,
  };

  for (const field of FEATURE_STRUCTURED_FIELDS) {
    const baseValue = (base as any)[field];
    const candidateValue = (candidate as any)[field];
    const candidateHasValue = Array.isArray(candidateValue)
      ? candidateValue.length > 0
      : hasText(candidateValue);

    if (!candidateHasValue && baseValue !== undefined) {
      (merged as any)[field] = baseValue;
    }
  }

  const baseRaw = String(base.rawContent || '').trim();
  const candidateRaw = String(candidate.rawContent || '').trim();
  const candidateLooksTruncated = looksLikeTruncatedOutput(candidateRaw);

  if (!candidateRaw || candidateLooksTruncated) {
    merged.rawContent = baseRaw || candidateRaw;
    return merged;
  }

  if (!baseRaw) {
    merged.rawContent = candidateRaw;
    return merged;
  }

  const baseAnchor = buildAnchor(baseRaw);
  const candidateNormalized = normalizeForMatch(candidateRaw);
  if (baseAnchor && !candidateNormalized.includes(baseAnchor)) {
    merged.rawContent = `${baseRaw}\n\n${candidateRaw}`.trim();
    return merged;
  }

  merged.rawContent = candidateRaw;
  return merged;
}

function mergeFeatureMaps(
  base: FeatureSpec[],
  candidate: FeatureSpec[]
): { features: FeatureSpec[] } {
  const byId = new Map<string, FeatureSpec>();
  for (const feature of base) {
    byId.set(feature.id, { ...feature });
  }

  const sortedCandidate = [...candidate].sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true })
  );

  for (const feature of sortedCandidate) {
    const existing = byId.get(feature.id);
    if (!existing) {
      byId.set(feature.id, { ...feature });
      continue;
    }
    byId.set(feature.id, mergeFeatureSpecs(existing, feature));
  }

  return {
    features: Array.from(byId.values()).sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { numeric: true })
    ),
  };
}

function mergeSectionWithPreservation(baseValue: string, candidateValue: string): string {
  const baseText = String(baseValue || '').trim();
  const candidateText = String(candidateValue || '').trim();
  if (!baseText) return candidateText;
  if (!candidateText) return baseText;

  const anchor = buildAnchor(baseText);
  if (!anchor) return candidateText;
  const candidateNormalized = normalizeForMatch(candidateText);
  if (candidateNormalized.includes(anchor)) {
    return candidateText;
  }

  return `${baseText}\n\n${candidateText}`.trim();
}

function mergeStructuresForImproveWithDiagnostics(
  base: PRDStructure,
  candidate: PRDStructure
): ImproveMergeResult {
  const mergedFeatures = mergeFeatureMaps(
    base.features || [],
    candidate.features || []
  );

  const merged: PRDStructure = {
    ...base,
    ...candidate,
    features: mergedFeatures.features,
    featureCatalogueIntro: mergeFeatureCatalogueIntro(
      base.featureCatalogueIntro,
      candidate.featureCatalogueIntro
    ),
    otherSections: {
      ...(base.otherSections || {}),
    },
  };

  for (const def of REQUIRED_SECTION_DEFS) {
    const baseValue = base[def.key];
    const candidateValue = candidate[def.key];
    if (hasText(candidateValue) && hasText(baseValue)) {
      (merged as any)[def.key] = mergeSectionWithPreservation(
        String(baseValue || ''),
        String(candidateValue || '')
      );
      continue;
    }
    if (!hasText(candidateValue) && hasText(baseValue)) {
      (merged as any)[def.key] = baseValue;
    }
  }

  return {
    structure: merged,
  };
}

export function mergeStructuresForImprove(
  base: PRDStructure,
  candidate: PRDStructure
): PRDStructure {
  return mergeStructuresForImproveWithDiagnostics(base, candidate).structure;
}

export function ensurePrdRequiredSections(
  structure: PRDStructure,
  language: SupportedLanguage,
  context?: {
    templateCategory?: string;
    contextHint?: string;
  }
): { structure: PRDStructure; addedSections: string[] } {
  const updated: PRDStructure = {
    ...structure,
    otherSections: { ...(structure.otherSections || {}) },
    features: [...(structure.features || [])],
  };
  const addedSections: string[] = [];

  for (const def of REQUIRED_SECTION_DEFS) {
    if (hasText(updated[def.key])) continue;
    (updated as any)[def.key] = buildSectionFallback({
      section: def.key as RequiredSectionKey,
      language,
      category: context?.templateCategory,
      structure: updated,
      contextHint: context?.contextHint,
    }) || (language === 'de' ? def.fallbackDe : def.fallbackEn);
    addedSections.push(def.label);
  }

  return { structure: updated, addedSections };
}

export function ensurePrdSectionDepth(
  structure: PRDStructure,
  language: SupportedLanguage,
  context?: {
    templateCategory?: string;
    contextHint?: string;
  }
): { structure: PRDStructure; expandedSections: string[] } {
  const updated: PRDStructure = {
    ...structure,
    otherSections: { ...(structure.otherSections || {}) },
    features: [...(structure.features || [])],
  };
  const expandedSections: string[] = [];

  for (const def of REQUIRED_SECTION_DEFS) {
    const currentValue = String(updated[def.key] || '').trim();
    if (!currentValue || currentValue.length >= MIN_REQUIRED_SECTION_LENGTH) continue;

    const fallback = buildSectionFallback({
      section: def.key as RequiredSectionKey,
      language,
      category: context?.templateCategory,
      structure: updated,
      contextHint: context?.contextHint,
    }) || (language === 'de' ? def.fallbackDe : def.fallbackEn);
    const merged = mergeSectionWithPreservation(currentValue, fallback);
    if (merged.length > currentValue.length) {
      (updated as any)[def.key] = merged;
      expandedSections.push(def.label);
    }
  }

  return { structure: updated, expandedSections };
}

function hasStructuredFeatureValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return hasText(value);
}

/**
 * Extract field hints from a feature's rawContent to produce more specific
 * placeholder text than the fully generic templates.
 */
export function extractFieldHintsFromRaw(rawContent: string): {
  purposeHint?: string;
  actorHint?: string;
  triggerHint?: string;
  mainFlowHint?: string[];
  preconditionsHint?: string;
  postconditionsHint?: string;
  dataImpactHint?: string;
  uiImpactHint?: string;
} {
  if (!rawContent || rawContent.length < 20) return {};

  // For actor, trigger, and similar heuristic hints, only use content BEFORE
  // the first structured subsection marker (**N. Label**) to avoid extracting
  // spurious hints from previously scaffolded/assembled content. This ensures
  // idempotent compile-parse-compile cycles. Labeled sections (**4. Preconditions**)
  // are still extracted from the full rawContent via extractLabeledSection().
  const firstStructuredMarker = rawContent.search(/\*\*\d{1,2}\.\s+/);
  const proseSource = firstStructuredMarker > 0
    ? rawContent.substring(0, firstStructuredMarker).trim()
    : rawContent;

  const lines = rawContent
    .split('\n')
    .map(l => l.replace(/^#+\s*/, '').replace(/^\*+/, '').trim())
    .filter(Boolean);

  // Purpose: First substantive line that isn't a heading/ID or field label
  let purposeHint: string | undefined;
  for (const line of lines) {
    if (/^F-\d+/i.test(line)) continue;
    if (line.length < 15) continue;
    if (/^\d+\.\s/.test(line)) continue;
    purposeHint = line.endsWith('.') ? line : line + '.';
    break;
  }

  // Actors: Look for role mentions in proseSource only (before structured blocks)
  // to avoid extracting spurious hints from scaffold text like "User initiates..."
  const actorPatterns: [RegExp, string][] = [
    [/\b(?:admin(?:istrator)?|manager|moderator)\b/i, 'Admin'],
    [/\b(?:customer|client|buyer|seller|vendor|kaeufer|verkaeufer)\b/i, 'Customer'],
    [/\b(?:developer|engineer|tester|entwickler)\b/i, 'Developer'],
    [/\b(?:user|nutzer|anwender|benutzer|spieler|player)\b/i, 'User'],
  ];
  const foundActors: string[] = [];
  for (const [pattern, label] of actorPatterns) {
    if (pattern.test(proseSource)) foundActors.push(label);
  }
  const actorHint = foundActors.length > 0 ? foundActors.join(', ') : undefined;

  // Trigger: Look for action triggers in proseSource only
  const triggerMatch = proseSource.match(
    /\b(?:clicks?|taps?|navigates?|submits?|opens?|selects?|starts?|initiates?|klickt|navigiert|startet|oeffnet|waehlt)\s+[^.\n]{5,60}/i
  );
  const triggerHint = triggerMatch ? triggerMatch[0].trim() : undefined;

  // MainFlow: Extract numbered steps from full rawContent (labeled sections are expected)
  const numberedSteps = rawContent
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^\d+\.\s+/.test(l))
    .map(l => l.replace(/^\d+\.\s+/, '').trim())
    .filter(l => l.length >= 10);
  const mainFlowHint = numberedSteps.length >= 2 ? numberedSteps : undefined;

  // Preconditions: Look for labeled section in full rawContent
  const preconditionsHint = extractLabeledSection(rawContent, /(?:preconditions?|vorbedingungen?|voraussetzungen?)/i);

  // Postconditions: Look for labeled section
  const postconditionsHint = extractLabeledSection(rawContent, /(?:postconditions?|nachbedingungen?|ergebnis(?:se)?)/i);

  // Data Impact: Look for database/storage/data references
  const dataImpactHint = extractLabeledSection(rawContent, /(?:data\s*impact|daten(?:bank)?|speicher|storage|database|persist)/i);

  // UI Impact: Look for UI/display references
  const uiImpactHint = extractLabeledSection(rawContent, /(?:ui\s*impact|oberfl[aä]che|anzeige|display|screen|component)/i);

  return { purposeHint, actorHint, triggerHint, mainFlowHint, preconditionsHint, postconditionsHint, dataImpactHint, uiImpactHint };
}

/** Extract text following a labeled heading/bold-label within rawContent */
function extractLabeledSection(rawContent: string, labelPattern: RegExp): string | undefined {
  const lines = rawContent.split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].replace(/^\*+|\*+$/g, '').trim();
    // Skip feature headings (### F-XX: ...) and section headings (## ...)
    if (/^#{2,}\s*F-\d+/i.test(lines[idx].trim()) || /^#{2,}\s+\w/.test(lines[idx].trim())) continue;
    if (!labelPattern.test(line)) continue;
    // Collect text after the label line until next heading/label or blank
    const content: string[] = [];
    // Check if the label line itself contains content after ":"
    const colonPart = line.split(/[:\-—]\s*/);
    if (colonPart.length > 1 && colonPart.slice(1).join(' ').trim().length > 10) {
      content.push(colonPart.slice(1).join(' ').trim());
    }
    for (let j = idx + 1; j < lines.length && j < idx + 8; j++) {
      const next = lines[j].trim();
      if (!next) break;
      if (/^\*?\*?\d+\.\s/.test(next) || /^#+\s/.test(next) || /^\*\*\d+\./.test(next)) break;
      if (next.length > 10) content.push(next.replace(/^[-*•]\s*/, ''));
    }
    if (content.length > 0) return content.join(' ').substring(0, 300);
  }
  return undefined;
}

export function ensurePrdFeatureDepth(
  structure: PRDStructure,
  language: SupportedLanguage
): { structure: PRDStructure; expandedFeatures: number } {
  const updatedFeatures: FeatureSpec[] = [];
  let expandedFeatures = 0;

  for (let i = 0; i < (structure.features || []).length; i++) {
    const feature = { ...(structure.features[i] || {}) } as FeatureSpec;
    const hints = extractFieldHintsFromRaw(feature.rawContent || '');
    let changed = false;

    for (const field of FEATURE_STRUCTURED_FIELDS) {
      const currentValue = (feature as any)[field];
      if (hasStructuredFeatureValue(currentValue)) continue;

      // Prefer rawContent-derived hints over generic templates
      const safeName = feature.name || feature.id;
      if (field === 'purpose' && hints.purposeHint) {
        (feature as any)[field] = hints.purposeHint;
      } else if (field === 'actors' && hints.actorHint) {
        (feature as any)[field] = language === 'de'
          ? `Akteure: ${hints.actorHint} im Kontext von "${safeName}".`
          : `Actors: ${hints.actorHint} in the context of "${safeName}".`;
      } else if (field === 'trigger' && hints.triggerHint) {
        (feature as any)[field] = hints.triggerHint;
      } else if (field === 'mainFlow' && hints.mainFlowHint) {
        (feature as any)[field] = hints.mainFlowHint;
      } else if (field === 'preconditions' && hints.preconditionsHint) {
        (feature as any)[field] = hints.preconditionsHint;
      } else if (field === 'postconditions' && hints.postconditionsHint) {
        (feature as any)[field] = hints.postconditionsHint;
      } else if (field === 'dataImpact' && hints.dataImpactHint) {
        (feature as any)[field] = hints.dataImpactHint;
      } else if (field === 'uiImpact' && hints.uiImpactHint) {
        (feature as any)[field] = hints.uiImpactHint;
      }
      // No generic template fallback — leave field empty for the reviewer to
      // enrich with project-specific content via AI enrichment call.
      if ((feature as any)[field] !== currentValue) changed = true;
    }

    // Second pass: ensure critical fields have minimal name-derived scaffolds
    // as safety net in case AI enrichment fails downstream
    const CRITICAL_SCAFFOLD_FIELDS: string[] = ['purpose', 'mainFlow', 'acceptanceCriteria'];
    for (const critField of CRITICAL_SCAFFOLD_FIELDS) {
      if (hasStructuredFeatureValue((feature as any)[critField])) continue;
      const safeName = feature.name || feature.id;
      if (critField === 'purpose') {
        (feature as any)[critField] = language === 'de'
          ? `${safeName} stellt die beschriebene Funktionalität bereit.`
          : `${safeName} provides the described functionality.`;
        changed = true;
      } else if (critField === 'mainFlow') {
        (feature as any)[critField] = language === 'de'
          ? [`Nutzer initiiert ${safeName}.`, `System führt ${safeName} aus.`, `Ergebnis wird angezeigt.`]
          : [`User initiates ${safeName}.`, `System executes ${safeName}.`, `Result is displayed.`];
        changed = true;
      } else if (critField === 'acceptanceCriteria') {
        (feature as any)[critField] = language === 'de'
          ? [`${safeName} kann erfolgreich ausgeführt werden.`, `Fehlerfälle liefern eine klare Fehlermeldung.`]
          : [`${safeName} can be executed successfully.`, `Error cases produce a clear error message.`];
        changed = true;
      }
    }

    if (changed) expandedFeatures++;
    updatedFeatures.push(feature);
  }

  return {
    structure: {
      ...structure,
      features: updatedFeatures,
      otherSections: { ...(structure.otherSections || {}) },
    },
    expandedFeatures,
  };
}

export function validatePrdStructure(
  structure: PRDStructure,
  rawContent: string,
  options?: ValidationOptions
): PrdQualityReport {
  const issues: PrdQualityIssue[] = [];
  const missingSections: string[] = [];
  const strictCanonical = options?.strictCanonical !== false;
  const unknownSectionHeadings = options?.unknownSectionHeadings || [];
  const knownFallbackSections = new Set((options?.fallbackSections || []).map(section =>
    String(section || '').toLowerCase().replace(/[^a-z]/g, '')
  ));

  for (const def of REQUIRED_SECTION_DEFS) {
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
    if (length < MIN_REQUIRED_SECTION_LENGTH) {
      issues.push({
        code: `too_short_${String(def.key)}`,
        message: `Section too short: ${def.label}`,
        severity: 'warning',
      });
    }

    const normalizedSectionKey = String(def.key).toLowerCase().replace(/[^a-z]/g, '');
    const wasCompilerFilled = [...knownFallbackSections].some(section =>
      section.includes(normalizedSectionKey) || normalizedSectionKey.includes(section)
    );

    // ÄNDERUNG 07.03.2026: Template-/Fallback-Boilerplate soll frueh erkannt
    // werden, aber nicht die bewusst vom Compiler selbst eingefuegten
    // Recovery-Sektionen doppelt als generische Modellausgabe bestrafen.
    if (!wasCompilerFilled && isGenericFallback(String(value || ''))) {
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
      code: 'missing_feature_catalogue',
      message: 'Functional Feature Catalogue is missing or empty.',
      severity: 'error',
    });
  } else {
    const INCOMPLETE_THRESHOLD = 5; // < 5 of 10 fields filled = incomplete
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

    // Feature CONTENT quality check: verify filled fields have SUBSTANTIVE content
    // (not just name-derived scaffolds or single-sentence boilerplate)
    const thinFeatures: string[] = [];
    const shallowFeatures: string[] = [];
    for (const feature of structure.features) {
      let substantialFieldCount = 0;
      const featureNameLower = (feature.name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
      const featureNameWords = new Set(featureNameLower.split(/\s+/).filter(w => w.length >= 3));

      for (const field of FEATURE_STRUCTURED_FIELDS) {
        const value = (feature as any)[field];
        if (Array.isArray(value)) {
          // Array fields: mainFlow needs >= 3 steps, acceptanceCriteria >= 2 items
          const minItems = field === 'mainFlow' ? 3 : field === 'acceptanceCriteria' ? 2 : 1;
          const meaningful = value.filter((entry: string) => String(entry || '').trim().length >= 10);
          if (meaningful.length >= minItems) {
            substantialFieldCount++;
          }
        } else if (typeof value === 'string') {
          const text = value.trim();
          // String fields: purpose needs >= 30 chars, others >= 20 chars
          const minLen = field === 'purpose' ? 30 : 20;
          if (text.length >= minLen) {
            // Check for name-echo: if content is just the feature name rephrased
            const textLower = text.toLowerCase().replace(/[^a-z0-9\s]/g, '');
            const textWords = new Set(textLower.split(/\s+/).filter(w => w.length >= 3));
            const overlap = [...featureNameWords].filter(w => textWords.has(w)).length;
            const echoRatio = featureNameWords.size > 0 ? overlap / featureNameWords.size : 0;
            // If >80% of feature name words appear in this field AND field is short, it's an echo
            if (echoRatio > 0.8 && text.length < 60) {
              // Name echo — not substantial
            } else {
              substantialFieldCount++;
            }
          }
        }
      }

      if (substantialFieldCount > 0 && substantialFieldCount < 3) {
        thinFeatures.push(`${feature.id}: ${feature.name} (${substantialFieldCount} substantial fields)`);
      }
      // Shallow: formally filled but lacking depth (has fields but < 4 are substantial)
      if (substantialFieldCount < 4) {
        shallowFeatures.push(`${feature.id}: ${feature.name} (${substantialFieldCount}/10 substantial)`);
      }
    }
    // Thin features: > 30% threshold (lowered from 50%)
    if (thinFeatures.length > 0 && thinFeatures.length > featureCount * 0.3) {
      issues.push({
        code: 'feature_content_thin',
        message: `${thinFeatures.length} feature(s) have trivially thin content: ${thinFeatures.join('; ')}`,
        severity: 'warning',
      });
    }
    // Shallow features: formally filled but lacking substance
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
  // Only flag truncation based on the assembled structure.  If the parser
  // recovered a clean structure from a truncated source, the PRD is usable.
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

  // Structural incompleteness: headings present but body missing
  if (!truncatedLikely) {
    const hasFeatureCatalogueIntro = hasText(structure.featureCatalogueIntro) ||
      hasText((structure.otherSections as any)?.featureCatalogueIntro);
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
    const unknownHeadingSeverity: 'error' | 'warning' = options?.mode === 'generate'
      ? 'error'
      : 'warning';
    issues.push({
      code: 'unknown_top_level_sections',
      message: `Unknown top-level section heading(s): ${unknownSectionHeadings.join(', ')}`,
      severity: unknownHeadingSeverity,
    });
  }

  const templateSemanticIssues = collectTemplateSemanticIssues({
    category: options?.templateCategory,
    structure,
    content: assembled,
    mode: options?.mode || 'generate',
    fallbackSections: options?.fallbackSections || [],
  });
  for (const issue of templateSemanticIssues) {
    issues.push(issue);
  }

  const placeholderIssues = collectPlaceholderIssues({
    structure,
    mode: options?.mode || 'generate',
  });
  for (const issue of placeholderIssues) {
    issues.push(issue);
  }

  const boilerplateIssues = collectBoilerplateRepetitionIssues(structure);
  for (const issue of boilerplateIssues) {
    issues.push(issue);
  }

  const metaLeakIssues = collectMetaLeakIssues(structure);
  for (const issue of metaLeakIssues) {
    issues.push(issue);
  }

  const crossSectionIssues = collectCrossSectionSimilarityIssues(structure);
  for (const issue of crossSectionIssues) {
    issues.push(issue);
  }

  const strictLanguageConsistency = options?.strictLanguageConsistency !== false;
  if (strictLanguageConsistency) {
    const languageIssues = collectLanguageConsistencyIssues(
      structure,
      options?.targetLanguage || 'en',
      options?.templateCategory
    );
    for (const issue of languageIssues) {
      issues.push(issue);
    }
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
  const totalRequiredSections = REQUIRED_SECTION_DEFS.length;
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
  };
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
      candidate
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
