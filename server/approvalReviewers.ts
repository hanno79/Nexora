import { collectCollaboratorIds } from "./collaborators";
import { canViewWithPermission } from "./sharePermissions";

interface ShareLike {
  sharedWith: string;
  permission: string;
}

interface ApprovalReviewerValidationResult {
  normalizedReviewerIds: string[];
  unauthorizedReviewerIds: string[];
}

export function normalizeReviewerIds(reviewerIds: string[]): string[] {
  const normalized = new Set<string>();

  for (const reviewerId of reviewerIds) {
    if (typeof reviewerId !== "string") continue;
    const trimmed = reviewerId.trim();
    if (!trimmed) continue;
    normalized.add(trimmed);
  }

  return Array.from(normalized);
}

/**
 * Reviewers for an approval request must already be collaborators (owner or shared users).
 */
export function validateApprovalReviewers(
  reviewerIds: string[],
  ownerUserId: string,
  shares: ShareLike[],
): ApprovalReviewerValidationResult {
  const normalizedReviewerIds = normalizeReviewerIds(reviewerIds);
  const viewableShares = shares.filter((share) => canViewWithPermission(share.permission));
  const allowedReviewerIds = new Set(collectCollaboratorIds(ownerUserId, viewableShares));

  const unauthorizedReviewerIds = normalizedReviewerIds.filter((reviewerId) => !allowedReviewerIds.has(reviewerId));

  return {
    normalizedReviewerIds,
    unauthorizedReviewerIds,
  };
}
