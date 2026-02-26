import { describe, expect, it, vi } from "vitest";
import { shouldToggleReviewerFromRowClick } from "../client/src/lib/reviewerSelection";

describe("shouldToggleReviewerFromRowClick", () => {
  it("returns false when click target belongs to checkbox subtree", () => {
    const target = {
      closest: vi.fn().mockReturnValue({ role: "checkbox" }),
    };

    expect(shouldToggleReviewerFromRowClick(target as any)).toBe(false);
    expect(target.closest).toHaveBeenCalledWith("[role='checkbox']");
  });

  it("returns true for non-checkbox targets", () => {
    const target = {
      closest: vi.fn().mockReturnValue(null),
    };

    expect(shouldToggleReviewerFromRowClick(target as any)).toBe(true);
  });

  it("returns true when target cannot run closest()", () => {
    expect(shouldToggleReviewerFromRowClick(null)).toBe(true);
    expect(shouldToggleReviewerFromRowClick({} as any)).toBe(true);
  });
});
