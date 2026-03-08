/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Gemeinsame Typen fuer PRD-Section-Updates aus JSON-basierten Regeneratoren.
*/

// ÄNDERUNG 08.03.2026: Header und Aenderungsdokumentation fuer Phase-0-Quick-Wins ergaenzt.

import type { PRDStructure } from './prdStructure';

export interface SectionUpdateResult {
  sectionName: keyof PRDStructure;
  updatedContent: string;
}
