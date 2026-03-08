/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Interne Normalisierungs- und Parse-Helfer fuer den PRD-Compiler.
*/

// ÄNDERUNG 08.03.2026: Normalisierungs-/Parse-Helfer aus `server/prdCompiler.ts` als dritter risikoarmer Phase-2-Minimalsplit extrahiert.

import { parsePRDToStructure } from './prdParser';
import type { PRDStructure } from './prdStructure';
import { cloneStructure, hasText } from './prdTextUtils';

type SupportedLanguage = 'de' | 'en';

export function detectLanguage(
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

export function safeParseStructure(content: string): PRDStructure {
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

export function collectUnknownSectionHeadings(structure: PRDStructure): string[] {
  const unknownEntries = Object.entries(structure.otherSections || {})
    .filter(([heading, body]) => String(heading || '').trim().length > 0 && hasText(body))
    .map(([heading]) => String(heading).trim());

  return Array.from(new Set(unknownEntries));
}

export function normalizeStructureForCompiler(
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