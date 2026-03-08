/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Normalisierung und Pruefung von Share-Berechtigungen.
*/

// ÄNDERUNG 08.03.2026: Header und Aenderungsdokumentation fuer Phase-0-Quick-Wins ergaenzt.

export type NormalizedSharePermission = "view" | "edit";

export function normalizeSharePermission(permission: unknown): NormalizedSharePermission | null {
  if (typeof permission !== "string") {
    return null;
  }

  const normalized = permission.trim().toLowerCase();
  if (normalized === "view" || normalized === "edit") {
    return normalized;
  }

  return null;
}

export function canViewWithPermission(permission: unknown): boolean {
  return normalizeSharePermission(permission) !== null;
}

export function canEditWithPermission(permission: unknown): boolean {
  return normalizeSharePermission(permission) === "edit";
}
