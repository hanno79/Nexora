import { assembleStructureToMarkdown } from './prdAssembler';
import { parsePRDToStructure } from './prdParser';
import type { PRDStructure, FeatureSpec } from './prdStructure';
import {
  buildSectionFallback,
  collectPlaceholderIssues,
  collectTemplateSemanticIssues,
  isLegacyGenericFallback,
  type RequiredSectionKey,
} from './prdTemplateIntent';
import {
  applyConservativeFeatureAggregation,
  collectBoilerplateRepetitionIssues,
  collectLanguageConsistencyIssues,
  collectMetaLeakIssues,
  findFeatureAggregationCandidates,
  sanitizeMetaLeaksInStructure,
  type FeatureAggregationAnalysis,
} from './prdQualitySignals';

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

const MIN_REQUIRED_SECTION_LENGTH = 30;

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
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
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

function cloneStructureShallow(structure: PRDStructure): PRDStructure {
  return {
    ...structure,
    features: [...(structure.features || [])].map(feature => ({ ...feature })),
    otherSections: { ...(structure.otherSections || {}) },
  };
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

function normalizeForMatch(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[`*_>#-]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const normalized = cloneStructureShallow(structure);

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

function buildFeatureFieldTemplate(
  featureName: string,
  language: SupportedLanguage,
  variant: number
): Pick<FeatureSpec, 'purpose' | 'actors' | 'trigger' | 'preconditions' | 'mainFlow' | 'alternateFlows' | 'postconditions' | 'dataImpact' | 'uiImpact' | 'acceptanceCriteria'> {
  const safeName = String(featureName || '').trim() || `Feature ${variant + 1}`;
  const isGerman = language === 'de';
  const pick = (values: string[]) => values[variant % values.length];

  if (isGerman) {
    return {
      purpose: pick([
        `"${safeName}" liefert einen klar abgegrenzten Nutzerwert mit messbarem Ergebnis.`,
        `Das Feature "${safeName}" beschreibt einen eigenstaendigen, testbaren Anwendungsfall.`,
        `"${safeName}" wird als implementierbare Funktionseinheit mit eindeutiger Wirkung umgesetzt.`,
      ]),
      actors: pick([
        `Primaer: Endnutzer im Kontext von "${safeName}". Sekundaer: API- und Persistenzschicht.`,
        `Akteure sind Nutzer, die "${safeName}" ausloesen, sowie Systemdienste zur Verarbeitung.`,
        `Nutzer interagieren direkt mit "${safeName}", waehrend das Backend Validierung und Speicherung uebernimmt.`,
      ]),
      trigger: pick([
        `Der Nutzer startet "${safeName}" explizit ueber die Benutzeroberflaeche.`,
        `"${safeName}" wird durch eine konkrete Nutzeraktion oder einen definierten Systemevent ausgeloest.`,
        `Ein UI-Event initiiert den Ablauf von "${safeName}".`,
      ]),
      preconditions: pick([
        `Alle benoetigten Eingaben sind vorhanden und vorvalidiert.`,
        `Authentifizierung und Berechtigungen fuer "${safeName}" sind erfuellt.`,
        `Abhaengige Dienste sind erreichbar und die Anwendung befindet sich in einem konsistenten Zustand.`,
      ]),
      mainFlow: [
        `System nimmt die Anfrage fuer "${safeName}" entgegen und validiert Eingaben.`,
        `Geschaeftslogik fuer "${safeName}" wird deterministisch ausgefuehrt.`,
        `Relevante Daten werden atomar gespeichert oder aktualisiert.`,
        `UI wird mit dem Ergebnis von "${safeName}" aktualisiert und bestaetigt den Abschluss.`,
      ],
      alternateFlows: [
        `Validierung fehlgeschlagen: Das System liefert eine klare Fehlermeldung ohne Seiteneffekte.`,
        `Temporärer Fehler: Das System protokolliert den Fehler und bietet einen Retry-Pfad an.`,
      ],
      postconditions: `Nach Abschluss von "${safeName}" ist der resultierende Zustand konsistent, gespeichert und fuer Folgeaktionen verfuegbar.`,
      dataImpact: `Das Feature "${safeName}" liest und aktualisiert nur die relevanten Entitaeten innerhalb des definierten Scopes.`,
      uiImpact: `Die Oberflaeche zeigt Lade-, Erfolg- und Fehlerzustaende fuer "${safeName}" konsistent und nachvollziehbar an.`,
      acceptanceCriteria: [
        `"${safeName}" ist fuer einen Nutzer ohne manuelles Nachladen in der UI verifizierbar.`,
        `Fehlerfaelle von "${safeName}" liefern klare Nutzerhinweise und hinterlassen keinen inkonsistenten Zustand.`,
        `Die durch "${safeName}" verursachten Datenaenderungen sind nach Ausfuehrung nachvollziehbar vorhanden.`,
      ],
    };
  }

  return {
    purpose: pick([
      `"${safeName}" delivers a clearly scoped user capability with an observable outcome.`,
      `The feature "${safeName}" defines an independent, testable workflow.`,
      `"${safeName}" is implemented as a deterministic functional unit with explicit behavior.`,
    ]),
    actors: pick([
      `Primary: end user invoking "${safeName}". Secondary: API and persistence services.`,
      `Actors include users triggering "${safeName}" and backend services processing the request.`,
      `Users interact with "${safeName}" while backend components validate and persist state.`,
    ]),
    trigger: pick([
      `User explicitly initiates "${safeName}" through the interface.`,
      `"${safeName}" is triggered by a concrete user action or defined system event.`,
      `A UI event starts the "${safeName}" workflow.`,
    ]),
    preconditions: pick([
      `Required inputs are present and validated before execution.`,
      `Authentication and authorization requirements for "${safeName}" are satisfied.`,
      `Dependent services are reachable and system state is consistent.`,
    ]),
    mainFlow: [
      `System receives the "${safeName}" request and validates input.`,
      `Business logic for "${safeName}" executes deterministically.`,
      `Relevant data is created or updated atomically.`,
      `UI reflects the result of "${safeName}" and confirms completion.`,
    ],
    alternateFlows: [
      `Validation failure: system returns a clear error and performs no partial write.`,
      `Transient failure: system logs the issue and offers a retry path.`,
    ],
    postconditions: `After "${safeName}" completes, resulting state is consistent, persisted, and available for follow-up actions.`,
    dataImpact: `The "${safeName}" workflow reads and updates only in-scope entities required for this feature.`,
    uiImpact: `UI surfaces loading, success, and error states for "${safeName}" consistently and transparently.`,
    acceptanceCriteria: [
      `"${safeName}" is verifiable by end users directly in the UI without manual reload.`,
      `Error paths for "${safeName}" provide clear user feedback and keep state consistent.`,
      `Data mutations caused by "${safeName}" are observable after execution.`,
    ],
  };
}

export function ensurePrdFeatureDepth(
  structure: PRDStructure,
  language: SupportedLanguage
): { structure: PRDStructure; expandedFeatures: number } {
  const updatedFeatures: FeatureSpec[] = [];
  let expandedFeatures = 0;

  for (let i = 0; i < (structure.features || []).length; i++) {
    const feature = { ...(structure.features[i] || {}) } as FeatureSpec;
    const template = buildFeatureFieldTemplate(feature.name || feature.id, language, i);
    let changed = false;

    for (const field of FEATURE_STRUCTURED_FIELDS) {
      const currentValue = (feature as any)[field];
      if (hasStructuredFeatureValue(currentValue)) continue;
      (feature as any)[field] = (template as any)[field];
      changed = true;
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

    if (isLegacyGenericFallback(String(value || ''))) {
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
    const emptyStructuredFeatures = structure.features.filter(feature => {
      const filledStructuredFields = FEATURE_STRUCTURED_FIELDS.reduce((count, field) => {
        const value = (feature as any)[field];
        if (Array.isArray(value)) return count + (value.length > 0 ? 1 : 0);
        return count + (hasText(value) ? 1 : 0);
      }, 0);
      return filledStructuredFields === 0;
    });

    if (emptyStructuredFeatures.length === featureCount) {
      issues.push({
        code: 'feature_specs_unstructured',
        message: 'All feature entries are unstructured. Each feature needs the 10-section specification template.',
        severity: 'error',
      });
    } else if (emptyStructuredFeatures.length > 0) {
      issues.push({
        code: 'feature_specs_partially_unstructured',
        message: `${emptyStructuredFeatures.length} feature(s) are missing structured subsections.`,
        severity: 'warning',
      });
    }
  }

  const assembled = assembleStructureToMarkdown(structure);
  const sourceContent = String(options?.sourceContent || rawContent || '');
  const truncatedLikely = looksLikeTruncatedOutput(sourceContent) || looksLikeTruncatedOutput(assembled);
  if (truncatedLikely) {
    issues.push({
      code: 'truncated_output',
      message: 'Output appears truncated or cut off.',
      severity: 'error',
    });
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

  const hasErrors = issues.some(issue => issue.severity === 'error');
  return {
    valid: !hasErrors,
    truncatedLikely,
    missingSections,
    featureCount,
    issues,
  };
}

export function compilePrdDocument(
  rawContent: string,
  options: CompilePrdOptions
): CompilePrdResult {
  const strictCanonical = options.strictCanonical !== false;
  const strictLanguageConsistency = options.strictLanguageConsistency !== false;
  const enableFeatureAggregation = options.enableFeatureAggregation !== false;
  const language = detectLanguage(options.language, rawContent);
  const candidate = sanitizeMetaLeaksInStructure(safeParseStructure(rawContent)).structure;
  const candidateUnknownSections = collectUnknownSectionHeadings(candidate);
  const improveBaseStructure = options.mode === 'improve' && hasText(options.existingContent)
    ? sanitizeMetaLeaksInStructure(safeParseStructure(String(options.existingContent || ''))).structure
    : null;
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
  });

  return {
    content,
    structure: withFeatureDepth.structure,
    quality,
  };
}
