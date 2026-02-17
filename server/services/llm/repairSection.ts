/**
 * Author: rahn
 * Datum: 15.02.2026
 * Version: 1.1
 * Beschreibung: Deterministische Sektions-Reparatur fuer Feature-Spezifikationen.
 *   Erzwingt die 10-Sektionen-Struktur ohne Inhaltsaenderungen.
 *   Fehlende Header werden mit Platzhalter eingefuegt.
 *   Reihenfolge wird korrigiert.
 *   Kein Inhalt wird umgeschrieben, gekuerzt oder erweitert.
 */

import type { OpenRouterClient } from '../../openrouter';

// Die 10 kanonischen Sektionen in exakter Reihenfolge
const REQUIRED_SECTIONS: { num: number; title: string }[] = [
  { num: 1, title: 'Purpose' },
  { num: 2, title: 'Actors' },
  { num: 3, title: 'Trigger' },
  { num: 4, title: 'Preconditions' },
  { num: 5, title: 'Main Flow' },
  { num: 6, title: 'Alternate Flows' },
  { num: 7, title: 'Postconditions' },
  { num: 8, title: 'Data Impact' },
  { num: 9, title: 'UI Impact' },
  { num: 10, title: 'Acceptance Criteria' },
];

const STRUCTURE_PLACEHOLDER = '(STRUCTURE PLACEHOLDER \u2013 TO BE FILLED BY SECTION REPAIR)';

/**
 * Extrahiert alle erkannten Sektionsblöcke aus dem Feature-Rohinhalt.
 * Gibt eine Map von Sektionsnummer -> Body-Inhalt zurueck.
 */
function extractAllSections(rawContent: string): Map<number, { headerLine: string; body: string }> {
  const sections = new Map<number, { headerLine: string; body: string }>();

  // Alle Sektions-Header finden
  const headerRegex = /^(?:###\s*)?(?:\*\*)?\s*(\d+)\.\s*(Purpose|Actors|Trigger|Preconditions|Main Flow|Alternate Flows|Postconditions|Data Impact|UI Impact|Acceptance Criteria)/gm;

  const matches: { num: number; title: string; index: number; matchLength: number; lineEnd: number }[] = [];

  let match: RegExpExecArray | null;
  while ((match = headerRegex.exec(rawContent)) !== null) {
    const num = Number(match[1]);
    const title = match[2];
    const matchEnd = match.index + match[0].length;
    const lineEnd = rawContent.indexOf('\n', matchEnd);
    const headerLineEnd = lineEnd === -1 ? rawContent.length : lineEnd;

    // Nur gueltige Nummern akzeptieren (1-10)
    const expected = REQUIRED_SECTIONS.find(s => s.num === num);
    if (expected && expected.title === title) {
      matches.push({
        num,
        title,
        index: match.index,
        matchLength: match[0].length,
        lineEnd: headerLineEnd,
      });
    }
  }

  // Body-Inhalt fuer jede Sektion extrahieren
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const headerLine = rawContent.slice(m.index, m.lineEnd).replace(/^\n/, '');
    const bodyStart = m.lineEnd + 1;
    const bodyEnd = (i + 1 < matches.length) ? matches[i + 1].index : rawContent.length;
    const body = rawContent.slice(bodyStart, bodyEnd).trim();

    // Bei Duplikaten: Inhalt an erste Vorkommen anhaengen
    if (sections.has(m.num)) {
      const existing = sections.get(m.num)!;
      existing.body = existing.body + '\n' + body;
    } else {
      sections.set(m.num, { headerLine, body });
    }
  }

  return sections;
}

/**
 * Erzwingt die 10-Sektionen-Struktur deterministisch (OHNE LLM).
 * 
 * Regeln:
 * - Fehlende Sektions-Header werden mit Platzhalter eingefuegt
 * - Falsche Nummerierung wird korrigiert
 * - Reihenfolge wird erzwungen
 * - Kein Inhalt wird veraendert
 * - Duplikate werden zusammengefuehrt
 */
export function enforceStructure(rawContent: string): string {
  const existingSections = extractAllSections(rawContent);
  const outputParts: string[] = [];

  // Text vor der ersten Sektion beibehalten (z.B. Feature-Header)
  let preamble = '';
  const firstSectionMatch = rawContent.match(/^(?:###\s*)?(?:\*\*)?\s*\d+\.\s*(?:Purpose|Actors|Trigger|Preconditions|Main Flow|Alternate Flows|Postconditions|Data Impact|UI Impact|Acceptance Criteria)/m);
  if (firstSectionMatch && firstSectionMatch.index !== undefined && firstSectionMatch.index > 0) {
    preamble = rawContent.slice(0, firstSectionMatch.index).trim();
  }

  if (preamble) {
    outputParts.push(preamble);
    outputParts.push('');
  }

  // Alle 10 Sektionen in korrekter Reihenfolge ausgeben
  for (const section of REQUIRED_SECTIONS) {
    const existing = existingSections.get(section.num);

    if (existing) {
      // Sektion existiert - Header korrigieren falls noetig, Body beibehalten
      outputParts.push(section.num + '. ' + section.title);
      if (existing.body) {
        outputParts.push(existing.body);
      }
    } else {
      // Sektion fehlt - Header mit Platzhalter einfuegen
      outputParts.push(section.num + '. ' + section.title);
      outputParts.push(STRUCTURE_PLACEHOLDER);
    }

    outputParts.push('');
  }

  return outputParts.join('\n').trim();
}

/**
 * Ermittelt ungueltige Sektionen aus dem Validierungsergebnis.
 */
export function detectInvalidSections(validation: {
  missingSections: string[];
  missingMainFlowNumbering: boolean;
  missingAcceptanceCriteriaContent: boolean;
}): string[] {
  const invalidSections: string[] = [];

  // Fehlende Sektionen (z.B. "5. Main Flow" -> "Main Flow")
  for (const section of validation.missingSections) {
    const name = section.replace(/^\d+\.\s*/, '');
    invalidSections.push(name);
  }

  // Main Flow Nummerierung fehlt
  if (validation.missingMainFlowNumbering && !invalidSections.includes('Main Flow')) {
    invalidSections.push('Main Flow');
  }

  // Acceptance Criteria Inhalt fehlt
  if (validation.missingAcceptanceCriteriaContent && !invalidSections.includes('Acceptance Criteria')) {
    invalidSections.push('Acceptance Criteria');
  }

  return invalidSections;
}

// Strikter Struktur-Enforcement-Prompt fuer LLM-basierte Reparatur
const STRICT_STRUCTURE_PROMPT = `You are operating in STRICT STRUCTURE ENFORCEMENT MODE.

You are NOT allowed to:
- Rewrite existing content
- Improve wording
- Shorten content
- Expand content
- Remove content
- Reinterpret meaning
- Add creative material

You are ONLY allowed to:
- Ensure that every feature strictly contains the required section structure
- Inject missing section headers if absent
- Preserve all existing content exactly as written

TARGET STRUCTURE (MANDATORY ORDER):

Each feature MUST contain EXACTLY these 10 sections in this exact order:

1. Purpose
2. Actors
3. Trigger
4. Preconditions
5. Main Flow
6. Alternate Flows
7. Postconditions
8. Data Impact
9. UI Impact
10. Acceptance Criteria

RULES:

1. If a required section header is missing:
   - Insert the missing section header in the correct numerical position.
   - Insert this exact placeholder content below it:
     (STRUCTURE PLACEHOLDER \u2013 TO BE FILLED BY SECTION REPAIR)

2. If the section header exists but is not correctly numbered:
   - Correct only the numbering.
   - Do NOT alter content.

3. If sections are in wrong order:
   - Reorder sections without modifying any content inside them.

4. If duplicated section headers exist:
   - Keep the first occurrence.
   - Append duplicated content to the correct section body.
   - Remove duplicate headers.

5. DO NOT modify any existing text within section bodies.
6. DO NOT summarize.
7. DO NOT remove content even if malformed.
8. Do NOT regenerate full feature text.
9. Do NOT add new information beyond placeholders.
10. Output the FULL feature text after restructuring.

Return ONLY the fully restructured feature.
Do NOT include explanations or commentary.`;

/**
 * Repariert ein Feature ueber LLM mit striktem Struktur-Enforcement.
 * Wird nur aufgerufen wenn die lokale enforceStructure() nicht ausreicht.
 */
export async function repairFeatureViaLLM(
  featureId: string,
  rawContent: string,
  client: OpenRouterClient
): Promise<string> {
  console.log('  \u{1F6E0} LLM-Struktur-Reparatur fuer ' + featureId);

  try {
    const result = await client.callWithFallback(
      'reviewer',
      STRICT_STRUCTURE_PROMPT,
      'INPUT FEATURE:\n\n' + rawContent,
      3000
    );

    return result.content.trim();
  } catch (error: any) {
    console.error('  \u274C LLM-Reparatur fehlgeschlagen fuer ' + featureId + ': ' + error.message);
    // Bei Fehler: Lokal reparierte Version zurueckgeben
    return enforceStructure(rawContent);
  }
}

/**
 * Hauptfunktion: Repariert alle ungueltigen Sektionen eines Features.
 * 
 * Ablauf:
 * 1. Lokale Struktur-Erzwingung (deterministisch, ohne LLM)
 * 2. Falls noetig: LLM-basierte Reparatur fuer Formatierungsprobleme
 * 3. Gibt reparierten rawContent zurueck
 */
export async function repairFeatureSections(
  featureId: string,
  rawContent: string,
  invalidSections: string[],
  client: OpenRouterClient
): Promise<{ repairedContent: string; repairedSections: string[]; failedSections: string[] }> {
  const repairedSections: string[] = [];
  const failedSections: string[] = [];

  // SCHRITT 1: Lokale Struktur-Erzwingung (fehlende Header, Reihenfolge)
  console.log('  \u{1F6E0} Lokale Struktur-Erzwingung fuer ' + featureId);
  let repairedContent = enforceStructure(rawContent);

  // Pruefen welche Sektionen durch lokale Reparatur behoben wurden
  const structuralIssues = invalidSections.filter(s => {
    // Pruefen ob die Sektion jetzt im reparierten Inhalt vorhanden ist
    const num = REQUIRED_SECTIONS.find(r => r.title === s)?.num;
    if (!num) return true;
    const pattern = new RegExp('^' + num + '\\.\\s*' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'm');
    return !pattern.test(repairedContent);
  });

  // Formatierungsprobleme (z.B. Main Flow ohne Nummerierung) benoetigen LLM
  const formatIssues = invalidSections.filter(s =>
    s === 'Main Flow' || s === 'Acceptance Criteria'
  );

  // Pruefen ob LLM-Reparatur noetig ist
  const needsLLM = structuralIssues.length > 0 || formatIssues.some(s => {
    if (s === 'Main Flow') {
      // Pruefen ob Main Flow nummerierte Schritte hat
      const mainFlowMatch = repairedContent.match(/5\.\s*Main Flow[\s\S]*?(?=\d+\.\s*(?:Alternate|Postconditions|Data|UI|Acceptance)|$)/);
      if (mainFlowMatch) {
        const hasNumbering = /(?:^|\n)\s*1\.\s/.test(mainFlowMatch[0]);
        return !hasNumbering;
      }
    }
    return false;
  });

  if (needsLLM) {
    // SCHRITT 2: LLM-basierte Reparatur fuer Formatierungsprobleme
    repairedContent = await repairFeatureViaLLM(featureId, repairedContent, client);
  }

  // Ergebnis zusammenstellen
  for (const section of invalidSections) {
    const num = REQUIRED_SECTIONS.find(r => r.title === section)?.num;
    if (!num) {
      failedSections.push(section);
      continue;
    }
    const pattern = new RegExp('^' + num + '\\.\\s*' + section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'm');
    if (pattern.test(repairedContent)) {
      repairedSections.push(section);
      console.log('  \u2705 Sektions-Reparatur abgeschlossen: ' + section);
    } else {
      failedSections.push(section);
      console.warn('  \u26A0\uFE0F Sektion konnte nicht repariert werden: ' + section);
    }
  }

  return { repairedContent, repairedSections, failedSections };
}
