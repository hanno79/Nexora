import { describe, expect, it } from "vitest";
import { canShareWithUser, planShareAction } from "../server/sharePolicy";

describe("canShareWithUser", () => {
  it("rejects sharing with self", () => {
    expect(canShareWithUser("user-1", "user-1")).toBe(false);
  });

  it("allows sharing with another user", () => {
    expect(canShareWithUser("user-1", "user-2")).toBe(true);
  });
});

describe("planShareAction", () => {
  it("creates a new share when no share exists", () => {
    expect(planShareAction(undefined, "view")).toEqual({ type: "create" });
  });

  it("returns none when permission is unchanged", () => {
    expect(
      planShareAction({ id: "share-1", permission: "view" }, "view"),
    ).toEqual({ type: "none" });
  });

  it("returns update when permission changes", () => {
    expect(
      planShareAction({ id: "share-1", permission: "view" }, "edit"),
    ).toEqual({
      type: "update",
      shareId: "share-1",
      permission: "edit",
    });
  });
});
