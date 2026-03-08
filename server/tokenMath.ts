/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Kleine Hilfsfunktionen fuer sichere Token-Zahl-Berechnungen.
*/

// ÄNDERUNG 08.03.2026: Header und Aenderungsdokumentation fuer Phase-0-Quick-Wins ergaenzt.

export function normalizeTokenCount(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  return Math.round(value);
}

export function splitTokenCount(total: number | null | undefined): {
  first: number;
  second: number;
} {
  const normalized = normalizeTokenCount(total);
  const first = Math.floor(normalized / 2);
  const second = normalized - first;
  return { first, second };
}
