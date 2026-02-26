type ShareLike = {
  sharedWith: string;
};

export interface CollaboratorUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  profileImageUrl: string | null;
}

export function collectCollaboratorIds(ownerUserId: string, shares: ShareLike[]): string[] {
  const collaboratorIds = new Set<string>();

  if (ownerUserId.trim()) {
    collaboratorIds.add(ownerUserId);
  }

  for (const share of shares) {
    const sharedWith = typeof share.sharedWith === "string" ? share.sharedWith.trim() : "";
    if (sharedWith) {
      collaboratorIds.add(sharedWith);
    }
  }

  return Array.from(collaboratorIds);
}

export function mapCollaboratorUsers(
  collaboratorIds: string[],
  usersById: Map<string, CollaboratorUser>,
): CollaboratorUser[] {
  const result: CollaboratorUser[] = [];
  for (const userId of collaboratorIds) {
    const user = usersById.get(userId);
    if (user) {
      result.push(user);
    }
  }
  return result;
}
