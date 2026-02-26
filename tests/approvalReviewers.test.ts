import { describe, expect, it } from "vitest";
import {
  normalizeReviewerIds,
  validateApprovalReviewers,
} from "../server/approvalReviewers";

describe("normalizeReviewerIds", () => {
  it("trims, deduplicates, and removes empty IDs", () => {
    const normalized = normalizeReviewerIds([
      " user-1 ",
      "user-2",
      "user-1",
      "   ",
      "",
    ]);

    expect(normalized).toEqual(["user-1", "user-2"]);
  });
});

describe("validateApprovalReviewers", () => {
  it("accepts owner and shared collaborators", () => {
    const result = validateApprovalReviewers(
      ["owner-1", "editor-1", "viewer-1"],
      "owner-1",
      [
        { sharedWith: "editor-1", permission: "edit" },
        { sharedWith: "viewer-1", permission: "view" },
      ],
    );

    expect(result.normalizedReviewerIds).toEqual(["owner-1", "editor-1", "viewer-1"]);
    expect(result.unauthorizedReviewerIds).toEqual([]);
  });

  it("returns unauthorized reviewer IDs for non-collaborators", () => {
    const result = validateApprovalReviewers(
      ["editor-1", "outsider-1", "outsider-2"],
      "owner-1",
      [{ sharedWith: "editor-1", permission: "edit" }],
    );

    expect(result.normalizedReviewerIds).toEqual(["editor-1", "outsider-1", "outsider-2"]);
    expect(result.unauthorizedReviewerIds).toEqual(["outsider-1", "outsider-2"]);
  });

  it("treats shares with invalid permission values as unauthorized", () => {
    const result = validateApprovalReviewers(
      ["editor-1"],
      "owner-1",
      [{ sharedWith: "editor-1", permission: "owner" }],
    );

    expect(result.unauthorizedReviewerIds).toEqual(["editor-1"]);
  });
});
