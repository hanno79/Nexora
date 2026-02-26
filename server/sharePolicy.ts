interface ShareLike {
  id: string;
  permission: string;
}

type ShareAction =
  | { type: "create" }
  | { type: "none" }
  | { type: "update"; shareId: string; permission: "view" | "edit" };

export function canShareWithUser(ownerUserId: string, targetUserId: string): boolean {
  return ownerUserId.trim() !== targetUserId.trim();
}

export function planShareAction(
  existingShare: ShareLike | undefined,
  requestedPermission: "view" | "edit",
): ShareAction {
  if (!existingShare) {
    return { type: "create" };
  }

  if (existingShare.permission === requestedPermission) {
    return { type: "none" };
  }

  return {
    type: "update",
    shareId: existingShare.id,
    permission: requestedPermission,
  };
}
