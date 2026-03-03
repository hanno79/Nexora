import type { FeatureSpec, PRDStructure } from './prdStructure';

type SupportedLanguage = 'de' | 'en';
type QualitySeverity = 'error' | 'warning';

interface QualityIssue {
  code: string;
  message: string;
  severity: QualitySeverity;
}

export interface FeatureAggregationCandidate {
  featureIds: string[];
  reason: 'name_similarity' | 'crud_family';
  tokenJaccard: number;
  editSimilarity: number;
}

export interface FeatureNearDuplicatePair {
  featureIds: [string, string];
  tokenJaccard: number;
  editSimilarity: number;
}

export interface FeatureAggregationAnalysis {
  candidates: FeatureAggregationCandidate[];
  nearDuplicates: FeatureNearDuplicatePair[];
}

export interface FeatureAggregationApplyResult {
  structure: PRDStructure;
  aggregatedFeatureCount: number;
  clusterCount: number;
}

export interface MetaLeakSanitizationResult {
  structure: PRDStructure;
  removedSegments: number;
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

const NAME_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'with', 'without', 'to', 'of', 'in', 'on', 'by', 'from',
  'der', 'die', 'das', 'und', 'oder', 'mit', 'ohne', 'von', 'zu', 'im', 'in', 'auf', 'fuer', 'fur',
  'feature', 'funktion', 'funktionalitaet', 'capability', 'module', 'system', 'workflow', 'prozess',
  'management', 'verwaltung', 'service', 'tool', 'plattform', 'platform',
]);

const CRUD_ACTION_TOKENS = new Set([
  'create', 'add', 'new', 'register', 'capture', 'submit', 'build',
  'read', 'view', 'show', 'fetch', 'list', 'search',
  'update', 'edit', 'change', 'modify',
  'delete', 'remove', 'archive',
  'manage',
  'anlegen', 'erstellen', 'anzeigen', 'auflisten', 'suche', 'suchen',
  'bearbeiten', 'aendern', 'aenderung', 'aktualisieren',
  'loeschen', 'entfernen', 'archivieren',
  'verwalten',
]);

const EN_MARKERS = new Set([
  'the', 'and', 'for', 'with', 'without', 'from', 'this', 'that', 'these', 'those', 'user', 'users',
  'shall', 'must', 'should', 'when', 'then', 'if', 'while', 'within', 'through', 'across', 'where',
  'is', 'are', 'be', 'can', 'will', 'not', 'only', 'each', 'every', 'all', 'any',
]);

const DE_MARKERS = new Set([
  'der', 'die', 'das', 'und', 'oder', 'mit', 'ohne', 'fuer', 'fur', 'bei', 'nach', 'vor', 'wenn',
  'dann', 'sobald', 'nutzer', 'benutzer', 'muss', 'soll', 'sollen', 'wird', 'werden', 'ist', 'sind',
  'nicht', 'nur', 'jede', 'jeder', 'jedes', 'alle', 'ein', 'eine', 'einem', 'einer', 'einen',
]);

const EN_ACTION_MARKERS = new Set([
  'create', 'add', 'edit', 'update', 'delete', 'remove', 'view', 'list', 'search', 'manage',
  'import', 'export', 'save', 'load', 'submit', 'approve', 'review', 'track', 'sync', 'configure',
]);

const DE_ACTION_MARKERS = new Set([
  'erstellen', 'anlegen', 'bearbeiten', 'aktualisieren', 'aendern', 'loeschen', 'entfernen',
  'anzeigen', 'auflisten', 'suchen', 'verwalten', 'importieren', 'exportieren', 'speichern',
  'laden', 'einreichen', 'freigeben', 'pruefen', 'nachverfolgen', 'synchronisieren', 'konfigurieren',
  // German nouns commonly found in feature names
  'verwaltung', 'erfassung', 'steuerung', 'uebersicht', 'konfiguration', 'einstellung',
  'registrierung', 'authentifizierung', 'benachrichtigung', 'automatisierung', 'integration',
]);

const TECH_ALLOWLIST = new Set([
  'api', 'apis', 'oauth', 'oidc', 'rbac', 'abac', 'sso', 'jwt', 'sql', 'nosql', 'http', 'https',
  'rest', 'graphql', 'grpc', 'webhook', 'webhooks', 'docker', 'kubernetes', 'k8s', 'terraform',
  'ci', 'cd', 'git', 'postgres', 'postgresql', 'mysql', 'redis', 'kafka', 's3', 'cdn', 'dns',
  'latency', 'sla', 'slo', 'slis', 'p95', 'p99', 'gpu', 'cpu', 'ram', 'otp', 'sms', 'email',
  'sdk', 'cli', 'ui', 'ux', 'json', 'yaml', 'xml', 'csv', 'etl', 'ml', 'ai', 'llm', 'openai',
  'openrouter', 'clerk', 'node', 'typescript', 'react', 'vite', 'jest', 'vitest',
]);

const META_BLOCK_START = /^(?:#{1,6}\s*)?(?:iteration\s+\d+|questions\s+identified|best\s+practice\s+recommendations|original\s+prd|review\s+feedback)\b[:\-\s]*$/i;
const META_SINGLE_LINE = /^(?:#{1,6}\s*)?(?:answer|reasoning|concrete\s+implementation)\s*:/i;
const META_INLINE_TEST = /\b(?:iteration\s+\d+|questions\s+identified|best\s+practice\s+recommendations|original\s+prd|review\s+feedback|answer:|reasoning:|concrete\s+implementation:)\b/i;
const META_INLINE_REPLACE = /\b(?:iteration\s+\d+|questions\s+identified|best\s+practice\s+recommendations|original\s+prd|review\s+feedback|answer:|reasoning:|concrete\s+implementation:)\b/gi;

const KNOWN_COMPILER_SCAFFOLD_PATTERNS: RegExp[] = [
  // Section-level scaffold (EN)
  /is explicitly defined for this/i,
  /statements are implementation ready testable and binding for this version/i,
  /this section is concretized around prioritized user and delivery outcomes/i,
  /core scope centers on the feature workflows/i,
  /context priorities include/i,
  // Section-level scaffold (DE)
  /ist fuer dieses .* explizit beschrieben/i,
  /die aussagen sind umsetzbar testbar und fuer diese version verbindlich/i,
  /kernfokus sind die feature workflows/i,
  /der kontext umfasst insbesondere/i,
  // Feature-field scaffold (EN) — from buildFeatureFieldTemplate()
  /deliver(s)? a clearly scoped user capability with an observable outcome/i,
  /defines an independent testable workflow/i,
  /implemented as a deterministic functional unit with explicit behavior/i,
  /primary.*end user invoking/i,
  /actors include users triggering/i,
  /users interact with .* while backend/i,
  /user explicitly initiates .* through the interface/i,
  /triggered by a concrete user action/i,
  /ui event starts the .* workflow/i,
  /required inputs are present and validated/i,
  /authentication and authorization requirements/i,
  /dependent services are reachable/i,
  /system receives the .* request and validates input/i,
  /business logic for .* executes deterministically/i,
  /relevant data is created or updated atomically/i,
  /ui reflects the result of .* and confirms completion/i,
  /validation failure.*system returns a clear error and performs no partial write/i,
  /transient failure.*system logs the issue and offers a retry path/i,
  /after .* completes.*resulting state is consistent/i,
  /reads and updates only.*in.scope entities/i,
  /ui surfaces loading.*success.*and error states/i,
  /is verifiable by end users directly in the ui without manual reload/i,
  /error paths for .* provide clear user feedback and keep state consistent/i,
  /data mutations caused by .* are observable after execution/i,
  // Feature-field scaffold (DE) — from buildFeatureFieldTemplate()
  /liefert einen klar abgegrenzten nutzerwert/i,
  /beschreibt einen eigenstaendigen.*testbaren anwendungsfall/i,
  /wird als implementierbare funktionseinheit/i,
  /primaer.*endnutzer im kontext/i,
  /akteure sind nutzer.*die .* ausloesen/i,
  /nutzer interagieren direkt mit/i,
  /der nutzer startet .* explizit ueber die benutzeroberflaeche/i,
  /wird durch eine konkrete nutzeraktion/i,
  /ein ui.event initiiert den ablauf/i,
  /alle benoetigten eingaben sind vorhanden und vorvalidiert/i,
  /authentifizierung und berechtigungen/i,
  /abhaengige dienste sind erreichbar/i,
  /system nimmt die anfrage .* entgegen und validiert/i,
  /geschaeftslogik fuer .* wird deterministisch ausgefuehrt/i,
  /relevante daten werden atomar gespeichert/i,
  /ui wird mit dem ergebnis von .* aktualisiert/i,
  /validierung fehlgeschlagen.*system liefert eine klare fehlermeldung/i,
  /temporaer.*fehler.*system protokolliert den fehler/i,
  /nach abschluss von .* ist der resultierende zustand konsistent/i,
  /liest und aktualisiert nur die relevanten entitaeten/i,
  /oberflaeche zeigt lade.*erfolg.*und fehlerzustaende/i,
  /ist fuer einen nutzer ohne manuelles nachladen in der ui verifizierbar/i,
  /fehlerfaelle von .* liefern klare nutzerhinweise/i,
  /die durch .* verursachten datenaenderungen sind.*nachvollziehbar/i,
];

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[`*_>#\-:()\[\]{}]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSentence(value: string): string {
  return normalizeText(value)
    // ACHTUNG: Umlaut-Normalisierung kann zu Kollisionen führen (z.B. "Maße" vs "Masse")
    // Dies ist akzeptabel für Boilerplate-Erkennung, da:
    // 1. Nur interner Vergleich - keine Benutzerdaten werden verändert
    // 2. Kollisionen sind selten und führen maximal zu falsch-positiven Boilerplate-Erkennungen
    // 3. Die alternative (keine Normalisierung) würde deutsche Scaffold-Sätze nicht erkennen
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .map(token => token.trim())
    .filter(token => token.length >= 2);
}

function tokenizeFeatureName(name: string): string[] {
  return tokenize(name).filter(token => !NAME_STOP_WORDS.has(token));
}

function toTokenSet(tokens: string[]): Set<string> {
  return new Set(tokens.filter(Boolean));
}

function tokenJaccard(a: string[], b: string[]): number {
  const sa = toTokenSet(a);
  const sb = toTokenSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let intersection = 0;
  for (const token of Array.from(sa)) {
    if (sb.has(token)) intersection++;
  }
  const union = new Set([...Array.from(sa), ...Array.from(sb)]).size;
  if (union === 0) return 0;
  return intersection / union;
}

function levenshteinDistance(a: string, b: string): number {
  const aa = String(a || '');
  const bb = String(b || '');
  if (aa === bb) return 0;
  if (!aa.length) return bb.length;
  if (!bb.length) return aa.length;

  const prev = new Array<number>(bb.length + 1);
  const curr = new Array<number>(bb.length + 1);

  for (let j = 0; j <= bb.length; j++) prev[j] = j;

  for (let i = 1; i <= aa.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= bb.length; j++) {
      const cost = aa[i - 1] === bb[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= bb.length; j++) prev[j] = curr[j];
  }

  return prev[bb.length];
}

function editSimilarity(a: string, b: string): number {
  const aa = normalizeText(a);
  const bb = normalizeText(b);
  if (!aa || !bb) return 0;
  const dist = levenshteinDistance(aa, bb);
  const maxLen = Math.max(aa.length, bb.length) || 1;
  return 1 - (dist / maxLen);
}

function extractCrudActionTokens(name: string): string[] {
  const tokens = tokenize(name);
  return tokens.filter(token => CRUD_ACTION_TOKENS.has(token));
}

function extractCrudObjectCore(name: string): string {
  const tokens = tokenize(name).filter(token => !NAME_STOP_WORDS.has(token));
  const filtered = tokens.filter(token => !CRUD_ACTION_TOKENS.has(token));
  return filtered.slice(0, 4).join(' ');
}

function compareFeatureId(aId: string, bId: string): number {
  const parseNum = (id: string): number => {
    const match = String(id || '').trim().toUpperCase().match(/^F-(\d{1,})$/);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  };

  const numA = parseNum(aId);
  const numB = parseNum(bId);
  if (numA !== numB) return numA - numB;
  return String(aId || '').localeCompare(String(bId || ''));
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (!trimmed) continue;
    const key = normalizeText(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function mergeTextValues(baseValue: string | undefined, candidateValue: string | undefined): string | undefined {
  const merged = uniqueStrings([String(baseValue || '').trim(), String(candidateValue || '').trim()]);
  if (merged.length === 0) return undefined;
  if (merged.length === 1) return merged[0];
  return merged.join('\n\n');
}

function mergeArrayValues(baseValue: string[] | undefined, candidateValue: string[] | undefined): string[] | undefined {
  const merged = uniqueStrings([...(baseValue || []), ...(candidateValue || [])]);
  return merged.length > 0 ? merged : undefined;
}

function cloneStructure(structure: PRDStructure): PRDStructure {
  return {
    ...structure,
    features: [...(structure.features || [])].map(feature => ({ ...feature })),
    otherSections: { ...(structure.otherSections || {}) },
  };
}

function sanitizeMetaLeakText(value: string): { text: string; removed: number } {
  const lines = String(value || '').split(/\r?\n/);
  const out: string[] = [];
  let removed = 0;
  let skipListBlock = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();

    if (META_BLOCK_START.test(trimmed)) {
      removed++;
      skipListBlock = true;
      continue;
    }

    if (skipListBlock) {
      const isContinuation = trimmed.length > 0 && (
        /^[-*]\s+/.test(trimmed) ||
        /^\d+[.)]\s+/.test(trimmed) ||
        /^\s{2,}\S+/.test(line)
      );
      if (isContinuation) {
        removed++;
        continue;
      }
      if (!trimmed) {
        removed++;
        skipListBlock = false;
        continue;
      }
      skipListBlock = false;
    }

    if (META_SINGLE_LINE.test(trimmed)) {
      removed++;
      continue;
    }

    if (META_INLINE_TEST.test(line)) {
      line = line.replace(META_INLINE_REPLACE, '').replace(/\s{2,}/g, ' ').trim();
      removed++;
    }

    if (!line.trim()) {
      if (out.length === 0 || out[out.length - 1].trim() === '') {
        continue;
      }
      out.push('');
      continue;
    }

    out.push(line);
  }

  return {
    text: out.join('\n').trim(),
    removed,
  };
}

function gatherTextScopes(structure: PRDStructure): Array<{ scope: string; value: string }> {
  const scopes: Array<{ scope: string; value: string }> = [];

  for (const key of SECTION_KEYS) {
    const value = String((structure as any)[key] || '').trim();
    if (!value) continue;
    scopes.push({ scope: `section:${String(key)}`, value });
  }

  for (const [heading, content] of Object.entries(structure.otherSections || {})) {
    const value = String(content || '').trim();
    if (!value) continue;
    scopes.push({ scope: `other:${heading}`, value });
  }

  for (const feature of structure.features || []) {
    const featureId = String(feature.id || '').trim() || 'feature';
    const name = String(feature.name || '').trim();
    if (name) {
      scopes.push({ scope: `feature:${featureId}.name`, value: name });
    }

    for (const field of FEATURE_STRING_FIELDS) {
      const value = String((feature as any)[field] || '').trim();
      if (!value) continue;
      scopes.push({ scope: `feature:${featureId}.${String(field)}`, value });
    }

    for (const field of FEATURE_ARRAY_FIELDS) {
      const values = Array.isArray((feature as any)[field]) ? (feature as any)[field] : [];
      for (const entry of values) {
        const value = String(entry || '').trim();
        if (!value) continue;
        scopes.push({ scope: `feature:${featureId}.${String(field)}`, value });
      }
    }
  }

  return scopes;
}

function countLanguageMarkers(tokens: string[]): { en: number; de: number } {
  let en = 0;
  let de = 0;
  for (const token of tokens) {
    if (TECH_ALLOWLIST.has(token)) continue;
    if (EN_MARKERS.has(token) || EN_ACTION_MARKERS.has(token)) en++;
    if (DE_MARKERS.has(token) || DE_ACTION_MARKERS.has(token)) de++;
  }
  return { en, de };
}

function isLanguageMismatch(
  value: string,
  targetLanguage: SupportedLanguage,
  options?: { allowShort?: boolean }
): boolean {
  const text = String(value || '').trim();
  if (!text) return false;

  const normalized = normalizeText(text);
  if (!normalized) return false;

  const tokens = tokenize(normalized).filter(token => !TECH_ALLOWLIST.has(token));
  const allowShort = !!options?.allowShort;
  if (tokens.length < 5 && !allowShort) return false;
  if (tokens.length < 2 && allowShort) return false;

  const hasGermanUmlaut = /[äöüß]/i.test(text);
  const hasGermanTransliterationSignals = /\b(?:fuer|ueber|aender|loesch|benutzer|nutzer|aufgabe|soll|muss|nicht)\b/i.test(normalized);
  const markers = countLanguageMarkers(tokens);

  if (targetLanguage === 'de') {
    if (hasGermanUmlaut || hasGermanTransliterationSignals) return false;
    if (allowShort) return markers.en >= 3 && markers.en > markers.de;
    return markers.en >= 3 && markers.en > markers.de * 1.4;
  }

  if (hasGermanUmlaut) return true;
  if (hasGermanTransliterationSignals && markers.de >= 1) return true;
  if (allowShort) return markers.de >= 1 && markers.de > markers.en;
  return markers.de >= 3 && markers.de > markers.en * 1.4;
}

function splitIntoSentences(value: string): string[] {
  return String(value || '')
    .split(/(?:[.!?]\s+|\n+)/)
    .map(part => part.trim())
    .filter(Boolean);
}

function isKnownCompilerScaffoldSentence(sentence: string): boolean {
  const normalized = normalizeSentence(sentence);
  if (!normalized) return false;
  return KNOWN_COMPILER_SCAFFOLD_PATTERNS.some(pattern => pattern.test(normalized));
}

function featureCoreName(features: FeatureSpec[]): string {
  const names = features.map(f => String(f.name || '').trim()).filter(Boolean);
  if (names.length === 0) return '';

  const objectCores = names.map(extractCrudObjectCore).filter(Boolean);
  if (objectCores.length > 0) {
    const freq = new Map<string, number>();
    for (const core of objectCores) {
      const key = normalizeText(core);
      freq.set(key, (freq.get(key) || 0) + 1);
    }
    const best = Array.from(freq.entries()).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })[0]?.[0];
    if (best) return best;
  }

  return normalizeText(names[0]);
}

function capitalizeWords(value: string): string {
  return value
    .split(' ')
    .map(token => token ? `${token[0].toUpperCase()}${token.slice(1)}` : '')
    .join(' ')
    .trim();
}

function buildMergedFeatureName(features: FeatureSpec[], language: SupportedLanguage): string {
  const core = featureCoreName(features);
  if (core) {
    const label = capitalizeWords(core);
    if (label.length >= 4) {
      return language === 'de' ? `${label} verwalten` : `Manage ${label}`;
    }
  }

  const names = features
    .map(feature => String(feature.name || '').trim())
    .filter(Boolean)
    .sort((a, b) => {
      if (a.length !== b.length) return b.length - a.length;
      return a.localeCompare(b);
    });

  return names[0] || 'Merged Feature';
}

export function sanitizeMetaLeaksInStructure(structure: PRDStructure): MetaLeakSanitizationResult {
  const updated = cloneStructure(structure);
  let removedSegments = 0;

  for (const key of SECTION_KEYS) {
    const value = String((updated as any)[key] || '').trim();
    if (!value) continue;
    const sanitized = sanitizeMetaLeakText(value);
    removedSegments += sanitized.removed;
    (updated as any)[key] = sanitized.text;
  }

  const nextOtherSections: Record<string, string> = {};
  for (const [heading, content] of Object.entries(updated.otherSections || {})) {
    const headingLooksMeta = META_BLOCK_START.test(String(heading || '').trim());
    if (headingLooksMeta) {
      removedSegments++;
      continue;
    }
    const sanitized = sanitizeMetaLeakText(String(content || ''));
    removedSegments += sanitized.removed;
    if (sanitized.text.trim()) {
      nextOtherSections[heading] = sanitized.text;
    }
  }
  updated.otherSections = nextOtherSections;

  updated.features = (updated.features || []).map(feature => {
    const next: FeatureSpec = { ...feature };

    const sanitizedName = sanitizeMetaLeakText(String(next.name || ''));
    removedSegments += sanitizedName.removed;
    next.name = sanitizedName.text || next.name;

    const sanitizedRaw = sanitizeMetaLeakText(String(next.rawContent || ''));
    removedSegments += sanitizedRaw.removed;
    next.rawContent = sanitizedRaw.text || next.rawContent;

    for (const field of FEATURE_STRING_FIELDS) {
      const value = String((next as any)[field] || '').trim();
      if (!value) continue;
      const sanitized = sanitizeMetaLeakText(value);
      removedSegments += sanitized.removed;
      (next as any)[field] = sanitized.text;
    }

    for (const field of FEATURE_ARRAY_FIELDS) {
      const values = Array.isArray((next as any)[field]) ? (next as any)[field] : [];
      const sanitizedValues: string[] = [];
      for (const entry of values) {
        const sanitized = sanitizeMetaLeakText(String(entry || ''));
        removedSegments += sanitized.removed;
        if (sanitized.text.trim()) sanitizedValues.push(sanitized.text.trim());
      }
      (next as any)[field] = sanitizedValues;
    }

    return next;
  });

  return {
    structure: updated,
    removedSegments,
  };
}

export function collectMetaLeakIssues(structure: PRDStructure): QualityIssue[] {
  const scopes = gatherTextScopes(structure);
  const hits: string[] = [];

  for (const scope of scopes) {
    if (META_INLINE_TEST.test(scope.value) || META_BLOCK_START.test(scope.value) || META_SINGLE_LINE.test(scope.value)) {
      hits.push(scope.scope);
    }
  }

  if (hits.length === 0) return [];

  const sample = hits.slice(0, 6).join(', ');
  const extra = hits.length > 6 ? ` (+${hits.length - 6} more)` : '';
  return [
    {
      code: 'meta_prompt_leak_detected',
      message: `Prompt/meta leakage detected in PRD content: ${sample}${extra}.`,
      severity: 'error',
    },
  ];
}

export function collectLanguageConsistencyIssues(
  structure: PRDStructure,
  targetLanguage: SupportedLanguage,
  _category?: string | null
): QualityIssue[] {
  const issues: QualityIssue[] = [];

  for (const key of SECTION_KEYS) {
    const value = String((structure as any)[key] || '').trim();
    if (!value) continue;
    if (!isLanguageMismatch(value, targetLanguage)) continue;
    issues.push({
      code: `language_mismatch_section_${String(key)}`,
      message: `Section "${String(key)}" is not consistently written in target language "${targetLanguage}".`,
      severity: 'error',
    });
  }

  const featureNameMismatches: string[] = [];
  for (const feature of structure.features || []) {
    const featureId = String(feature.id || '').trim() || 'feature';

    if (isLanguageMismatch(String(feature.name || ''), targetLanguage, { allowShort: true })) {
      featureNameMismatches.push(featureId);
    }

    for (const field of FEATURE_STRING_FIELDS) {
      const value = String((feature as any)[field] || '').trim();
      if (!value || !isLanguageMismatch(value, targetLanguage)) continue;
      issues.push({
        code: `language_mismatch_feature_field_${String(field)}`,
        message: `Feature ${featureId} field "${String(field)}" is not consistently written in target language "${targetLanguage}".`,
        severity: 'error',
      });
    }

    for (const field of FEATURE_ARRAY_FIELDS) {
      const values = Array.isArray((feature as any)[field]) ? (feature as any)[field] : [];
      if (!values.some((entry: string) => isLanguageMismatch(String(entry || ''), targetLanguage))) continue;
      issues.push({
        code: `language_mismatch_feature_field_${String(field)}`,
        message: `Feature ${featureId} field "${String(field)}" contains mixed language content.`,
        severity: 'error',
      });
    }
  }

  // Ratio-based aggregation for feature name mismatches
  const totalFeatures = (structure.features || []).length;
  if (featureNameMismatches.length > 0 && totalFeatures > 0) {
    const ratio = featureNameMismatches.length / totalFeatures;
    if (ratio > 0.5) {
      // Majority of features in wrong language → blocking error
      issues.push({
        code: 'language_mismatch_feature_names_majority',
        message: `${featureNameMismatches.length}/${totalFeatures} feature names are not consistently written in target language "${targetLanguage}".`,
        severity: 'error',
      });
    } else {
      // Minority → warning only (informational, not blocking)
      issues.push({
        code: 'language_mismatch_feature_name',
        message: `Feature ${featureNameMismatches.join(', ')} name(s) not consistently in target language "${targetLanguage}".`,
        severity: 'warning',
      });
    }
  }

  return issues;
}

export function collectBoilerplateRepetitionIssues(structure: PRDStructure): QualityIssue[] {
  const scopes = gatherTextScopes(structure);
  const sentenceCounts = new Map<string, { count: number; scopes: Set<string> }>();

  for (const scope of scopes) {
    const sentences = splitIntoSentences(scope.value);
    for (const sentence of sentences) {
      if (sentence.length < 40) continue;
      const normalized = normalizeSentence(sentence);
      if (normalized.length < 40) continue;
      if (isKnownCompilerScaffoldSentence(normalized)) continue;
      const existing = sentenceCounts.get(normalized) || { count: 0, scopes: new Set<string>() };
      existing.count += 1;
      existing.scopes.add(scope.scope);
      sentenceCounts.set(normalized, existing);
    }
  }

  const globalRepeats = Array.from(sentenceCounts.entries())
    .filter(([, data]) => data.count >= 7)
    .sort((a, b) => b[1].count - a[1].count);

  const acceptanceValues: Array<{ featureId: string; value: string }> = [];
  for (const feature of structure.features || []) {
    const featureId = String(feature.id || '').trim() || 'feature';
    for (const entry of feature.acceptanceCriteria || []) {
      const value = String(entry || '').trim();
      if (value.length < 30) continue;
      acceptanceValues.push({ featureId, value });
    }
  }

  const acceptanceCounts = new Map<string, Set<string>>();
  for (const entry of acceptanceValues) {
    const normalized = normalizeSentence(entry.value);
    if (!normalized || normalized.length < 30) continue;
    if (isKnownCompilerScaffoldSentence(normalized)) continue;
    const existing = acceptanceCounts.get(normalized) || new Set<string>();
    existing.add(entry.featureId);
    acceptanceCounts.set(normalized, existing);
  }

  const acceptanceRepeats = Array.from(acceptanceCounts.entries())
    .filter(([, featureIds]) => featureIds.size >= 4)
    .sort((a, b) => b[1].size - a[1].size);

  const issues: QualityIssue[] = [];
  if (globalRepeats.length > 0) {
    const top = globalRepeats[0];
    const snippet = top[0].slice(0, 90);
    issues.push({
      code: 'boilerplate_repetition_detected',
      message: `Repeated boilerplate sentence detected ${top[1].count}x across PRD sections/features: \"${snippet}\".`,
      severity: 'error',
    });
  }

  if (acceptanceRepeats.length > 0) {
    const top = acceptanceRepeats[0];
    const snippet = top[0].slice(0, 90);
    issues.push({
      code: 'boilerplate_feature_acceptance_repetition',
      message: `Feature acceptance boilerplate repeats across ${top[1].size} feature(s): \"${snippet}\".`,
      severity: 'error',
    });
  }

  return issues;
}

export function findFeatureAggregationCandidates(
  features: FeatureSpec[],
  _category?: string | null,
  _language: SupportedLanguage = 'en'
): FeatureAggregationAnalysis {
  const candidates: FeatureAggregationCandidate[] = [];
  const nearDuplicates: FeatureNearDuplicatePair[] = [];

  const edgePairs: Array<{ a: number; b: number; reason: 'name_similarity' | 'crud_family'; tokenJaccard: number; editSimilarity: number }> = [];

  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      const a = features[i];
      const b = features[j];
      const aName = String(a.name || '').trim();
      const bName = String(b.name || '').trim();
      if (!aName || !bName) continue;

      const aTokens = tokenizeFeatureName(aName);
      const bTokens = tokenizeFeatureName(bName);
      const jac = tokenJaccard(aTokens, bTokens);
      const edit = editSimilarity(aName, bName);

      const aObjectCore = extractCrudObjectCore(aName);
      const bObjectCore = extractCrudObjectCore(bName);
      const sameCrudObjectCore = !!aObjectCore && !!bObjectCore && normalizeText(aObjectCore) === normalizeText(bObjectCore);
      const hasCrudActions = extractCrudActionTokens(aName).length > 0 && extractCrudActionTokens(bName).length > 0;

      const highByThreshold = jac >= 0.82 || edit >= 0.9 || (jac >= 0.8 && edit >= 0.8);
      const highByCrudFamily = sameCrudObjectCore && hasCrudActions && (jac >= 0.72 || edit >= 0.82);

      if (highByThreshold || highByCrudFamily) {
        edgePairs.push({
          a: i,
          b: j,
          reason: highByCrudFamily ? 'crud_family' : 'name_similarity',
          tokenJaccard: jac,
          editSimilarity: edit,
        });
        continue;
      }

      const near = jac >= 0.74 || edit >= 0.85 || (sameCrudObjectCore && hasCrudActions);
      if (near) {
        nearDuplicates.push({
          featureIds: [String(a.id || ''), String(b.id || '')],
          tokenJaccard: jac,
          editSimilarity: edit,
        });
      }
    }
  }

  if (edgePairs.length === 0) {
    return { candidates, nearDuplicates };
  }

  const parent = new Array<number>(features.length).fill(0).map((_, idx) => idx);
  const find = (x: number): number => {
    if (parent[x] === x) return x;
    parent[x] = find(parent[x]);
    return parent[x];
  };
  const union = (x: number, y: number) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[ry] = rx;
  };

  for (const edge of edgePairs) {
    union(edge.a, edge.b);
  }

  const grouped = new Map<number, number[]>();
  for (let idx = 0; idx < features.length; idx++) {
    const root = find(idx);
    const list = grouped.get(root) || [];
    list.push(idx);
    grouped.set(root, list);
  }

  for (const indices of Array.from(grouped.values())) {
    if (indices.length < 2) continue;
    const ids = indices
      .map(index => String(features[index].id || '').trim())
      .filter(Boolean)
      .sort(compareFeatureId);

    if (ids.length < 2) continue;

    const clusterEdges = edgePairs.filter(edge => indices.includes(edge.a) && indices.includes(edge.b));
    const avgJac = clusterEdges.reduce((acc, edge) => acc + edge.tokenJaccard, 0) / Math.max(clusterEdges.length, 1);
    const avgEdit = clusterEdges.reduce((acc, edge) => acc + edge.editSimilarity, 0) / Math.max(clusterEdges.length, 1);
    const reason = clusterEdges.some(edge => edge.reason === 'crud_family') ? 'crud_family' : 'name_similarity';

    candidates.push({
      featureIds: ids,
      reason,
      tokenJaccard: Number(avgJac.toFixed(3)),
      editSimilarity: Number(avgEdit.toFixed(3)),
    });
  }

  candidates.sort((a, b) => {
    if (a.featureIds.length !== b.featureIds.length) return b.featureIds.length - a.featureIds.length;
    return a.featureIds[0].localeCompare(b.featureIds[0], undefined, { numeric: true });
  });

  return {
    candidates,
    nearDuplicates,
  };
}

export function applyConservativeFeatureAggregation(
  structure: PRDStructure,
  candidates: FeatureAggregationCandidate[],
  language: SupportedLanguage
): FeatureAggregationApplyResult {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return {
      structure: cloneStructure(structure),
      aggregatedFeatureCount: 0,
      clusterCount: 0,
    };
  }

  const updated = cloneStructure(structure);
  const byId = new Map<string, FeatureSpec>();
  for (const feature of updated.features || []) {
    byId.set(String(feature.id || '').trim(), { ...feature });
  }

  let aggregatedFeatureCount = 0;
  let clusterCount = 0;
  const consumed = new Set<string>();
  const replacementByPrimaryId = new Map<string, FeatureSpec>();

  for (const candidate of candidates) {
    const clusterIds = candidate.featureIds
      .map(id => String(id || '').trim())
      .filter(id => id.length > 0 && byId.has(id) && !consumed.has(id));

    if (clusterIds.length < 2) continue;

    clusterIds.sort(compareFeatureId);
    const clusterFeatures = clusterIds
      .map(id => byId.get(id))
      .filter((feature): feature is FeatureSpec => !!feature);

    if (clusterFeatures.length < 2) continue;

    const primaryId = clusterIds[0];
    const primary = { ...clusterFeatures[0], id: primaryId };
    primary.name = buildMergedFeatureName(clusterFeatures, language);

    for (let i = 1; i < clusterFeatures.length; i++) {
      const feature = clusterFeatures[i];
      primary.rawContent = mergeTextValues(primary.rawContent, feature.rawContent) || primary.rawContent;

      for (const field of FEATURE_STRING_FIELDS) {
        (primary as any)[field] = mergeTextValues((primary as any)[field], (feature as any)[field]);
      }

      for (const field of FEATURE_ARRAY_FIELDS) {
        (primary as any)[field] = mergeArrayValues((primary as any)[field], (feature as any)[field]);
      }
    }

    replacementByPrimaryId.set(primaryId, primary);
    clusterCount++;
    aggregatedFeatureCount += clusterFeatures.length - 1;

    for (let i = 1; i < clusterIds.length; i++) {
      consumed.add(clusterIds[i]);
    }
  }

  const mergedFeatures: FeatureSpec[] = [];
  for (const feature of updated.features || []) {
    const id = String(feature.id || '').trim();
    if (!id) continue;
    if (consumed.has(id)) continue;
    if (replacementByPrimaryId.has(id)) {
      mergedFeatures.push(replacementByPrimaryId.get(id)!);
      continue;
    }
    mergedFeatures.push({ ...feature });
  }

  mergedFeatures.sort((a, b) => compareFeatureId(a.id, b.id));

  return {
    structure: {
      ...updated,
      features: mergedFeatures,
      otherSections: { ...(updated.otherSections || {}) },
    },
    aggregatedFeatureCount,
    clusterCount,
  };
}

export function isHighConfidenceFeatureDuplicate(
  a: FeatureSpec,
  b: FeatureSpec,
  category: string | null = 'feature',
  language: SupportedLanguage = 'en'
): boolean {
  const aId = String(a.id || '').trim();
  const bId = String(b.id || '').trim();
  if (aId && bId && aId.toUpperCase() === bId.toUpperCase()) {
    return true;
  }

  const analysis = findFeatureAggregationCandidates([a, b], category, language);
  return analysis.candidates.some(candidate => candidate.featureIds.length >= 2);
}

// ---------------------------------------------------------------------------
// Cross-Section Similarity Detection (V2)
// Detects near-identical content across different non-feature sections.
// ---------------------------------------------------------------------------

const CROSS_SECTION_KEYS: Array<keyof PRDStructure> = [
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

function tokenizeForJaccard(text: string): Set<string> {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3)
  );
}

function jaccardSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export function collectCrossSectionSimilarityIssues(structure: PRDStructure): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const sectionData = new Map<string, { text: string; tokens: Set<string> }>();

  for (const key of CROSS_SECTION_KEYS) {
    const text = String((structure as any)[key] || '').trim();
    if (text.length >= 20) {
      sectionData.set(key, { text, tokens: tokenizeForJaccard(text) });
    }
  }

  const keys = Array.from(sectionData.keys());
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = sectionData.get(keys[i])!;
      const b = sectionData.get(keys[j])!;
      const similarity = jaccardSim(a.tokens, b.tokens);
      if (similarity > 0.7) {
        issues.push({
          code: 'cross_section_near_identical',
          message: `Sections "${keys[i]}" and "${keys[j]}" have near-identical content (${Math.round(similarity * 100)}% token overlap). Each section must provide distinct, section-specific information.`,
          severity: 'error',
        });
      }
    }
  }

  return issues;
}
