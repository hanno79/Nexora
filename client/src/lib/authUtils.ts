/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Hilfsfunktion zur Erkennung nicht autorisierter API-Fehler.
*/

// ÄNDERUNG 08.03.2026: Header und Aenderungsdokumentation fuer Phase-0-Paket-2 ergaenzt.

export function isUnauthorizedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const status = (error as { status?: unknown }).status;
  if (status === 401) {
    return true;
  }

  const message = (error as { message?: unknown }).message;
  const normalizedMessage = typeof message === "string" ? message.trim().toLowerCase() : "";
  if (normalizedMessage === "unauthorized") {
    return true;
  }

  return normalizedMessage.startsWith("401:");
}
