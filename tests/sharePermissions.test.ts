import { describe, expect, it } from "vitest";
import {
  canEditWithPermission,
  canViewWithPermission,
  normalizeSharePermission,
} from "../server/sharePermissions";

describe("normalizeSharePermission", () => {
  it("normalizes valid permission values", () => {
    expect(normalizeSharePermission("view")).toBe("view");
    expect(normalizeSharePermission(" Edit ")).toBe("edit");
  });

  it("returns null for unsupported values", () => {
    expect(normalizeSharePermission("owner")).toBeNull();
    expect(normalizeSharePermission("")).toBeNull();
    expect(normalizeSharePermission(null)).toBeNull();
  });
});

describe("permission guards", () => {
  it("allows view for valid share permissions", () => {
    expect(canViewWithPermission("view")).toBe(true);
    expect(canViewWithPermission("edit")).toBe(true);
  });

  it("allows edit only for edit permission", () => {
    expect(canEditWithPermission("edit")).toBe(true);
    expect(canEditWithPermission("view")).toBe(false);
    expect(canEditWithPermission("owner")).toBe(false);
  });
});
