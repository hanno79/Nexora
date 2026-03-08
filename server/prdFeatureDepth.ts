/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Hilfsfunktionen fuer Feature-Depth, Hint-Extraktion und strukturierte Feature-Felder im PRD-Compiler.
*/

// ÄNDERUNG 08.03.2026: Feature-Depth- und Hint-Logik aus `server/prdCompiler.ts` als risikoarmen Phase-2-Minimalsplit extrahiert.

import { hasText } from './prdTextUtils';
import type { PRDStructure, FeatureSpec } from './prdStructure';
import { parseFeatureSubsections } from './prdFeatureParser';

type SupportedLanguage = 'de' | 'en';

const STRUCTURED_FEATURE_LABEL_PATTERN = /^(?:\*{0,2})?(?:purpose|zweck|ziel|nutzen|actors|akteure|beteiligte|rollen|trigger|ausloeser|ausloser|preconditions|vorbedingungen|voraussetzungen|main\s+flow|hauptablauf|hauptfluss|ablauf|alternate\s+flows|alternative\s+ablaeufe|alternativablaeufe|alternative\s+flows|ausnahmefaelle|postconditions|nachbedingungen|ergebniszustand|data\s+impact|datenauswirkungen|datenwirkungen|datenwirkung|ui\s+impact|ui-auswirkungen|benutzeroberflaechen-auswirkungen|oberflaechen-auswirkungen|acceptance\s+criteria|akzeptanzkriterien|abnahmekriterien)(?:\*{0,2})?\s*:/i;

export const FEATURE_STRUCTURED_FIELDS: Array<keyof FeatureSpec> = [
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

function hasStructuredFeatureValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return hasText(value);
}

function sanitizeExtractedText(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^\*+|\*+$/g, '')
    .replace(/^[-*•]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isStructuredOutlineItem(value: string): boolean {
  const sanitized = sanitizeExtractedText(value);
  if (!sanitized) return false;
  return STRUCTURED_FEATURE_LABEL_PATTERN.test(sanitized);
}

function sanitizeExtractedList(
  values: unknown,
  options?: { rejectOutlineItems?: boolean }
): string[] {
  const entries = Array.isArray(values) ? values : [];
  return entries
    .map(entry => sanitizeExtractedText(entry))
    .filter(entry => entry.length >= 8)
    .filter(entry => !(options?.rejectOutlineItems && isStructuredOutlineItem(entry)));
}

function getParsedFieldValue(
  parsed: Partial<Pick<FeatureSpec, 'purpose' | 'actors' | 'trigger' | 'preconditions' | 'mainFlow' | 'alternateFlows' | 'postconditions' | 'dataImpact' | 'uiImpact' | 'acceptanceCriteria'>>,
  field: keyof FeatureSpec
): string | string[] | undefined {
  const value = parsed[field as keyof typeof parsed];
  if (Array.isArray(value)) {
    const rejectOutlineItems = field === 'mainFlow' || field === 'alternateFlows' || field === 'acceptanceCriteria';
    const sanitized = sanitizeExtractedList(value, { rejectOutlineItems });
    return sanitized.length > 0 ? sanitized : undefined;
  }

  const sanitized = sanitizeExtractedText(value);
  return sanitized || undefined;
}

function extractLabeledSection(rawContent: string, labelPattern: RegExp): string | undefined {
  const lines = rawContent.split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].replace(/^\*+|\*+$/g, '').trim();
    if (/^#{2,}\s*F-\d+/i.test(lines[idx].trim()) || /^#{2,}\s+\w/.test(lines[idx].trim())) continue;
    if (!labelPattern.test(line)) continue;

    const content: string[] = [];
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
  const parsed = parseFeatureSubsections(rawContent);

  // Fuer Rollen- und Trigger-Heuristiken nur den Freitext vor dem ersten
  // strukturierten Unterabschnitt verwenden, damit Compile-Parse-Compile-Laeufe
  // stabil bleiben und vorhandenes Scaffold nicht erneut als Hint zaehlt.
  const firstStructuredMarker = rawContent.search(/\*\*\d{1,2}\.\s+/);
  const proseSource = firstStructuredMarker > 0
    ? rawContent.substring(0, firstStructuredMarker).trim()
    : rawContent;

  const lines = rawContent
    .split('\n')
    .map(l => l.replace(/^#+\s*/, '').replace(/^\*+/, '').trim())
    .filter(Boolean);

  let purposeHint: string | undefined;
  const parsedPurpose = getParsedFieldValue(parsed, 'purpose');
  if (typeof parsedPurpose === 'string' && parsedPurpose.length >= 15) {
    purposeHint = parsedPurpose.endsWith('.') ? parsedPurpose : `${parsedPurpose}.`;
  } else {
    for (const line of lines) {
      if (/^F-\d+/i.test(line)) continue;
      if (line.length < 15) continue;
      if (/^\d+\.\s/.test(line)) continue;
      purposeHint = line.endsWith('.') ? line : `${line}.`;
      break;
    }
  }

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

  const parsedTrigger = getParsedFieldValue(parsed, 'trigger');
  const triggerMatch = typeof parsedTrigger === 'string'
    ? null
    : proseSource.match(
      /\b(?:clicks?|taps?|navigates?|submits?|opens?|selects?|starts?|initiates?|klickt|navigiert|startet|oeffnet|waehlt)\s+[^.\n]{5,60}/i
    );
  const triggerHint = typeof parsedTrigger === 'string'
    ? parsedTrigger
    : triggerMatch ? triggerMatch[0].trim() : undefined;

  const parsedMainFlow = getParsedFieldValue(parsed, 'mainFlow');
  const numberedSteps = rawContent
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^\d+\.\s+/.test(l))
    .map(l => l.replace(/^\d+\.\s+/, '').trim())
    .map(step => sanitizeExtractedText(step))
    .filter(step => step.length >= 10)
    .filter(step => !isStructuredOutlineItem(step));
  const mainFlowHint = Array.isArray(parsedMainFlow) && parsedMainFlow.length >= 2
    ? parsedMainFlow
    : numberedSteps.length >= 2
      ? numberedSteps
      : undefined;

  const parsedPreconditions = getParsedFieldValue(parsed, 'preconditions');
  const preconditionsHint = typeof parsedPreconditions === 'string'
    ? parsedPreconditions
    : extractLabeledSection(rawContent, /(?:preconditions?|vorbedingungen?|voraussetzungen?)/i);
  const parsedPostconditions = getParsedFieldValue(parsed, 'postconditions');
  const postconditionsHint = typeof parsedPostconditions === 'string'
    ? parsedPostconditions
    : extractLabeledSection(rawContent, /(?:postconditions?|nachbedingungen?|ergebnis(?:se)?)/i);
  const parsedDataImpact = getParsedFieldValue(parsed, 'dataImpact');
  const dataImpactHint = typeof parsedDataImpact === 'string'
    ? parsedDataImpact
    : extractLabeledSection(rawContent, /(?:data\s*impact|daten(?:bank)?|speicher|storage|database|persist)/i);
  const parsedUiImpact = getParsedFieldValue(parsed, 'uiImpact');
  const uiImpactHint = typeof parsedUiImpact === 'string'
    ? parsedUiImpact
    : extractLabeledSection(rawContent, /(?:ui\s*impact|oberfl[aä]che|anzeige|display|screen|component)/i);

  return { purposeHint, actorHint, triggerHint, mainFlowHint, preconditionsHint, postconditionsHint, dataImpactHint, uiImpactHint };
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
    const parsedFields = parseFeatureSubsections(feature.rawContent || '');
    let changed = false;

    for (const field of FEATURE_STRUCTURED_FIELDS) {
      const currentValue = (feature as any)[field];
      if (hasStructuredFeatureValue(currentValue)) continue;

      const safeName = feature.name || feature.id;
      const parsedValue = getParsedFieldValue(parsedFields, field);
      if (parsedValue !== undefined) {
        (feature as any)[field] = parsedValue;
      } else if (field === 'purpose' && hints.purposeHint) {
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

      if ((feature as any)[field] !== currentValue) changed = true;
    }

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
          ? [
            `${safeName} kann mit gültigen Eingaben erfolgreich ausgeführt werden.`,
            `Ungültige Eingaben oder Ausführungsfehler bei ${safeName} erzeugen verständliches Feedback ohne inkonsistenten Zustand.`,
          ]
          : [
            `${safeName} completes successfully with valid input.`,
            `Invalid input or execution failures in ${safeName} produce clear feedback without leaving inconsistent state.`,
          ];
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
