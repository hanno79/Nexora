import type { Response } from "express";
import type { IStorage } from "./storage";
import { canEditWithPermission, canViewWithPermission } from "./sharePermissions";

type PrdPermission = "view" | "edit";

interface AuthenticatedRequestLike {
  user?: {
    claims?: {
      sub?: string;
    };
  };
}

type AccessStorage = Pick<IStorage, "getPrd" | "getPrdShares">;

type PrdIdParseResult =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "valid"; prdId: string };

interface RequireEditablePrdIdOptions {
  required?: boolean;
  requiredMessage?: string;
  invalidMessage?: string;
}

function hasRequiredSharePermission(
  shares: Array<{ sharedWith: string; permission: string }>,
  userId: string,
  requiredPermission: PrdPermission,
): boolean {
  const matchingShares = shares.filter((share) => share.sharedWith === userId);
  if (matchingShares.length === 0) {
    return false;
  }

  if (requiredPermission === "view") {
    return matchingShares.some((share) => canViewWithPermission(share.permission));
  }

  return matchingShares.some((share) => canEditWithPermission(share.permission));
}

function parsePrdIdInput(prdIdInput: unknown): PrdIdParseResult {
  if (prdIdInput === undefined || prdIdInput === null) {
    return { kind: "missing" };
  }

  if (typeof prdIdInput !== "string") {
    return { kind: "invalid" };
  }

  const normalized = prdIdInput.trim();
  if (!normalized) {
    return { kind: "invalid" };
  }

  return { kind: "valid", prdId: normalized };
}

/**
 * Verify the requesting user owns the PRD or has the required share permission.
 * Returns the PRD if authorized, or sends 401/403/404 and returns null.
 */
export async function requirePrdAccess(
  storage: AccessStorage,
  req: AuthenticatedRequestLike,
  res: Response,
  prdId: string,
  requiredPermission: PrdPermission = "view",
) {
  const userId = req.user?.claims?.sub;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }

  const prd = await storage.getPrd(prdId);
  if (!prd) {
    res.status(404).json({ message: "PRD not found" });
    return null;
  }

  if (prd.userId === userId) {
    return prd;
  }

  const shares = await storage.getPrdShares(prdId);
  const hasPermission = hasRequiredSharePermission(shares, userId, requiredPermission);
  if (!hasPermission) {
    res.status(403).json({ message: "You don't have permission to access this PRD" });
    return null;
  }

  return prd;
}

/**
 * Resolves and authorizes a PRD ID for write operations.
 * - Optional mode (`required=false`): missing ID returns null without sending a response.
 * - Required mode (`required=true`): missing/invalid ID sends 400 and returns null.
 */
export async function requireEditablePrdId(
  storage: AccessStorage,
  req: AuthenticatedRequestLike,
  res: Response,
  prdIdInput: unknown,
  options: RequireEditablePrdIdOptions = {},
): Promise<string | null> {
  const parsed = parsePrdIdInput(prdIdInput);
  const required = options.required ?? false;
  const requiredMessage = options.requiredMessage ?? "PRD ID is required";
  const invalidMessage = options.invalidMessage ?? "PRD ID must be a non-empty string";

  if (parsed.kind === "missing") {
    if (required) {
      res.status(400).json({ message: requiredMessage });
    }
    return null;
  }

  if (parsed.kind === "invalid") {
    res.status(400).json({ message: invalidMessage });
    return null;
  }

  const prd = await requirePrdAccess(storage, req, res, parsed.prdId, "edit");
  if (!prd) {
    return null;
  }

  return parsed.prdId;
}
