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
