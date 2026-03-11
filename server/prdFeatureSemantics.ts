/**
 * Author: rahn
 * Datum: 07.03.2026
 * Version: 1.0
 * Beschreibung: Hilfslogik zur Erkennung semantisch falscher oder unvollständiger Feature-Inhalte
 */

// ÄNDERUNG 07.03.2026: Semantische Feature-Prüfung und Placeholder-Erkennung ausgelagert
// Erkennung für Name-Inhalt-Mismatches und rewrite-relevante Feature-Felder ergänzt
// ÄNDERUNG 07.03.2026: Namens-Normalisierung für CamelCase/Akronyme geschärft und reale MFA-/Session-/Audit-Fehlfamilien ergänzt

import type { FeatureSpec } from './prdStructure';
import { normalizeForMatch } from './prdTextUtils';

export const FEATURE_ENRICHABLE_FIELDS = [
  'name', 'purpose', 'actors', 'trigger', 'preconditions', 'mainFlow',
  'alternateFlows', 'postconditions', 'dataImpact', 'uiImpact', 'acceptanceCriteria',
] as const;

export type FeatureEnrichableField = typeof FEATURE_ENRICHABLE_FIELDS[number];

export interface FeatureSemanticIssue {
  code: string;
  sectionKey: string;
  message: string;
  severity: 'error' | 'warning';
  suggestedAction: 'rewrite' | 'expand' | 'enrich' | 'keep';
  targetFields?: FeatureEnrichableField[];
}

type IntentFamily = {
  key: string;
  label: string;
  namePatterns: RegExp[];
  contentPatterns: RegExp[];
};

const FEATURE_PLACEHOLDER_PATTERNS: RegExp[] = [
  /\bstructure placeholder\b/i,
  /\bto be filled by section repair\b/i,
  /\bTODO\b/i,
  /\bTBD\b/i,
  /\bFIXME\b/i,
  /\bcoming soon\b/i,
];

const INTENT_FAMILIES: IntentFamily[] = [
  {
    key: 'login',
    label: 'login',
    namePatterns: [/\blogin\b/i, /\bsign[ -]?in\b/i, /\banmeld(?:ung|en)\b/i],
    contentPatterns: [/\blogin\b/i, /\bsign[ -]?in\b/i, /\bauth(?:entication|enticate)?\b/i, /\bcredential/i, /\bsession cookie\b/i, /\banmeld(?:ung|en)\b/i, /\banmeldung\b/i, /\bzugangsdaten\b/i, /\bsitzung\b/i],
  },
  {
    key: 'registration',
    label: 'registration',
    namePatterns: [/\bregister(?:ed|ing)?\b/i, /\bregistration\b/i, /\bsign[ -]?up\b/i, /\baccount creation\b/i, /\bregistrier(?:en|ung|t)\b/i],
    contentPatterns: [/\bregister(?:ed|ing)?\b/i, /\bregistration\b/i, /\bsign[ -]?up\b/i, /\bnew user account\b/i, /\bverification email\b/i, /\bunverified\b/i, /\bregistrier(?:en|ung|t|daten)\b/i, /\bbenutzerkonto\b/i, /\bverifizierungs?(?:-?|\s)e-?mail\b/i, /\bnicht bestaetigt\b/i, /\bunbestaetigt\b/i],
  },
  {
    key: 'reset_request',
    label: 'password reset request',
    namePatterns: [/\brequest\b/i, /\bforgot password\b/i, /\breset request\b/i, /\banfordern\b/i],
    contentPatterns: [/\bforgot password\b/i, /\breset request\b/i, /\breset email\b/i, /\breset link\b/i, /\bif an account exists\b/i, /\bsent\b.+\bemail\b/i, /\bpasswort(?:-?reset)? anfordern\b/i, /\breset(?:-?|\s)e-?mail\b/i, /\breset(?:-?|\s)link\b/i, /\bfalls ein konto existiert\b/i],
  },
  {
    key: 'reset_confirm',
    label: 'password reset confirmation',
    namePatterns: [/\bconfirm\b/i, /\bconfirmation\b/i, /\bverify\b/i, /\bverification\b/i, /\bbestaetig(?:en|ung)t?\b/i],
    contentPatterns: [/\bnew password\b/i, /\bpassword change\b/i, /\bpassword update\b/i, /\btoken is (?:present|valid|missing|expired)\b/i, /\bmarked as used\b/i, /\bneues passwort\b/i, /\bpasswort(?:aenderung|änderung|wechsel|aktualisierung)\b/i, /\btoken (?:ist )?(?:gueltig|gültig|ungueltig|ungültig|abgelaufen)\b/i],
  },
  {
    key: 'mfa_enrollment',
    label: 'MFA enrollment',
    namePatterns: [/\benroll(?:ment)?\b/i, /\bsetup\b/i, /\bconfigure\b/i, /\bmulti[ -]?factor authentication\b/i, /\beinricht(?:en|ung)\b/i],
    contentPatterns: [/\bqr code\b/i, /\bauthenticator app\b/i, /\bsecret key\b/i, /\bscan(?:s|ning)?\b/i, /\benable(?:s|d)? mfa\b/i, /\brecovery codes?\b/i, /\btotp secret\b/i, /\bbase32 secret\b/i, /\bmfa setup\b/i, /\bsetup complete\b/i, /\bqr-?code\b/i, /\bauthenticator-?app\b/i, /\bgeheim(?:nis|schluessel|schlüssel)\b/i, /\beinricht(?:en|ung)\b/i],
  },
  {
    key: 'mfa_verification',
    label: 'MFA verification',
    namePatterns: [/\btotp\b/i, /\botp\b/i, /\bmfa\b/i, /\bverification\b/i, /\bverifizier(?:en|ung)t?\b/i],
    contentPatterns: [/\b6-?digit code\b/i, /\bverification code\b/i, /\btime[- ]based one[- ]time password\b/i, /\bcurrent time[- ]step window\b/i, /\bcurrent time slice\b/i, /\bsubmitted code\b/i, /\btiming[- ]safe comparison\b/i, /\bverification attempt\b/i, /\binvalid code\b/i, /\b6-?stelliger code\b/i, /\bverifizierungscode\b/i, /\bungueltiger code\b/i, /\bungültiger code\b/i, /\bzeitfenster\b/i],
  },
  {
    key: 'adaptive_mfa',
    label: 'adaptive MFA',
    namePatterns: [/\badaptive\b/i, /\brisk[ -]?based\b/i, /\bstep[ -]?up\b/i],
    contentPatterns: [/\brisk score\b/i, /\bdevice fingerprint\b/i, /\bstep[ -]?up\b/i, /\badditional factor\b/i, /\bsuspicious(?: login| activity)?\b/i, /\bcontextual signals?\b/i],
  },
  {
    key: 'passwordless',
    label: 'passwordless authentication',
    namePatterns: [/\bpasswordless\b/i, /\bmagic link\b/i],
    contentPatterns: [/\bmagic link\b/i, /\bpasswordless\b/i, /\bone[- ]time link\b/i, /\bemail sign[ -]?in\b/i, /\blink login\b/i],
  },
  {
    key: 'account_recovery',
    label: 'account recovery',
    namePatterns: [/\baccount recovery\b/i, /\bsecurity questions?\b/i],
    contentPatterns: [/\bsecurity questions?\b/i, /\brecovery answer\b/i, /\bknowledge[- ]based\b/i, /\brecovery flow\b/i, /\brecovery code\b/i],
  },
  {
    key: 'session',
    label: 'session management',
    namePatterns: [/\bsession\b/i, /\bttl\b/i, /\brenewal\b/i, /\bexpiration\b/i, /\bsitzung\b/i],
    contentPatterns: [/\bsession\b/i, /\bcookie\b/i, /\bexpires?_at\b/i, /\brefresh token\b/i, /\btime[- ]to[- ]live\b/i, /\bsession identifier\b/i, /\bsession store\b/i, /\bactive sessions? index\b/i, /\brevok(?:e|ed|ing|ation)\b/i, /\bexpired\b/i, /\bterminate(?:d|s|ion)?\b/i, /\bsamesite\b/i, /\bsitzung\b/i, /\bsitzungsdauer\b/i, /\bablauf(?:zeit)?\b/i],
  },
  {
    key: 'audit',
    label: 'audit logging',
    namePatterns: [/\baudit\b/i, /\blog\b/i, /\bretrieval\b/i, /\bstorage\b/i, /\bprotokoll\b/i],
    contentPatterns: [/\baudit\b/i, /\bchronological\b/i, /\bexport\b/i, /\bfilter\b/i, /\bimmutable\b/i, /\bhash chain\b/i, /\bprotokoll\b/i, /\bchronologisch\b/i, /\bfilterbar\b/i, /\bunveraenderlich\b/i, /\bunveränderlich\b/i],
  },
];

function featureFieldText(feature: FeatureSpec, field: FeatureEnrichableField): string {
  const value = feature[field];
  return Array.isArray(value) ? value.join(' ') : String(value || '');
}

function normalizeFeatureName(name: string): string {
  const spacedName = String(name || '')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return normalizeForMatch(spacedName);
}

function collectPlaceholderFields(feature: FeatureSpec): FeatureEnrichableField[] {
  return FEATURE_ENRICHABLE_FIELDS.filter(field => {
    const text = featureFieldText(feature, field);
    return FEATURE_PLACEHOLDER_PATTERNS.some(pattern => pattern.test(text));
  });
}

function detectNameFamilies(name: string): IntentFamily[] {
  const normalizedName = normalizeFeatureName(name);
  return INTENT_FAMILIES.filter(family => family.namePatterns.some(pattern => pattern.test(normalizedName)));
}

function countFamilyMatches(text: string, family: IntentFamily): number {
  return family.contentPatterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
}

function countFieldHits(feature: FeatureSpec, family: IntentFamily): number {
  return FEATURE_ENRICHABLE_FIELDS.reduce((sum, field) => {
    const text = featureFieldText(feature, field);
    return sum + (family.contentPatterns.some(pattern => pattern.test(text)) ? 1 : 0);
  }, 0);
}

function pickDominantFamily(feature: FeatureSpec, excludedKeys: Set<string>) {
  const content = normalizeForMatch([
    feature.rawContent,
    ...FEATURE_ENRICHABLE_FIELDS.map(field => featureFieldText(feature, field)),
  ].join(' '));

  let dominant: { family: IntentFamily; score: number; fieldHits: number } | null = null;
  for (const family of INTENT_FAMILIES) {
    if (excludedKeys.has(family.key)) continue;
    const score = countFamilyMatches(content, family);
    const fieldHits = countFieldHits(feature, family);
    if (!dominant || fieldHits > dominant.fieldHits || (fieldHits === dominant.fieldHits && score > dominant.score)) {
      dominant = { family, score, fieldHits };
    }
  }

  return dominant;
}

function pickExpectedFamilyScore(feature: FeatureSpec, expectedFamilies: IntentFamily[]) {
  const content = normalizeForMatch([
    feature.rawContent,
    ...FEATURE_ENRICHABLE_FIELDS.map(field => featureFieldText(feature, field)),
  ].join(' '));

  return expectedFamilies.reduce((best, family) => {
    const candidate = {
      family,
      score: countFamilyMatches(content, family),
      fieldHits: countFieldHits(feature, family),
    };
    if (!best || candidate.fieldHits > best.fieldHits || (candidate.fieldHits === best.fieldHits && candidate.score > best.score)) {
      return candidate;
    }
    return best;
  }, null as { family: IntentFamily; score: number; fieldHits: number } | null);
}

export function extractFeatureTargetFields(message: string): FeatureEnrichableField[] {
  const match = message.match(/(?:Missing|Shallow|Rewrite): (.+)$/);
  if (!match) return [];
  const fields = match[1]
    .split(',')
    .map(field => field.trim())
    .filter((field): field is FeatureEnrichableField => FEATURE_ENRICHABLE_FIELDS.includes(field as FeatureEnrichableField));
  return Array.from(new Set(fields));
}

export function isFeatureForceRewriteIssue(code: string): boolean {
  return code === 'feature_semantic_mismatch' || code === 'feature_placeholder_content';
}

export function analyzeFeatureSemanticIssues(features: FeatureSpec[]): FeatureSemanticIssue[] {
  const issues: FeatureSemanticIssue[] = [];

  for (const feature of features || []) {
    const placeholderFields = collectPlaceholderFields(feature);
    if (placeholderFields.length > 0) {
      issues.push({
        code: 'feature_placeholder_content',
        sectionKey: `feature:${feature.id}`,
        message: `Feature "${feature.id}: ${feature.name}" contains unresolved placeholder content. Rewrite: ${placeholderFields.join(', ')}`,
        severity: 'warning',
        suggestedAction: 'enrich',
        targetFields: placeholderFields,
      });
    }

    const expectedFamilies = detectNameFamilies(feature.name);
    if (expectedFamilies.length === 0) continue;

    const expected = pickExpectedFamilyScore(feature, expectedFamilies);
    const dominantForeign = pickDominantFamily(feature, new Set(expectedFamilies.map(family => family.key)));
    if (!expected || !dominantForeign) continue;

    const foreignClearlyDominates = (
      dominantForeign.fieldHits >= 3
      && dominantForeign.score >= 3
      && (dominantForeign.fieldHits >= expected.fieldHits + 2 || dominantForeign.score >= expected.score + 2)
    ) || (
      expected.fieldHits === 0
      && expected.score === 0
      && dominantForeign.fieldHits >= 4
      && dominantForeign.score >= 4
    );

    if (!foreignClearlyDominates) continue;

    issues.push({
      code: 'feature_semantic_mismatch',
      sectionKey: `feature:${feature.id}`,
      message: `Feature "${feature.id}: ${feature.name}" aligns more strongly with ${dominantForeign.family.label} than with the expected intent ${expectedFamilies.map(family => family.label).join(' / ')}. Rewrite: ${FEATURE_ENRICHABLE_FIELDS.join(', ')}`,
      severity: 'warning',
      suggestedAction: 'enrich',
      targetFields: [...FEATURE_ENRICHABLE_FIELDS],
    });
  }

  return issues;
}
