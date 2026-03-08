/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Hilfslogik fuer Klickverhalten in der Reviewer-Auswahlliste.
*/

// ÄNDERUNG 08.03.2026: Header und Aenderungsdokumentation fuer Phase-0-Paket-2 ergaenzt.

type ClosestCapable = {
  closest?: (selector: string) => unknown;
};

/**
 * Ein Row-Klick soll den Reviewer nur dann toggeln, wenn der Klick nicht
 * direkt aus der Checkbox selbst oder ihren Kind-Elementen stammt.
 */
export function shouldToggleReviewerFromRowClick(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") {
    return true;
  }

  const closest = (target as ClosestCapable).closest;
  if (typeof closest !== "function") {
    return true;
  }

  return closest("[role='checkbox']") == null;
}
