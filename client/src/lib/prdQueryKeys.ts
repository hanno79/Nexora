/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Zentrale Query-Keys fuer PRD-Listen, Details und Versionsabfragen.
*/

// ÄNDERUNG 08.03.2026: Header und Aenderungsdokumentation fuer Phase-0-Quick-Wins ergaenzt.

export const PRDS_LIST_QUERY_KEY = ["/api/prds"] as const;

export function getPrdDetailQueryKey(prdId: string | undefined) {
  return ["/api/prds", prdId] as const;
}

export function getPrdVersionsQueryKey(prdId: string | undefined) {
  return ["/api/prds", prdId, "versions"] as const;
}
