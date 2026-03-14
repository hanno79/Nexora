import type { FeatureSpec, PRDStructure } from './prdStructure';
import { isCompilerFilledSection, normalizeForMatch } from './prdTextUtils';

type SupportedLanguage = 'de' | 'en';
type QualitySeverity = 'error' | 'warning';

export interface DeterministicSemanticIssue {
  code: string;
  message: string;
  severity: QualitySeverity;
  evidencePath?: string;
  evidenceSnippet?: string;
  relatedPaths?: string[];
}

interface CollectSemanticIssuesOptions {
  mode?: 'generate' | 'improve';
  language?: SupportedLanguage;
  fallbackSections?: string[];
  contextHint?: string;
  baselineStructure?: PRDStructure;
}

interface TextScope {
  path: string;
  sectionKey: string;
  value: string;
}

interface IdentifierOccurrence {
  raw: string;
  normalizedRawKey: string;
  parts: string[];
  singularKey: string;
  path: string;
  sectionKey: string;
  snippet: string;
}

interface DomainEntitySchema {
  entity: string;
  entityKey: string;
  fields: Map<string, string>;
}

interface EntityFieldReference {
  entity: string;
  entityKey: string;
  field: string;
  fieldKey: string;
  path: string;
  sectionKey: string;
  snippet: string;
}

type ConstraintKind = 'max' | 'min' | 'exact';
type ConstraintUnitGroup = 'duration_ms' | 'percent' | 'count' | 'throughput' | 'unknown';

interface NumericConstraint {
  subject: string;
  kind: ConstraintKind;
  value: number;
  unitGroup: ConstraintUnitGroup;
  path: string;
  sectionKey: string;
  snippet: string;
}

interface ScopeExclusion {
  label: string;
  tokens: string[];
  snippet: string;
}

type FeaturePriorityClass =
  | 'core_capability'
  | 'supporting_capability'
  | 'implementation_enabler'
  | 'unknown';

export interface VisionFirstCoverageDiagnostics {
  primaryCapabilityAnchors: string[];
  featurePriorityWindow: string[];
  coreFeatureIds: string[];
  supportFeatureIds: string[];
}

export interface TimelineConsistencyDiagnostics {
  canonicalFeatureIds: string[];
  timelineMismatchedFeatureIds: string[];
}

const SECTION_KEYS: Array<keyof PRDStructure> = [
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

const FEATURE_STRING_FIELDS: Array<keyof FeatureSpec> = [
  'purpose',
  'actors',
  'trigger',
  'preconditions',
  'postconditions',
  'dataImpact',
  'uiImpact',
];

const FEATURE_ARRAY_FIELDS: Array<keyof FeatureSpec> = [
  'mainFlow',
  'alternateFlows',
  'acceptanceCriteria',
];

const IDENTIFIER_STOP_WORDS = new Set([
  'api',
  'app',
  'data',
  'db',
  'id',
  'ids',
  'key',
  'keys',
  'list',
  'map',
  'record',
  'records',
  'service',
  'settings',
  'table',
  'tables',
  'token',
  'tokens',
  'user',
  'users',
  'value',
  'values',
]);

const NEGATION_MARKERS = [
  'no',
  'not included',
  'out of scope',
  'excluded',
  'deferred',
  'without',
  'kein',
  'keine',
  'keinen',
  'keinem',
  'keiner',
  'nicht teil',
  'ausgeschlossen',
  'verschoben',
  'ohne',
];

const SCOPE_STOP_WORDS = new Set([
  'and',
  'are',
  'be',
  'current',
  'deferred',
  'diesem',
  'dieser',
  'dieses',
  'explicitly',
  'for',
  'future',
  'included',
  'in',
  'is',
  'not',
  'of',
  'out',
  'release',
  'scope',
  'modus',
  'mode',
  'the',
  'this',
  'version',
  'werden',
  'wird',
]);

const HIGH_SIGNAL_SCOPE_TOKENS = new Set([
  'multiplayer',
  'singleplayer',
  'coop',
  'mobile',
  'vr',
]);

const CONSTRAINT_SUBJECT_PATTERNS: Array<{ subject: string; regex: RegExp }> = [
  { subject: 'timeout', regex: /\b(?:timeout|time[- ]out)\b/i },
  { subject: 'response_time', regex: /\b(?:response time|response times|latency|antwortzeit(?:en)?|latenz)\b/i },
  { subject: 'render_time', regex: /\b(?:render(?:ing)? time|renderzeit|initialrenderzeit)\b/i },
  { subject: 'switches_per_request', regex: /\b(?:switch(?:es)?(?:\s+per\s+request)?|wechsel(?:n)?(?:\s+pro\s+anfrage)?)\b/i },
  { subject: 'retry_attempts', regex: /\b(?:retry(?: attempts?)?|retries|attempts?|versuch(?:e|en)?)\b/i },
  { subject: 'availability', regex: /\b(?:availability|uptime|verfuegbarkeit)\b/i },
];

// ÄNDERUNG 10.03.2026: Mehrdeutige Verben wie `retry` oder `use` duerfen in
// Business-Rule-Fliesstexten nicht als nackte Schema-Properties zaehlen.
// Echte Feldreferenzen bleiben ueber codeartige Identifier weiterhin erkennbar.
const RULE_SCHEMA_PROPERTY_HINTS = new Set([
  'charge',
  'charges',
  'combo',
  'cooldown',
  'count',
  'counter',
  'duration',
  'experience',
  'inventory',
  'level',
  'levels',
  'life',
  'lives',
  'multiplier',
  'quota',
  'remaining',
  'score',
  'scores',
  'state',
  'status',
  'streak',
  'timer',
  'xp',
]);

const SUPPORT_ENABLER_LEXICON = new Set([
  'admin',
  'admins',
  'analytics',
  'auth',
  'authentication',
  'authorization',
  'cache',
  'caches',
  'cicd',
  'ci',
  'cd',
  'compliance',
  'deployment',
  'deployments',
  'infrastructure',
  'login',
  'logins',
  'logout',
  'migration',
  'migrations',
  'monitoring',
  'observability',
  'oauth',
  'permissions',
  'profile',
  'profiles',
  'rbac',
  'role',
  'roles',
  'schema',
  'schemas',
  'settings',
  'signin',
  'signup',
  'table',
  'tables',
  'telemetry',
]);

const CAPABILITY_STOP_WORDS = new Set([
  'about',
  'across',
  'after',
  'alle',
  'allows',
  'application',
  'applications',
  'browser',
  'browsers',
  'build',
  'builder',
  'can',
  'classic',
  'clear',
  'damit',
  'deliver',
  'delivers',
  'eine',
  'einem',
  'einen',
  'einer',
  'eines',
  'enable',
  'enables',
  'experience',
  'experiences',
  'feature',
  'features',
  'helps',
  'important',
  'includes',
  'including',
  'kann',
  'klassisch',
  'klassische',
  'klassischen',
  'koennen',
  'können',
  'lite',
  'modern',
  'muss',
  'müssen',
  'platform',
  'platforms',
  'product',
  'products',
  'project',
  'projects',
  'provide',
  'provides',
  'release',
  'releases',
  'service',
  'services',
  'solution',
  'solutions',
  'support',
  'supports',
  'system',
  'systems',
  'tool',
  'tools',
  'user',
  'users',
  'value',
  'values',
  'version',
  'versions',
  'web',
  'werden',
  'wird',
  'will',
  'with',
  'workflow',
  'workflows',
]);

const TIMELINE_STOP_WORDS = new Set([
  'delivery',
  'deliver',
  'delivers',
  'iteration',
  'iterations',
  'launch',
  'milestone',
  'milestones',
  'phase',
  'phases',
  'release',
  'releases',
  'sprint',
  'sprints',
  'timeline',
  'timelines',
  'wave',
  'waves',
  'week',
  'weeks',
  'woche',
  'wochen',
  'zeitplan',
  'meilenstein',
  'meilensteine',
]);

const OUT_OF_SCOPE_FUTURE_LEAK_PATTERNS: RegExp[] = [
  /\b(?:future|later|eventually|roadmap|planned|post-launch|next release)\b/i,
  /\b(?:zukuenftig|zukünftig|spaeter|später|spätere|roadmap|spaeteren|späteren)\b/i,
];

const FEATURE_CORE_SEMANTIC_ANCHORS: Array<{ label: string; patterns: RegExp[] }> = [
  { label: 'roguelite/meta progression', patterns: [/\broguelite\b/i, /\broguelike\b/i, /\bmeta[- ]progress(?:ion)?\b/i] },
  { label: 'power-up', patterns: [/\bpower[- ]?ups?\b/i] },
  { label: 'cooldown', patterns: [/\bcooldown\b/i] },
  { label: 'XP', patterns: [/\bxp\b/i, /\bexperience\b/i] },
  { label: 'level progression', patterns: [/\blevel(?:ing| up)?\b/i, /\blevel-up\b/i] },
];

// ÄNDERUNG 10.03.2026: Breite, global geteilte Auth-/Systembegriffe sollen
// `feature_core_semantic_gap` nicht als vermeintlich fehlende Kernsemantik
// triggern, wenn sie nur aus Vision-/Systemkontext in einzelne Features leaken.
const FEATURE_CORE_DYNAMIC_ANCHOR_STOP_WORDS = new Set([
  'configurable',
  'factor',
  'multi',
  'password',
  'reset',
  'secure',
  'sign',
  'token',
  'verification',
]);

const OUT_OF_SCOPE_CANONICAL_LEAK_PATTERNS: RegExp[] = [
  /\b(?:future|later|eventually|roadmap|planned|post-launch|next release)\b/gi,
  /\b(?:zukuenftig|zukünftig|spaeter|später|spätere|roadmap|spaeteren|späteren)\b/gi,
];

const COMPARATOR_MAX = /(?:<=|=<|\bat most\b|\bmax(?:imum)?\b|\bmaximal\b|\bhoechstens\b|\bunder\b|\bbelow\b|\bwithin\b)/i;
const COMPARATOR_MIN = /(?:>=|=>|\bat least\b|\bmin(?:imum)?\b|\bmindestens\b|\babove\b|\bover\b)/i;
const COMPARATOR_EXACT = /(?:=|\bexactly\b|\bequals?\b|\bset to\b|\bmust be\b|\bis\b|\bist\b|\bbetraegt\b)/i;
const NUMERIC_VALUE = /(\d+(?:[.,]\d+)?)\s*(ms|milliseconds?|s|sec|seconds?|m|min|minutes?|h|hours?|d|days?|%|percent|rps|requests?\s*\/\s*s)?/i;

function normalizeWhitespace(value: string | null | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(value => normalizeWhitespace(value)).filter(Boolean)));
}

function titleCaseFragment(value: string): string {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return '';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function splitIdentifierParts(identifier: string): string[] {
  return String(identifier || '')
    .replace(/[`"'()[\]{}]/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._/-]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function tokenizeCapabilityText(value: string): string[] {
  return normalizeForMatch(value)
    .split(/\s+/)
    .map(token => normalizeCapabilityToken(token))
    .filter(token =>
      token.length >= 4
      && !CAPABILITY_STOP_WORDS.has(token)
      && !SUPPORT_ENABLER_LEXICON.has(token)
      && !IDENTIFIER_STOP_WORDS.has(token)
    );
}

function extractAnchorSourceTexts(
  structure: PRDStructure,
  options: CollectSemanticIssuesOptions
): string[] {
  const sources: string[] = [];
  if (options.contextHint) sources.push(options.contextHint);
  if (structure.systemVision) sources.push(String(structure.systemVision));
  if (structure.successCriteria) sources.push(String(structure.successCriteria));
  if (options.baselineStructure?.systemVision) {
    sources.push(String(options.baselineStructure.systemVision));
  }
  for (const feature of options.baselineStructure?.features || []) {
    if (feature.name) sources.push(String(feature.name));
    if (feature.purpose) sources.push(String(feature.purpose));
  }
  return sources.filter(Boolean);
}

function buildPrimaryCapabilityAnchors(
  structure: PRDStructure,
  options: CollectSemanticIssuesOptions
): string[] {
  const sourceTexts = extractAnchorSourceTexts(structure, options);
  const weightedTokens = new Map<string, number>();

  for (const [index, sourceText] of sourceTexts.entries()) {
    const sourceWeight = index <= 1 ? 3 : 1;
    const uniqueSourceTokens = new Set(tokenizeCapabilityText(sourceText));
    for (const token of uniqueSourceTokens) {
      weightedTokens.set(token, (weightedTokens.get(token) || 0) + sourceWeight);
    }
  }

  return Array.from(weightedTokens.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([token]) => token);
}

function hasSupportEnablerSignal(value: string): boolean {
  const tokens = normalizeForMatch(value)
    .split(/\s+/)
    .map(token => normalizeCapabilityToken(token))
    .filter(Boolean);
  return tokens.some(token => SUPPORT_ENABLER_LEXICON.has(token));
}

function countAnchorHits(value: string, anchors: string[]): number {
  const tokens = new Set(tokenizeCapabilityText(value));
  return anchors.filter(anchor => tokens.has(anchor)).length;
}

function classifyFeaturePriority(
  feature: FeatureSpec,
  anchors: string[],
): FeaturePriorityClass {
  const coreSignalText = [
    feature.purpose,
    feature.trigger,
    ...(Array.isArray(feature.mainFlow) ? feature.mainFlow.slice(0, 2) : []),
  ].filter(Boolean).join('\n');
  const secondarySignalText = [
    feature.name,
    feature.purpose,
    feature.trigger,
    feature.uiImpact,
    feature.rawContent,
  ].filter(Boolean).join('\n');
  const coreAnchorHits = countAnchorHits(coreSignalText, anchors);
  const secondaryAnchorHits = countAnchorHits(secondarySignalText, anchors);
  const supportSignal = hasSupportEnablerSignal(secondarySignalText);

  // ÄNDERUNG 10.03.2026: Auth-/Login-lastige Kernfaehigkeiten duerfen trotz
  // Support-Signal als Core zaehlen, wenn sie mehrere Vision-Anker direkt tragen.
  if (coreAnchorHits >= 2 || (coreAnchorHits >= 1 && secondaryAnchorHits >= 2)) {
    return 'core_capability';
  }
  if (coreAnchorHits >= 1 && !supportSignal) return 'core_capability';
  if (coreAnchorHits >= 1 && supportSignal) return 'supporting_capability';
  if (secondaryAnchorHits >= 2 && !supportSignal) return 'core_capability';
  if (secondaryAnchorHits >= 1 && supportSignal) return 'supporting_capability';
  if (supportSignal) return 'implementation_enabler';
  return 'unknown';
}

type CanonicalFeatureEntry = {
  id: string;
  name: string;
  summary: string;
  tokens: Set<string>;
};

type TimelineReferenceMismatchAnalysis = {
  issues: DeterministicSemanticIssue[];
  diagnostics: TimelineConsistencyDiagnostics;
};

function summarizeFeatureCapability(feature: FeatureSpec): string {
  const firstMainFlowStep = Array.isArray(feature.mainFlow) ? feature.mainFlow[0] : '';
  return [
    String(feature.name || '').trim(),
    String(feature.purpose || '').trim(),
    String(feature.trigger || '').trim(),
    String(firstMainFlowStep || '').trim(),
  ].filter(Boolean).join(' ');
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildWholeWordPattern(value: string): RegExp {
  return new RegExp(`\\b${escapeForRegex(String(value || ''))}\\b`, 'i');
}

function buildFeatureSemanticClaimText(feature: FeatureSpec): string {
  return [
    String(feature.name || '').trim(),
    String(feature.purpose || '').trim(),
  ].filter(Boolean).join('\n');
}

function tokenizeTimelineReference(value: string): string[] {
  return normalizeForMatch(value)
    .replace(/\bf-\d+\b/g, ' ')
    .split(/\s+/)
    .map(token => normalizeCapabilityToken(token))
    .filter(token =>
      token.length >= 4
      && !TIMELINE_STOP_WORDS.has(token)
      && !CAPABILITY_STOP_WORDS.has(token)
      && !IDENTIFIER_STOP_WORDS.has(token)
    );
}

function buildCanonicalFeatureEntries(structure: PRDStructure): CanonicalFeatureEntry[] {
  return (structure.features || [])
    .map(feature => {
      const id = String(feature.id || '').trim().toUpperCase();
      if (!id) return null;
      return {
        id,
        name: String(feature.name || '').trim() || id,
        summary: summarizeFeatureCapability(feature),
        tokens: new Set(tokenizeTimelineReference(summarizeFeatureCapability(feature))),
      };
    })
    .filter((entry): entry is CanonicalFeatureEntry => Boolean(entry));
}

function extractTimelineReferenceSegments(timelineMilestones: string): Array<{ line: string; featureIds: string[] }> {
  const source = String(timelineMilestones || '');
  const rawLines = source
    .split(/\r?\n/)
    .map(line => normalizeWhitespace(line))
    .filter(Boolean);

  const lines = rawLines.length > 1
    ? rawLines
    : source
      .split(/(?=\b(?:phase|milestone|sprint|week|woche)\b)/i)
      .map(line => normalizeWhitespace(line))
      .filter(Boolean);

  return lines.flatMap(line => {
    const featureMatches = Array.from(line.matchAll(/\bF-\d+\b/gi));
    const featureIds = Array.from(new Set(
      featureMatches
        .map(match => String(match[0] || '').trim().toUpperCase())
        .filter(Boolean)
    ));

    if (featureIds.length <= 1 || featureMatches.length <= 1) {
      return featureIds.length > 0 ? [{ line, featureIds }] : [];
    }

    // ÄNDERUNG 10.03.2026: Mehrfach-Referenzzeilen werden lokal pro F-XX-Segment
    // bewertet, damit Sammelzeilen nicht mit der Gesamtzeile gegen alle Features
    // cross-mappen und false-positive Mismatches ausloesen.
    const localSegments = featureMatches
      .map((match, index) => {
        const featureId = String(match[0] || '').trim().toUpperCase();
        if (!featureId) return null;

        const start = index === 0 ? 0 : (match.index ?? 0);
        const end = index < featureMatches.length - 1
          ? (featureMatches[index + 1].index ?? line.length)
          : line.length;
        const segmentLine = normalizeWhitespace(
          line
            .slice(start, end)
            .replace(/^[,;:–—\-\s]+/, '')
            .replace(/[,;:–—\-\s]+$/, '')
        );

        if (!segmentLine) return null;
        return { line: segmentLine, featureIds: [featureId] };
      })
      .filter((entry): entry is { line: string; featureIds: string[] } => Boolean(entry));

    return localSegments.length > 0 ? localSegments : [{ line, featureIds }];
  });
}

function matchTimelineReferenceToFeature(
  line: string,
  referenceId: string,
  canonicalFeatures: CanonicalFeatureEntry[]
): { referencedScore: number; bestScore: number; bestMatch?: CanonicalFeatureEntry } {
  const lineTokens = new Set(tokenizeTimelineReference(line));
  const referencedFeature = canonicalFeatures.find(feature => feature.id === referenceId);
  const referencedScore = referencedFeature
    ? Array.from(referencedFeature.tokens).filter(token => lineTokens.has(token)).length
    : 0;

  let bestMatch: CanonicalFeatureEntry | undefined;
  let bestScore = 0;
  for (const feature of canonicalFeatures) {
    const score = Array.from(feature.tokens).filter(token => lineTokens.has(token)).length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = feature;
    }
  }

  return { referencedScore, bestScore, bestMatch };
}

function analyzeTimelineFeatureReferenceMismatch(structure: PRDStructure): TimelineReferenceMismatchAnalysis {
  const canonicalFeatures = buildCanonicalFeatureEntries(structure);
  const diagnostics: TimelineConsistencyDiagnostics = {
    canonicalFeatureIds: canonicalFeatures.map(feature => feature.id),
    timelineMismatchedFeatureIds: [],
  };

  if (!String(structure.timelineMilestones || '').trim() || canonicalFeatures.length === 0) {
    return { issues: [], diagnostics };
  }

  const issues: DeterministicSemanticIssue[] = [];
  const mismatchedFeatureIds = new Set<string>();
  const seenIssueKeys = new Set<string>();

  for (const segment of extractTimelineReferenceSegments(String(structure.timelineMilestones || ''))) {
    for (const referenceId of segment.featureIds) {
      const { referencedScore, bestScore, bestMatch } = matchTimelineReferenceToFeature(
        segment.line,
        referenceId,
        canonicalFeatures
      );
      if (!bestMatch) continue;
      if (bestMatch.id === referenceId) continue;
      // ÄNDERUNG 14.03.2026: Threshold verschaerft, um False Positives bei
      // feature-reichen PRDs mit geteiltem Vokabular (z.B. Gaming) zu vermeiden.
      // Vorher: bestScore >= 2 und bestScore > referencedScore genuegten.
      if (bestScore < 3) continue;
      if (bestScore <= referencedScore) continue;
      const marginRequired = Math.max(2, Math.ceil(referencedScore * 0.5));
      if (bestScore - referencedScore < marginRequired) continue;

      mismatchedFeatureIds.add(referenceId);
      const issueKey = `${referenceId}|${bestMatch.id}|${segment.line.toLowerCase()}`;
      if (seenIssueKeys.has(issueKey)) continue;
      seenIssueKeys.add(issueKey);

      issues.push({
        code: 'timeline_feature_reference_mismatch',
        message: `Timeline references ${referenceId} in a way that aligns more strongly with ${bestMatch.id}: ${bestMatch.name} than with the canonical feature ${referenceId}.`,
        severity: 'error',
        evidencePath: 'timelineMilestones',
        evidenceSnippet: segment.line.slice(0, 220),
        relatedPaths: [`feature:${referenceId}`, `feature:${bestMatch.id}`],
      });
    }
  }

  diagnostics.timelineMismatchedFeatureIds = Array.from(mismatchedFeatureIds).sort();
  return { issues, diagnostics };
}

function extractTimelineLinePrefix(line: string): string {
  const phaseMatch = line.match(/^(\s*(?:[-*•]\s+)?(?:Phase|Milestone|Sprint|Week|Woche)\s*[^:]*:\s*)/i);
  if (phaseMatch?.[1]) return phaseMatch[1];
  const bulletMatch = line.match(/^(\s*(?:[-*•]\s+))/);
  return bulletMatch?.[1] || '';
}

function extractTimelineReferenceScaffold(line: string): string {
  const phaseReferenceMatch = line.match(
    /^(\s*(?:[-*â€¢]\s+)?(?:Phase|Milestone|Sprint|Week|Woche)\s*[A-Za-z0-9-]*(?:\s+(?:delivers?|covers?|includes?|ships?|targets?|contains?))?\s*)\bF-\d+\b/i
  );
  if (phaseReferenceMatch?.[1]) return phaseReferenceMatch[1];

  const bulletReferenceMatch = line.match(/^(\s*(?:[-*â€¢]\s+)?)\bF-\d+\b/i);
  if (bulletReferenceMatch?.[1]) return bulletReferenceMatch[1];

  return extractTimelineLinePrefix(line);
}

export function rewriteTimelineMilestonesFromFeatureMap(
  structure: PRDStructure,
  _language: SupportedLanguage = 'en'
): { content: string; changed: boolean; mismatchedFeatureIds: string[]; appliedLines: number } {
  const analysis = analyzeTimelineFeatureReferenceMismatch(structure);
  const mismatchedIds = new Set(analysis.diagnostics.timelineMismatchedFeatureIds);
  const canonicalById = new Map(
    buildCanonicalFeatureEntries(structure).map(feature => [feature.id, feature] as const)
  );

  if (mismatchedIds.size === 0 || !String(structure.timelineMilestones || '').trim()) {
    return {
      content: String(structure.timelineMilestones || '').trim(),
      changed: false,
      mismatchedFeatureIds: Array.from(mismatchedIds),
      appliedLines: 0,
    };
  }

  let appliedLines = 0;
  const rewrittenLines = String(structure.timelineMilestones || '').split(/\r?\n/).map(rawLine => {
    const line = String(rawLine || '');
    const featureIds = Array.from(new Set(
      (line.match(/\bF-\d+\b/gi) || [])
        .map(value => String(value || '').trim().toUpperCase())
        .filter(Boolean)
    ));
    if (featureIds.length === 0 || !featureIds.some(id => mismatchedIds.has(id))) {
      return rawLine;
    }

    const rewrittenLine = rewriteTimelineReferenceLine(line, featureIds, canonicalById);
    if (normalizeForMatch(rewrittenLine) !== normalizeForMatch(line)) {
      appliedLines += 1;
    }
    return rewrittenLine;
  });

  const rewritten = rewrittenLines.join('\n').trim();
  return {
    content: rewritten,
    changed: normalizeForMatch(rewritten) !== normalizeForMatch(String(structure.timelineMilestones || '')),
    mismatchedFeatureIds: Array.from(mismatchedIds).sort(),
    appliedLines,
  };
}

function buildCanonicalTimelineReferenceList(
  featureIds: string[],
  canonicalById: Map<string, CanonicalFeatureEntry>
): string[] {
  return featureIds
    .map(id => canonicalById.get(id))
    .filter((entry): entry is CanonicalFeatureEntry => Boolean(entry))
    .map(entry => `${entry.id} ${entry.name}`);
}

function rewriteTimelineTableRow(
  line: string,
  featureIds: string[],
  canonicalById: Map<string, CanonicalFeatureEntry>
): string {
  const fxxPattern = /\bF-\d+\b/gi;
  let touched = false;
  const rewrittenCells = line.split('|').map(cell => {
    const matches = Array.from(new Set(
      (cell.match(fxxPattern) || [])
        .map(value => String(value || '').trim().toUpperCase())
        .filter(Boolean)
    ));
    if (matches.length === 0) return cell;

    const refs = buildCanonicalTimelineReferenceList(matches, canonicalById);
    if (refs.length === 0) return cell;

    touched = true;

    // ÄNDERUNG 10.03.2026: Tabellenzellen mit F-XX-Referenzen werden ab der
    // ersten Referenz vollständig aus der kanonischen Feature-Map neu aufgebaut,
    // damit veraltete Tabellenprosa sicher entfernt wird.
    const firstReferenceIndex = cell.search(/\bF-\d+\b/i);
    const leadingFragment = firstReferenceIndex >= 0 ? cell.slice(0, firstReferenceIndex) : '';
    const trailingWhitespace = cell.match(/\s*$/)?.[0] || '';
    return `${leadingFragment}${refs.join(', ')}${trailingWhitespace}`;
  });

  return touched ? rewrittenCells.join('|') : line;
}

function rewriteTimelineReferenceLine(
  line: string,
  featureIds: string[],
  canonicalById: Map<string, CanonicalFeatureEntry>
): string {
  const refs = buildCanonicalTimelineReferenceList(featureIds, canonicalById);
  if (refs.length === 0) return line;

  if (/^\s*\|/.test(line) && /\|/.test(line.trim().slice(1))) {
    return rewriteTimelineTableRow(line, featureIds, canonicalById);
  }

  const fxxPattern = /\bF-\d+\b/gi;
  const matches = line.match(fxxPattern);
  
  if (!matches || matches.length === 0) {
    const prefix = extractTimelineReferenceScaffold(line);
    return `${prefix || '- '}${refs.join(', ')}`.trimEnd();
  }

  // Build a map of F-XX to ref replacements
  const refMap = new Map<string, string>();
  for (const match of matches) {
    const refEntry = refs.find(r => r.startsWith(match));
    if (refEntry) {
      refMap.set(match, refEntry);
    }
  }

  // Replace each F-XX token in-place with its replacement
  let result = line;
  for (const [match, replacement] of refMap) {
    result = result.replace(new RegExp(`\\b${match}\\b`, 'i'), replacement);
  }

  return result.trimEnd();
}

function collectVisionFirstCoverageIssues(
  structure: PRDStructure,
  options: CollectSemanticIssuesOptions
): {
  issues: DeterministicSemanticIssue[];
  diagnostics: VisionFirstCoverageDiagnostics;
} {
  const issues: DeterministicSemanticIssue[] = [];
  const anchors = buildPrimaryCapabilityAnchors(structure, options);
  const features = structure.features || [];
  const featurePriorityWindowSize = Math.max(3, Math.min(5, Math.ceil(features.length * 0.35)));
  const featurePriorityWindow = features
    .slice(0, featurePriorityWindowSize)
    .map(feature => String(feature.id || '').trim())
    .filter(Boolean);

  if (anchors.length === 0 || features.length < 3) {
    return {
      issues,
      diagnostics: {
        primaryCapabilityAnchors: anchors,
        featurePriorityWindow,
        coreFeatureIds: [],
        supportFeatureIds: [],
      },
    };
  }

  const classified = features.map(feature => ({
    id: String(feature.id || '').trim(),
    classification: classifyFeaturePriority(feature, anchors),
  }));
  const coreFeatureIds = classified
    .filter(entry => entry.classification === 'core_capability')
    .map(entry => entry.id)
    .filter(Boolean);
  const supportFeatureIds = classified
    .filter(entry => entry.classification === 'supporting_capability' || entry.classification === 'implementation_enabler')
    .map(entry => entry.id)
    .filter(Boolean);
  const leading = classified.slice(0, featurePriorityWindowSize);
  const leadingCoreIds = leading
    .filter(entry => entry.classification === 'core_capability')
    .map(entry => entry.id)
    .filter(Boolean);
  const leadingSupportIds = leading
    .filter(entry => entry.classification === 'supporting_capability' || entry.classification === 'implementation_enabler')
    .map(entry => entry.id)
    .filter(Boolean);
  const requiredCoreCount = features.length >= 5 ? 2 : 1;

  if (leadingCoreIds.length < requiredCoreCount) {
    // ÄNDERUNG 09.03.2026: Wenn Core-Capability-Features global im Set existieren
    // (nur falsch platziert), ist dies ein Ordering-Problem (warning), kein
    // Coverage-Problem (error). Nur wenn Core-Features nirgends existieren → error.
    const globalCoreCount = coreFeatureIds.length;
    const isTrulyMissing = globalCoreCount < requiredCoreCount;
    issues.push({
      code: 'vision_capability_coverage_missing',
      message: isTrulyMissing
        ? 'Primary product capabilities from the vision are not represented clearly enough in the leading feature set.'
        : `Primary product capabilities from the vision (${coreFeatureIds.join(', ')}) exist but are not positioned in the leading feature set.`,
      severity: 'warning',
      evidencePath: featurePriorityWindow[0] ? `feature:${featurePriorityWindow[0]}` : 'systemVision',
      evidenceSnippet: uniqueStrings([
        structure.systemVision,
        ...featurePriorityWindow.slice(0, 3).map(featureId => {
          const feature = features.find(entry => entry.id === featureId);
          return feature ? `${feature.id}: ${feature.name}` : featureId;
        }),
      ]).join(' | ').slice(0, 220),
      relatedPaths: featurePriorityWindow.map(featureId => `feature:${featureId}`),
    });
  }

  if (leadingSupportIds.length > leadingCoreIds.length && leadingSupportIds.length > 0) {
    issues.push({
      code: 'support_features_overweight',
      message: 'Support or implementation-enabler features dominate the leading feature window ahead of primary user-value capabilities.',
      severity: 'warning',
      evidencePath: leadingSupportIds[0] ? `feature:${leadingSupportIds[0]}` : 'systemVision',
      evidenceSnippet: leadingSupportIds
        .map(featureId => {
          const feature = features.find(entry => entry.id === featureId);
          return feature ? `${feature.id}: ${feature.name}` : featureId;
        })
        .join(' | ')
        .slice(0, 220),
      relatedPaths: leadingSupportIds.map(featureId => `feature:${featureId}`),
    });
  }

  return {
    issues,
    diagnostics: {
      primaryCapabilityAnchors: anchors,
      featurePriorityWindow,
      coreFeatureIds,
      supportFeatureIds,
    },
  };
}

function singularizeIdentifierPart(part: string): string {
  const normalized = String(part || '').toLowerCase();
  if (normalized === 'ids') return 'id';
  if (normalized.endsWith('is')) return normalized;
  if (normalized.endsWith('ies') && normalized.length > 4) return `${normalized.slice(0, -3)}y`;
  if (normalized.endsWith('es') && normalized.length > 4 && /(?:ches|shes|sses|xes|zes)$/.test(normalized)) {
    return normalized.slice(0, -2);
  }
  if (normalized.endsWith('s') && normalized.length > 3 && !normalized.endsWith('ss')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function normalizeCapabilityToken(token: string): string {
  return singularizeIdentifierPart(String(token || '').toLowerCase().trim());
}

function buildIdentifierRawKey(parts: string[]): string {
  return parts.map(part => String(part || '').toLowerCase()).join('|');
}

function buildIdentifierSingularKey(parts: string[]): string {
  return parts.map(singularizeIdentifierPart).join('|');
}

function isCodeLikeIdentifier(token: string): boolean {
  const value = String(token || '').trim();
  if (!value || value.length < 4) return false;
  if (/[._]/.test(value)) return true;
  if (/^[a-z]+[A-Z][A-Za-z0-9]*$/.test(value)) return true;
  if (/^[A-Z][A-Za-z0-9]+\.[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return true;
  return false;
}

function extractCodeIdentifiers(text: string): string[] {
  const identifiers = new Set<string>();
  const source = String(text || '');
  const patterns = [
    /`([^`]{2,120})`/g,
    /\b[A-Z][A-Za-z0-9]+\.[A-Za-z_][A-Za-z0-9_]*\b/g,
    /\b[a-z]+[A-Z][A-Za-z0-9]*\b/g,
    /\b[a-z]+(?:_[a-z0-9]+)+\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = normalizeWhitespace(match[1] || match[0] || '');
      if (!isCodeLikeIdentifier(value)) continue;
      identifiers.add(value);
    }
  }

  return Array.from(identifiers);
}

function gatherTextScopes(structure: PRDStructure): TextScope[] {
  const scopes: TextScope[] = [];

  for (const key of SECTION_KEYS) {
    const value = String((structure as any)[key] || '').trim();
    if (!value) continue;
    scopes.push({
      path: String(key),
      sectionKey: String(key),
      value,
    });
  }

  for (const feature of structure.features || []) {
    const featureId = String(feature.id || '').trim() || 'feature';
    const featurePath = `feature:${featureId}`;

    if (String(feature.name || '').trim()) {
      scopes.push({
        path: `${featurePath}.name`,
        sectionKey: featurePath,
        value: String(feature.name || '').trim(),
      });
    }

    if (String(feature.rawContent || '').trim()) {
      scopes.push({
        path: `${featurePath}.rawContent`,
        sectionKey: featurePath,
        value: String(feature.rawContent || '').trim(),
      });
    }

    for (const field of FEATURE_STRING_FIELDS) {
      const value = String((feature as any)[field] || '').trim();
      if (!value) continue;
      scopes.push({
        path: `${featurePath}.${String(field)}`,
        sectionKey: featurePath,
        value,
      });
    }

    for (const field of FEATURE_ARRAY_FIELDS) {
      const values = Array.isArray((feature as any)[field]) ? (feature as any)[field] : [];
      for (const [index, entry] of values.entries()) {
        const value = String(entry || '').trim();
        if (!value) continue;
        scopes.push({
          path: `${featurePath}.${String(field)}[${index}]`,
          sectionKey: featurePath,
          value,
        });
      }
    }
  }

  return scopes;
}

function extractIdentifierOccurrences(scopes: TextScope[]): IdentifierOccurrence[] {
  const occurrences: IdentifierOccurrence[] = [];

  for (const scope of scopes) {
    for (const identifier of extractCodeIdentifiers(scope.value)) {
      if (scope.path !== 'domainModel' && isLikelyStorageArtifactIdentifier(scope.value, identifier)) {
        continue;
      }
      const parts = splitIdentifierParts(identifier);
      if (parts.length < 2) continue;
      occurrences.push({
        raw: identifier,
        normalizedRawKey: buildIdentifierRawKey(parts),
        parts,
        singularKey: buildIdentifierSingularKey(parts),
        path: scope.path,
        sectionKey: scope.sectionKey,
        snippet: normalizeWhitespace(scope.value).slice(0, 220),
      });
    }
  }

  return occurrences;
}

function isLikelyStorageArtifactIdentifier(scopeValue: string, identifier: string): boolean {
  const normalizedIdentifier = String(identifier || '').trim();
  if (!normalizedIdentifier) return false;
  if (!/^[a-z]+(?:_[a-z0-9]+)+$/.test(normalizedIdentifier)) return false;

  const source = String(scopeValue || '');
  const lines = source.split(/\r?\n/);
  const matchingLine = lines.find(line => line.includes(normalizedIdentifier)) || source;
  return /\b(?:table|tables|tabelle|tabellen|sql|select|from|join|into|insert|update|delete|query|abfrage|read-only|readonly|lookup|cache|database|datenbank)\b/i.test(matchingLine);
}

function parseDomainEntitySchemas(domainModel: string): DomainEntitySchema[] {
  const schemas: DomainEntitySchema[] = [];
  const source = String(domainModel || '').replace(/\*\*/g, '');
  const pattern = /\b([A-Z][A-Za-z0-9]+)\s*\(([^)\n]{3,240})\)/g;

  for (const match of source.matchAll(pattern)) {
    const entity = String(match[1] || '').trim();
    const fields = new Map<string, string>();
    const rawFieldList = String(match[2] || '');

    for (const fieldCandidate of rawFieldList.split(/[;,]/)) {
      const identifiers = extractCodeIdentifiers(fieldCandidate);
      if (identifiers.length === 0) {
        const fallback = normalizeWhitespace(fieldCandidate)
          .replace(/^[^A-Za-z]+/, '')
          .replace(/[^A-Za-z0-9_].*$/, '');
        if (isCodeLikeIdentifier(fallback)) {
          identifiers.push(fallback);
        }
      }

      for (const identifier of identifiers) {
        const parts = splitIdentifierParts(identifier);
        if (parts.length === 0) continue;
        fields.set(buildIdentifierSingularKey(parts), identifier);
      }
    }

    if (fields.size === 0) continue;
    schemas.push({
      entity,
      entityKey: normalizeForMatch(entity),
      fields,
    });
  }

  return schemas;
}

function collectEntityFieldReferences(scopes: TextScope[]): EntityFieldReference[] {
  const references: EntityFieldReference[] = [];
  const pattern = /\b([A-Z][A-Za-z0-9]+)\.([A-Za-z_][A-Za-z0-9_]*)\b/g;

  for (const scope of scopes) {
    for (const match of scope.value.matchAll(pattern)) {
      const entity = String(match[1] || '').trim();
      const field = String(match[2] || '').trim();
      if (!entity || !field) continue;

      references.push({
        entity,
        entityKey: normalizeForMatch(entity),
        field,
        fieldKey: buildIdentifierSingularKey(splitIdentifierParts(field)),
        path: scope.path,
        sectionKey: scope.sectionKey,
        snippet: normalizeWhitespace(scope.value).slice(0, 220),
      });
    }
  }

  return references;
}

function findClosestSchemaField(schema: DomainEntitySchema, fieldKey: string): string | undefined {
  if (schema.fields.has(fieldKey)) return schema.fields.get(fieldKey);

  const candidates = Array.from(schema.fields.entries());
  for (const [candidateKey, candidateField] of candidates) {
    const candidateParts = candidateKey.split('|');
    const fieldParts = fieldKey.split('|');
    if (candidateParts.length !== fieldParts.length) continue;
    const allEquivalent = candidateParts.every((part, index) => part === fieldParts[index]);
    if (allEquivalent) return candidateField;
  }

  return undefined;
}

function collectDomainPropertyTokens(domainModel: string): Set<string> {
  const tokens = new Set<string>();
  const normalizedTokens = normalizeForMatch(domainModel)
    .split(/\s+/)
    .filter(token => token.length >= 2);
  for (const token of normalizedTokens) {
    tokens.add(token);
  }

  for (const schema of parseDomainEntitySchemas(domainModel)) {
    tokens.add(schema.entityKey);
    for (const entry of schema.fields.values()) {
      const parts = splitIdentifierParts(entry);
      for (const part of parts) {
        if (part.length >= 2) tokens.add(singularizeIdentifierPart(part));
      }
    }
  }

  for (const identifier of extractCodeIdentifiers(domainModel)) {
    const parts = splitIdentifierParts(identifier);
    for (const part of parts) {
      if (part.length >= 2) tokens.add(singularizeIdentifierPart(part));
    }
  }

  return tokens;
}

function extractRuleSchemaPropertyCoverageIssues(structure: PRDStructure): DeterministicSemanticIssue[] {
  const issues: DeterministicSemanticIssue[] = [];
  const domainTokens = collectDomainPropertyTokens(String(structure.domainModel || ''));
  const lines = String(structure.globalBusinessRules || '')
    .split(/\r?\n/)
    .flatMap(line => line.split(/[.!?]/))
    .map(line => normalizeWhitespace(line.replace(/^[-*]\s*/, '')))
    .filter(line => line.length >= 8);
  const issueKeys = new Set<string>();

  for (const line of lines) {
    const constraintLike = COMPARATOR_MAX.test(line)
      || COMPARATOR_MIN.test(line)
      || COMPARATOR_EXACT.test(line)
      || /\b(?:must|only|allow(?:ed)?|requires?|when|if|muss|nur|darf|erlaubt|wenn|setzt|bedarf)\b/i.test(line);
    if (!constraintLike) continue;

    const candidateTokens = new Set<string>();
    for (const identifier of extractCodeIdentifiers(line)) {
      for (const part of splitIdentifierParts(identifier)) {
        const normalized = singularizeIdentifierPart(part);
        if (normalized.length >= 2) candidateTokens.add(normalized);
      }
    }

    const plainTokens = normalizeForMatch(line)
      .split(/\s+/)
      .map(token => singularizeIdentifierPart(token))
      .filter(token => token.length >= 2 && RULE_SCHEMA_PROPERTY_HINTS.has(token));
    for (const token of plainTokens) {
      candidateTokens.add(token);
    }

    for (const token of candidateTokens) {
      if (domainTokens.has(token)) continue;
      const issueKey = `${token}:${line.toLowerCase()}`;
      if (issueKeys.has(issueKey)) continue;
      issueKeys.add(issueKey);

      issues.push({
        code: 'rule_schema_property_coverage_missing',
        message: `Business rules reference property "${token}" but the Domain Model does not declare or describe it.`,
        severity: 'warning',
        evidencePath: 'globalBusinessRules',
        evidenceSnippet: line.slice(0, 220),
      });
    }
  }

  return issues;
}

function extractFeatureCoreSemanticGapIssues(
  structure: PRDStructure,
  options: CollectSemanticIssuesOptions,
  dynamicAnchors: string[]
): DeterministicSemanticIssue[] {
  const issues: DeterministicSemanticIssue[] = [];
  const features = structure.features || [];
  const systemContext = [
    String(options.contextHint || '').trim(),
    String(structure.systemVision || '').trim(),
    String(structure.globalBusinessRules || '').trim(),
    String(structure.domainModel || '').trim(),
  ].filter(Boolean).join('\n');
  const dynamicAnchorFeatureMentions = new Map(
    dynamicAnchors.map(anchor => {
      const anchorPattern = buildWholeWordPattern(anchor);
      const featureMentionCount = features.filter(feature => anchorPattern.test(buildFeatureSemanticClaimText(feature))).length;
      return [anchor, featureMentionCount] as const;
    })
  );

  for (const feature of features) {
    const featureId = String(feature.id || '').trim();
    if (!featureId) continue;

    const claimText = buildFeatureSemanticClaimText(feature);
    const featureNameText = String(feature.name || '').trim();
    const coreFieldText = [
      feature.trigger,
      feature.preconditions,
      ...(Array.isArray(feature.mainFlow) ? feature.mainFlow : []),
      feature.postconditions,
      feature.dataImpact,
      ...(Array.isArray(feature.acceptanceCriteria) ? feature.acceptanceCriteria : []),
    ].map(value => String(value || '').trim()).filter(Boolean).join('\n');

    if (!claimText || !coreFieldText) continue;

    const claimedDynamicAnchors = dynamicAnchors.filter(anchor => {
      if (FEATURE_CORE_DYNAMIC_ANCHOR_STOP_WORDS.has(anchor)) return false;
      const anchorPattern = buildWholeWordPattern(anchor);
      const featureMentionCount = dynamicAnchorFeatureMentions.get(anchor) || 0;
      const isFeatureSpecific = featureMentionCount <= 1 || anchorPattern.test(featureNameText);
      return anchorPattern.test(claimText) && anchorPattern.test(systemContext) && isFeatureSpecific;
    });

    const missingDynamicAnchors = claimedDynamicAnchors
      .filter(anchor => {
        const anchorPattern = buildWholeWordPattern(anchor);
        return !anchorPattern.test(coreFieldText);
      })
      .map(anchor => anchor);

    const missingStaticAnchors = FEATURE_CORE_SEMANTIC_ANCHORS
      .filter(anchor => anchor.patterns.some(pattern => pattern.test(systemContext) || pattern.test(claimText)))
      .filter(anchor => anchor.patterns.some(pattern => pattern.test(claimText)))
      .filter(anchor => !anchor.patterns.some(pattern => pattern.test(coreFieldText)))
      .map(anchor => anchor.label);

    const missingAnchors = uniqueStrings([
      ...missingDynamicAnchors,
      ...missingStaticAnchors,
    ]);

    if (missingAnchors.length === 0) continue;

    issues.push({
      code: 'feature_core_semantic_gap',
      message: `Feature "${featureId}: ${String(feature.name || '').trim()}" mentions ${missingAnchors.join(', ')} but Preconditions, Postconditions, or Data Impact do not encode it consistently.`,
      severity: 'warning',
      evidencePath: `feature:${featureId}.purpose`,
      evidenceSnippet: normalizeWhitespace(claimText).slice(0, 220),
    });
  }

  return issues;
}

function extractOutOfScopeFutureLeakageIssues(outOfScope: string): DeterministicSemanticIssue[] {
  const issues: DeterministicSemanticIssue[] = [];
  const lines = String(outOfScope || '')
    .split(/\r?\n/)
    .map(line => normalizeWhitespace(line.replace(/^[-*]\s*/, '')))
    .filter(Boolean);

  for (const line of lines) {
    if (!OUT_OF_SCOPE_FUTURE_LEAK_PATTERNS.some(pattern => pattern.test(line))) continue;
    issues.push({
      code: 'out_of_scope_future_leakage',
      message: 'Out-of-Scope text contains future-looking or optional roadmap language instead of strict exclusions.',
      severity: 'error',
      evidencePath: 'outOfScope',
      evidenceSnippet: line.slice(0, 220),
    });
  }

  return issues;
}

export function normalizeOutOfScopeStrictExclusions(
  outOfScope: string,
  language: SupportedLanguage = 'en'
): { content: string; changed: boolean } {
  const lines = String(outOfScope || '')
    .split(/\r?\n/)
    .map(line => normalizeWhitespace(line))
    .filter(Boolean);
  const normalizedLines: string[] = [];

  for (const rawLine of lines) {
    const withoutBullet = rawLine.replace(/^[-*•]\s*/, '').trim();
    if (!withoutBullet) continue;

    let subject = withoutBullet
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\b(?:but|however|jedoch|aber)\b[\s\S]*$/i, ' ')
      .replace(/\b(?:in this release|for this release|for this version|in dieser version|in diesem release)\b/gi, ' ')
      .replace(/\b(?:is|are|remains?|werden|ist|sind)\s+(?:explicitly\s+)?(?:out of scope|excluded|deferred|not included|ausgeschlossen|verschoben)\b[\s\S]*$/i, ' ')
      .trim();

    subject = subject.replace(
      /\b(?:planned|roadmap|future|later|eventually|zukuenftig|zukünftig|spaeter|später)\b[\s\S]*$/i,
      ' '
    );

    for (const pattern of OUT_OF_SCOPE_CANONICAL_LEAK_PATTERNS) {
      subject = subject.replace(pattern, ' ');
    }

    const leadingNegative = subject.match(/^(?:no|without|kein(?:e|er|es|em|en)?|ohne)\s+(.+)$/i);
    if (leadingNegative?.[1]) {
      subject = leadingNegative[1];
    }

    subject = normalizeWhitespace(subject)
      .replace(/[,:;.-]+$/g, '')
      .trim();

    if (!subject) continue;

    const canonical = language === 'de'
      ? `- ${titleCaseFragment(subject)} ist in diesem Release ausgeschlossen.`
      : `- ${titleCaseFragment(subject)} is excluded from this release.`;
    normalizedLines.push(canonical);
  }

  const normalizedContent = normalizedLines.join('\n').trim();
  const changed = normalizeForMatch(normalizedContent) !== normalizeForMatch(outOfScope);
  return {
    content: normalizedContent || String(outOfScope || '').trim(),
    changed,
  };
}

function normalizeConstraintValue(rawValue: string, rawUnit?: string): { value: number; unitGroup: ConstraintUnitGroup } {
  const numeric = Number(String(rawValue || '').replace(',', '.'));
  const unit = String(rawUnit || '').trim().toLowerCase();
  if (!Number.isFinite(numeric)) {
    return { value: Number.NaN, unitGroup: 'unknown' };
  }

  if (!unit) return { value: numeric, unitGroup: 'count' };
  if (unit === '%' || unit === 'percent') return { value: numeric, unitGroup: 'percent' };
  if (unit === 'rps' || /request/.test(unit)) return { value: numeric, unitGroup: 'throughput' };
  if (unit === 'ms' || unit.startsWith('millisecond')) return { value: numeric, unitGroup: 'duration_ms' };
  if (unit === 's' || unit === 'sec' || unit.startsWith('second')) return { value: numeric * 1000, unitGroup: 'duration_ms' };
  if (unit === 'm' || unit === 'min' || unit.startsWith('minute')) return { value: numeric * 60000, unitGroup: 'duration_ms' };
  if (unit === 'h' || unit.startsWith('hour')) return { value: numeric * 3600000, unitGroup: 'duration_ms' };
  if (unit === 'd' || unit.startsWith('day')) return { value: numeric * 86400000, unitGroup: 'duration_ms' };
  return { value: numeric, unitGroup: 'count' };
}

function detectConstraintKind(line: string): ConstraintKind | null {
  const value = String(line || '');
  if (COMPARATOR_MAX.test(value)) return 'max';
  if (COMPARATOR_MIN.test(value)) return 'min';
  if (COMPARATOR_EXACT.test(value)) return 'exact';
  return null;
}

function extractConstraints(scopes: TextScope[]): NumericConstraint[] {
  const constraints: NumericConstraint[] = [];

  for (const scope of scopes) {
    const candidates = scope.value
      .split(/\r?\n/)
      .flatMap(line => line.split(/[.!?]/))
      .map(line => normalizeWhitespace(line))
      .filter(line => line.length >= 8);

    for (const line of candidates) {
      const kind = detectConstraintKind(line);
      if (!kind) continue;

      const valueMatch = line.match(NUMERIC_VALUE);
      if (!valueMatch?.[1]) continue;

      const normalizedValue = normalizeConstraintValue(valueMatch[1], valueMatch[2]);
      if (!Number.isFinite(normalizedValue.value)) continue;

      for (const subjectPattern of CONSTRAINT_SUBJECT_PATTERNS) {
        if (!subjectPattern.regex.test(line)) continue;
        constraints.push({
          subject: subjectPattern.subject,
          kind,
          value: normalizedValue.value,
          unitGroup: normalizedValue.unitGroup,
          path: scope.path,
          sectionKey: scope.sectionKey,
          snippet: line.slice(0, 220),
        });
      }
    }
  }

  return constraints;
}

function lowerBound(constraint: NumericConstraint): number | null {
  if (constraint.kind === 'min' || constraint.kind === 'exact') return constraint.value;
  return null;
}

function upperBound(constraint: NumericConstraint): number | null {
  if (constraint.kind === 'max' || constraint.kind === 'exact') return constraint.value;
  return null;
}

function constraintsConflict(base: NumericConstraint, other: NumericConstraint): boolean {
  if (base.subject !== other.subject) return false;
  if (base.unitGroup !== other.unitGroup) return false;

  const baseLower = lowerBound(base);
  const baseUpper = upperBound(base);
  const otherLower = lowerBound(other);
  const otherUpper = upperBound(other);

  if (baseLower !== null && otherUpper !== null && otherUpper < baseLower) return true;
  if (baseUpper !== null && otherLower !== null && otherLower > baseUpper) return true;
  if (base.kind === 'exact' && other.kind === 'exact' && Math.abs(base.value - other.value) > 0.0001) return true;
  return false;
}

function tokenizeScopeValue(value: string): string[] {
  const expanded = new Set<string>();
  const tokens = normalizeForMatch(value)
    .split(/\s+/)
    .filter(token => token.length >= 3)
    .filter(token => !SCOPE_STOP_WORDS.has(token));

  for (const token of tokens) {
    const normalized = singularizeIdentifierPart(token);
    if (!SCOPE_STOP_WORDS.has(normalized)) {
      expanded.add(normalized);
    }
    if ([
      'mehrspieler',
      'multiplayer',
      'multiplayermodus',
      'mehrspielermodus',
    ].includes(normalized)) {
      expanded.add('multiplayer');
    }
    if ([
      'einzelspieler',
      'singleplayer',
      'singleplayermodus',
      'einzelspielermodus',
    ].includes(normalized)) {
      expanded.add('singleplayer');
    }
    if (['kooperativ', 'cooperative', 'coop'].includes(normalized)) {
      expanded.add('coop');
    }
  }

  return Array.from(expanded);
}

function parseScopeExclusions(outOfScope: string): ScopeExclusion[] {
  const exclusions: ScopeExclusion[] = [];
  const lines = String(outOfScope || '')
    .split(/\r?\n/)
    .map(line => normalizeWhitespace(line.replace(/^[-*]\s*/, '')))
    .filter(Boolean);

  for (const line of lines) {
    const normalized = line.toLowerCase();
    let rawItems: string[] = [];

    const leadingNegative = line.match(/^(?:no|without|kein(?:e|er|es|em|en)?|ohne)\s+(.+?)$/i);
    if (leadingNegative?.[1]) {
      rawItems = [leadingNegative[1]];
    } else {
      const trailingNegative = line.match(/^(.+?)\s+(?:are|is|remain|remains|werden|ist|sind)\s+(?:explicitly\s+)?(?:out of scope|excluded|deferred|not included|ausgeschlossen|verschoben)\b/i);
      if (trailingNegative?.[1]) {
        rawItems = trailingNegative[1].split(/\s*,\s*|\s+(?:and|und)\s+/i);
      } else {
        const dashedNotPartMatch = line.match(/^(.+?)\s+[—–-]\s*(?:not\s+part|nicht\s+teil)\b/i);
        if (dashedNotPartMatch?.[1]) {
          rawItems = dashedNotPartMatch[1].split(/\s*,\s*|\s+(?:and|und)\s+/i);
        } else {
          const notPartMatch = line.match(/^(.+?)\s+(?:are|is|werden|ist|sind)\s+(?:not\s+part|nicht\s+teil)\b/i);
          if (notPartMatch?.[1]) {
            rawItems = notPartMatch[1].split(/\s*,\s*|\s+(?:and|und)\s+/i);
          } else if (NEGATION_MARKERS.some(marker => normalized.includes(marker))) {
            rawItems = [line];
          }
        }
      }
    }

    for (const rawItem of rawItems) {
      const label = normalizeWhitespace(rawItem)
        .replace(/\b(?:for|from|in|this|diesem|dieser|dieses|release|version|v\d+)\b.*$/i, '')
        .trim();
      const tokens = tokenizeScopeValue(label)
        .filter(token => !NEGATION_MARKERS.includes(token))
        .filter(token => !SCOPE_STOP_WORDS.has(token));
      const hasHighSignalToken = tokens.some(token => HIGH_SIGNAL_SCOPE_TOKENS.has(token));
      if (tokens.length < 2 && !hasHighSignalToken) continue;
      exclusions.push({
        label,
        tokens: Array.from(new Set(tokens)),
        snippet: line.slice(0, 220),
      });
    }
  }

  return exclusions;
}

function targetScopesForScopeChecks(structure: PRDStructure): TextScope[] {
  const targets: TextScope[] = [];
  const featureScopes = (structure.features || []).flatMap(feature => {
    const featureId = String(feature.id || '').trim() || 'feature';
    const base = `feature:${featureId}`;
    const scopes: TextScope[] = [];

    if (String(feature.name || '').trim()) {
      scopes.push({ path: `${base}.name`, sectionKey: base, value: String(feature.name || '').trim() });
    }
    if (String(feature.purpose || '').trim()) {
      scopes.push({ path: `${base}.purpose`, sectionKey: base, value: String(feature.purpose || '').trim() });
    }

    return scopes;
  });

  targets.push(...featureScopes);

  for (const key of ['systemVision', 'systemBoundaries', 'deployment', 'timelineMilestones', 'successCriteria', 'definitionOfDone'] as const) {
    const value = String((structure as any)[key] || '').trim();
    if (!value) continue;
    targets.push({
      path: String(key),
      sectionKey: String(key),
      value,
    });
  }

  return targets;
}

function tokenOverlapRatio(tokens: string[], otherTokens: string[]): number {
  const left = new Set(tokens);
  const right = new Set(otherTokens);
  if (left.size === 0 || right.size === 0) return 0;

  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap++;
  }

  return overlap / Math.min(left.size, right.size);
}

function extractDeploymentRuntimeContradictionIssues(structure: PRDStructure): DeterministicSemanticIssue[] {
  const issues: DeterministicSemanticIssue[] = [];
  const boundaries = normalizeForMatch(String(structure.systemBoundaries || ''));
  const deployment = normalizeForMatch(String(structure.deployment || ''));
  if (!boundaries || !deployment) return issues;

  const containerLike = /\b(?:ecs|fargate|container|containers|kubernetes|docker|pods?)\b/i;
  const serverlessLike = /\b(?:lambda|api gateway|serverless|cloud function|functions as a service|faas)\b/i;

  const boundariesContainer = containerLike.test(boundaries);
  const boundariesServerless = serverlessLike.test(boundaries);
  const deploymentContainer = containerLike.test(deployment);
  const deploymentServerless = serverlessLike.test(deployment);

  const contradictsContainerBaseline =
    boundariesContainer && deploymentServerless && !deploymentContainer;
  const contradictsServerlessBaseline =
    boundariesServerless && deploymentContainer && !deploymentServerless;

  if (!contradictsContainerBaseline && !contradictsServerlessBaseline) {
    return issues;
  }

  issues.push({
    code: 'deployment_runtime_contradiction',
    message: 'System Boundaries and Deployment & Infrastructure describe contradictory runtime/deployment models.',
    severity: 'error',
    evidencePath: 'deployment',
    evidenceSnippet: normalizeWhitespace(String(structure.deployment || '')).slice(0, 220),
  });

  return issues;
}

function isCompilerFilledScope(sectionKey: string, knownFallbackSections: Set<string>): boolean {
  if (sectionKey.startsWith('feature:')) return false;
  return isCompilerFilledSection(sectionKey, knownFallbackSections);
}

const DEGENERATE_SECTION_KEYS: { key: keyof PRDStructure; label: string }[] = [
  { key: 'outOfScope', label: 'Out of Scope' },
  { key: 'nonFunctional', label: 'Non-Functional Requirements' },
  { key: 'deployment', label: 'Deployment' },
  { key: 'definitionOfDone', label: 'Definition of Done' },
  { key: 'successCriteria', label: 'Success Criteria' },
  { key: 'timelineMilestones', label: 'Timeline & Milestones' },
];

const DEGENERATE_SECTION_SELF_REFERENCE_REGEX = new RegExp(
  `\\b(?:${Array.from(new Set(
    DEGENERATE_SECTION_KEYS.flatMap(({ key, label }) => [
      normalizeForMatch(label),
      normalizeForMatch(key.replace(/([a-z])([A-Z])/g, '$1 $2')),
    ]).filter(Boolean)
  )).map(escapeForRegex).join('|')})\\b`,
  'i'
);

const DEGENERATE_OUT_OF_SCOPE_MARKER_REGEX = /\b(?:explicitly\s+)?(?:out\s+of\s+scope|not\s+in\s+scope|excluded|deferred|not\s+included|ausgeschlossen|verschoben|nicht\s+im\s+scope)\b/i;
const DEGENERATE_LEGACY_SELF_REFERENCE_REGEX = /\b(?:ausgeschlossene?\s+features?\b|excluded\s+features?\b|out\s+of\s+scope.*not\s+in\s+scope|nicht\s+im\s+scope.*ausgeschlossen)\b/i;

function collectDegenerateSectionIssues(
  structure: PRDStructure,
  knownFallbackSections: Set<string>
): DeterministicSemanticIssue[] {
  const issues: DeterministicSemanticIssue[] = [];

  for (const { key, label } of DEGENERATE_SECTION_KEYS) {
    // Kein Fallback-Skip: Degenerate Content muss immer erkannt werden,
    // auch wenn die Section vom Compiler eingefuegt wurde — spaetere
    // Pipeline-Schritte (Repair, Regeneration) koennen Fallbacks degradieren.
    const text = String(structure[key] || '').trim();
    if (!text) continue;

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // Muster 1: Heading innerhalb einer Liste ("- ### ...", "* ### ...", "• ### ...")
    const headingInList = lines.some(l => /^\s*[-*•+]\s*#{1,4}\s/.test(l));

    // Muster 2: Selbstreferenzielle Leer-Saetze — gesamte Section ist nur 1 Zeile
    // und enthaelt kaum substantiven Inhalt, z.B.:
    //   "Ausgeschlossene Features ist in diesem Release ausgeschlossen."
    // Nicht triggern bei konkreten Ausschluessen wie "Native mobile apps are excluded."
    const normalizedSingleLine = lines.length === 1 ? normalizeForMatch(lines[0]) : '';
    const selfReferential = lines.length === 1 && lines[0].length < 100 && (
      DEGENERATE_LEGACY_SELF_REFERENCE_REGEX.test(normalizedSingleLine)
      || (
        DEGENERATE_SECTION_SELF_REFERENCE_REGEX.test(normalizedSingleLine)
        && DEGENERATE_OUT_OF_SCOPE_MARKER_REGEX.test(normalizedSingleLine)
      )
    );

    if (headingInList || selfReferential) {
      issues.push({
        code: 'section_content_degenerate',
        message: `Section "${label}" contains degenerate content: ${headingInList ? 'heading inside list item' : 'self-referential placeholder sentence'}.`,
        severity: 'error',
        evidencePath: key,
        evidenceSnippet: text.slice(0, 200),
      });
    }
  }

  return issues;
}


// ÄNDERUNG 14.03.2026: Erkennt leere Enrichment-Felder wenn Purpose/Name
// semantisch relevante Begriffe enthaelt. Damit kann der deterministische
// Repair das Feld VORHER auffuellen, bevor der Semantic Verifier es als
// feature_section_semantic_mismatch meldet.
const UI_INDICATOR_PATTERNS = [
  /(?:ui|interface|screen|button|display|anzeige|men[uü]e?|dashboard|widget|ansicht|darstellung|visual|overlay|hud|profil|view|panel|modal|dialog|fenster|seite|page)/i,
];
const DATA_INDICATOR_PATTERNS = [
  /(?:persist|speicher|storage|daten(?:bank)?|data(?:base)?|save|load|synchron|cache|migration|backup|export|import)/i,
];
const ENRICHMENT_FIELD_MIN_LENGTH = 30;

function extractFeatureEmptyEnrichmentFieldIssues(
  structure: PRDStructure
): DeterministicSemanticIssue[] {
  const issues: DeterministicSemanticIssue[] = [];
  const features = structure.features || [];

  for (const feature of features) {
    const featureId = String(feature.id || '').trim();
    if (!featureId) continue;
    const purposeAndName = [
      String(feature.name || '').trim(),
      String(feature.purpose || '').trim(),
    ].join(' ');
    if (!purposeAndName) continue;

    const uiImpactText = String(feature.uiImpact || '').trim();
    const dataImpactText = String(feature.dataImpact || '').trim();

    if (uiImpactText.length < ENRICHMENT_FIELD_MIN_LENGTH
        && UI_INDICATOR_PATTERNS.some(p => p.test(purposeAndName))) {
      issues.push({
        code: 'feature_enrichment_field_empty',
        message: `Feature "${featureId}: ${String(feature.name || '').trim()}" mentions UI concepts in its purpose but uiImpact is empty or too brief.`,
        severity: 'warning',
        evidencePath: `feature:${featureId}.uiImpact`,
        evidenceSnippet: purposeAndName.slice(0, 220),
        relatedPaths: ['uiImpact'],
      });
    }

    if (dataImpactText.length < ENRICHMENT_FIELD_MIN_LENGTH
        && DATA_INDICATOR_PATTERNS.some(p => p.test(purposeAndName))) {
      issues.push({
        code: 'feature_enrichment_field_empty',
        message: `Feature "${featureId}: ${String(feature.name || '').trim()}" mentions data/persistence concepts in its purpose but dataImpact is empty or too brief.`,
        severity: 'warning',
        evidencePath: `feature:${featureId}.dataImpact`,
        evidenceSnippet: purposeAndName.slice(0, 220),
        relatedPaths: ['dataImpact'],
      });
    }
  }

  return issues;
}

export function collectDeterministicSemanticIssues(
  structure: PRDStructure,
  options: CollectSemanticIssuesOptions = {}
): DeterministicSemanticIssue[] {
  const issues: DeterministicSemanticIssue[] = [];
  const knownFallbackSections = new Set(options.fallbackSections || []);
  const systemBoundariesAreFallback = isCompilerFilledScope('systemBoundaries', knownFallbackSections);
  const deploymentIsFallback = isCompilerFilledScope('deployment', knownFallbackSections);
  const allScopes = gatherTextScopes(structure);
  const domainModelIsFallback = isCompilerFilledScope('domainModel', knownFallbackSections);
  const businessRulesAreFallback = isCompilerFilledScope('globalBusinessRules', knownFallbackSections);
  const outOfScopeIsFallback = isCompilerFilledScope('outOfScope', knownFallbackSections);

  if (!domainModelIsFallback) {
    const domainSchemas = parseDomainEntitySchemas(String(structure.domainModel || ''));
    const references = collectEntityFieldReferences(allScopes);
    const identifierOccurrences = extractIdentifierOccurrences(allScopes);

    const issueKeys = new Set<string>();

    if (domainSchemas.length > 0) {
      for (const reference of references) {
        const schema = domainSchemas.find(entry => entry.entityKey === reference.entityKey);
        if (!schema) continue;
        const expectedField = findClosestSchemaField(schema, reference.fieldKey);
        if (expectedField) {
          const expectedParts = splitIdentifierParts(expectedField);
          const referenceParts = splitIdentifierParts(reference.field);
          if (buildIdentifierRawKey(expectedParts) === buildIdentifierRawKey(referenceParts)) {
            continue;
          }
        }

        const issueKey = `${schema.entityKey}:${reference.fieldKey}:${reference.path}`;
        if (issueKeys.has(issueKey)) continue;
        issueKeys.add(issueKey);

        issues.push({
          code: expectedField ? 'schema_field_reference_mismatch' : 'schema_field_reference_missing',
          message: expectedField
            ? `Reference "${reference.entity}.${reference.field}" in ${reference.path} conflicts with Domain Model field "${schema.entity}.${expectedField}".`
            : `Reference "${reference.entity}.${reference.field}" in ${reference.path} is not declared in the Domain Model for entity "${schema.entity}".`,
          severity: 'error',
          evidencePath: reference.path,
          evidenceSnippet: reference.snippet,
        });
      }
    }

    const groupedOccurrences = new Map<string, IdentifierOccurrence[]>();
    for (const occurrence of identifierOccurrences) {
      const list = groupedOccurrences.get(occurrence.singularKey) || [];
      list.push(occurrence);
      groupedOccurrences.set(occurrence.singularKey, list);
    }

    for (const occurrences of groupedOccurrences.values()) {
      const rawVariants = Array.from(new Map(
        occurrences.map(occurrence => [occurrence.normalizedRawKey, occurrence])
      ).values());

      if (rawVariants.length < 2) continue;
      const hasDomainOrFeatureSchemaReference = rawVariants.some(occurrence =>
        occurrence.path === 'domainModel'
        || /\.dataImpact\b/i.test(occurrence.path)
        || /\.rawContent\b/i.test(occurrence.path)
      );
      if (!hasDomainOrFeatureSchemaReference) continue;

      const distinctWithoutFormatting = new Set(rawVariants.map(occurrence => occurrence.parts.join('|')));
      if (distinctWithoutFormatting.size < 2) continue;

      const first = rawVariants[0];
      const pluralOnly = rawVariants.every(occurrence => {
        if (occurrence.parts.length !== first.parts.length) return false;
        return occurrence.parts.every((part, index) => singularizeIdentifierPart(part) === singularizeIdentifierPart(first.parts[index]));
      });
      if (!pluralOnly) continue;

      const canonicalVariants = Array.from(new Set(rawVariants.map(occurrence => occurrence.raw)));
      if (canonicalVariants.length < 2) continue;

      const issueKey = canonicalVariants
        .map(value => value.toLowerCase())
        .sort()
        .join('|');
      if (issueKeys.has(issueKey)) continue;
      issueKeys.add(issueKey);

      const examplePaths = rawVariants
        .slice(0, 3)
        .map(occurrence => `${occurrence.raw} (${occurrence.path})`)
        .join(', ');

      issues.push({
        code: 'schema_field_identifier_mismatch',
        message: `Field identifiers likely refer to the same schema field but disagree on plurality or naming: ${examplePaths}.`,
        severity: 'error',
        evidencePath: rawVariants[0].path,
        evidenceSnippet: rawVariants[0].snippet,
        relatedPaths: rawVariants.map(occurrence => occurrence.path),
      });
    }
  }

  if (!businessRulesAreFallback) {
    const comparableScopes = allScopes.filter(scope => !isCompilerFilledScope(scope.sectionKey, knownFallbackSections));
    const constraints = extractConstraints(comparableScopes);
    const baseConstraints = constraints.filter(constraint => constraint.sectionKey === 'globalBusinessRules');
    const otherConstraints = constraints.filter(constraint => constraint.sectionKey !== 'globalBusinessRules');
    const issueKeys = new Set<string>();

    for (const base of baseConstraints) {
      for (const other of otherConstraints) {
        if (!constraintsConflict(base, other)) continue;
        const issueKey = `${base.subject}:${base.path}:${other.path}`;
        if (issueKeys.has(issueKey)) continue;
        issueKeys.add(issueKey);

        issues.push({
          code: 'business_rule_constraint_conflict',
          message: `Business rule constraint conflict for "${base.subject}": ${base.path} says "${base.snippet}" but ${other.path} says "${other.snippet}".`,
          severity: 'error',
          evidencePath: other.path,
          evidenceSnippet: other.snippet,
        });
      }
    }
  }

  if (!outOfScopeIsFallback) {
    const exclusions = parseScopeExclusions(String(structure.outOfScope || ''));
    const targets = targetScopesForScopeChecks(structure)
      .filter(scope => !isCompilerFilledScope(scope.sectionKey, knownFallbackSections));
    const issueKeys = new Set<string>();

    for (const exclusion of exclusions) {
      for (const target of targets) {
        const targetTokens = tokenizeScopeValue(target.value);
        const overlap = tokenOverlapRatio(exclusion.tokens, targetTokens);
        const hasHighSignalTokenOverlap = exclusion.tokens.some(token =>
          HIGH_SIGNAL_SCOPE_TOKENS.has(token) && targetTokens.includes(token)
        );
        if ((overlap < 0.75 || exclusion.tokens.length < 2) && !hasHighSignalTokenOverlap) continue;

        const sharedMeaningful = exclusion.tokens.filter(token =>
          targetTokens.includes(token) && !IDENTIFIER_STOP_WORDS.has(token)
        );
        const hasHighSignalOverlap = sharedMeaningful.some(token => HIGH_SIGNAL_SCOPE_TOKENS.has(token));
        if (sharedMeaningful.length < 2 && !hasHighSignalOverlap) continue;

        const issueKey = `${exclusion.label.toLowerCase()}|${target.path}`;
        if (issueKeys.has(issueKey)) continue;
        issueKeys.add(issueKey);

        issues.push({
          code: 'out_of_scope_reintroduced',
          message: `Out-of-scope item "${exclusion.label}" is reintroduced in ${target.path}.`,
          severity: 'error',
          evidencePath: target.path,
          evidenceSnippet: normalizeWhitespace(target.value).slice(0, 220),
        });
      }
    }
  }

  if (!domainModelIsFallback && !businessRulesAreFallback) {
    issues.push(...extractRuleSchemaPropertyCoverageIssues(structure));
  }

  issues.push(...analyzeTimelineFeatureReferenceMismatch(structure).issues);

  const visionFirst = collectVisionFirstCoverageIssues(structure, options);
  issues.push(...visionFirst.issues);
  issues.push(...extractFeatureCoreSemanticGapIssues(
    structure,
    options,
    visionFirst.diagnostics.primaryCapabilityAnchors,
  ));

  issues.push(...extractFeatureEmptyEnrichmentFieldIssues(structure));

  if (!outOfScopeIsFallback) {
    issues.push(...extractOutOfScopeFutureLeakageIssues(String(structure.outOfScope || '')));
  }

  if (!systemBoundariesAreFallback && !deploymentIsFallback) {
    issues.push(...extractDeploymentRuntimeContradictionIssues(structure));
  }

  issues.push(...collectDegenerateSectionIssues(structure, knownFallbackSections));

  return issues;
}

export function collectVisionFirstCoverageDiagnostics(
  structure: PRDStructure,
  options: CollectSemanticIssuesOptions = {}
): VisionFirstCoverageDiagnostics {
  return collectVisionFirstCoverageIssues(structure, options).diagnostics;
}

export function collectTimelineConsistencyDiagnostics(
  structure: PRDStructure
): TimelineConsistencyDiagnostics {
  return analyzeTimelineFeatureReferenceMismatch(structure).diagnostics;
}
