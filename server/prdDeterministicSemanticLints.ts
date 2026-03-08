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
}

interface CollectSemanticIssuesOptions {
  mode?: 'generate' | 'improve';
  language?: SupportedLanguage;
  fallbackSections?: string[];
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
  'the',
  'this',
  'version',
  'werden',
  'wird',
]);

const CONSTRAINT_SUBJECT_PATTERNS: Array<{ subject: string; regex: RegExp }> = [
  { subject: 'timeout', regex: /\b(?:timeout|time[- ]out)\b/i },
  { subject: 'response_time', regex: /\b(?:response time|response times|latency|antwortzeit(?:en)?|latenz)\b/i },
  { subject: 'render_time', regex: /\b(?:render(?:ing)? time|renderzeit|initialrenderzeit)\b/i },
  { subject: 'switches_per_request', regex: /\b(?:switch(?:es)?(?:\s+per\s+request)?|wechsel(?:n)?(?:\s+pro\s+anfrage)?)\b/i },
  { subject: 'retry_attempts', regex: /\b(?:retry(?: attempts?)?|retries|attempts?|versuch(?:e|en)?)\b/i },
  { subject: 'availability', regex: /\b(?:availability|uptime|verfuegbarkeit)\b/i },
];

const COMPARATOR_MAX = /(?:<=|=<|\bat most\b|\bmax(?:imum)?\b|\bmaximal\b|\bhoechstens\b|\bunder\b|\bbelow\b|\bwithin\b)/i;
const COMPARATOR_MIN = /(?:>=|=>|\bat least\b|\bmin(?:imum)?\b|\bmindestens\b|\babove\b|\bover\b)/i;
const COMPARATOR_EXACT = /(?:=|\bexactly\b|\bequals?\b|\bset to\b|\bmust be\b|\bis\b|\bist\b|\bbetraegt\b)/i;
const NUMERIC_VALUE = /(\d+(?:[.,]\d+)?)\s*(ms|milliseconds?|s|sec|seconds?|m|min|minutes?|h|hours?|d|days?|%|percent|rps|requests?\s*\/\s*s)?/i;

function normalizeWhitespace(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

function singularizeIdentifierPart(part: string): string {
  const normalized = String(part || '').toLowerCase();
  if (normalized === 'ids') return 'id';
  if (normalized.endsWith('ies') && normalized.length > 4) return `${normalized.slice(0, -3)}y`;
  if (normalized.endsWith('es') && normalized.length > 4 && /(?:ches|shes|sses|xes|zes)$/.test(normalized)) {
    return normalized.slice(0, -2);
  }
  if (normalized.endsWith('s') && normalized.length > 3 && !normalized.endsWith('ss')) {
    return normalized.slice(0, -1);
  }
  return normalized;
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
  return normalizeForMatch(value)
    .split(/\s+/)
    .filter(token => token.length >= 3)
    .filter(token => !SCOPE_STOP_WORDS.has(token));
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
      } else if (NEGATION_MARKERS.some(marker => normalized.includes(marker))) {
        rawItems = [line];
      }
    }

    for (const rawItem of rawItems) {
      const label = normalizeWhitespace(rawItem)
        .replace(/\b(?:for|from|in|this|diesem|dieser|dieses|release|version|v\d+)\b.*$/i, '')
        .trim();
      const tokens = tokenizeScopeValue(label)
        .filter(token => !NEGATION_MARKERS.includes(token))
        .filter(token => !SCOPE_STOP_WORDS.has(token));
      if (tokens.length < 2) continue;
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

  for (const key of ['timelineMilestones', 'successCriteria', 'definitionOfDone'] as const) {
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

function isCompilerFilledScope(sectionKey: string, knownFallbackSections: Set<string>): boolean {
  if (sectionKey.startsWith('feature:')) return false;
  return isCompilerFilledSection(sectionKey, knownFallbackSections);
}

export function collectDeterministicSemanticIssues(
  structure: PRDStructure,
  options: CollectSemanticIssuesOptions = {}
): DeterministicSemanticIssue[] {
  const issues: DeterministicSemanticIssue[] = [];
  const knownFallbackSections = new Set(options.fallbackSections || []);
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
        if (overlap < 0.75 || exclusion.tokens.length < 2) continue;

        const sharedMeaningful = exclusion.tokens.filter(token =>
          targetTokens.includes(token) && !IDENTIFIER_STOP_WORDS.has(token)
        );
        if (sharedMeaningful.length < 2) continue;

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

  return issues;
}
