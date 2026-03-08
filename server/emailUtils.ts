/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Hilfsfunktionen zur sicheren Normalisierung optionaler E-Mail-Werte.
*/

// ÄNDERUNG 08.03.2026: Header und Aenderungsdokumentation fuer Phase-0-Paket-2 ergaenzt.

export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== "string") {
    return null;
  }

  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Behaelt undefined fuer partielle Updates/Upserts unveraendert bei,
 * damit bestehende DB-Werte nicht versehentlich ueberschrieben werden.
 */
export function normalizeOptionalEmail(email: unknown): string | null | undefined {
  if (email === undefined) {
    return undefined;
  }
  if (email === null) {
    return null;
  }
  return normalizeEmail(email);
}
