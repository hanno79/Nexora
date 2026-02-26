import { describe, expect, it } from "vitest";
import { canUserAccessTemplate } from "../server/templateAccess";

describe("canUserAccessTemplate", () => {
  it("allows access to default templates", () => {
    expect(
      canUserAccessTemplate({ isDefault: "true", userId: null }, "user-1"),
    ).toBe(true);
  });

  it("allows access to owned custom templates", () => {
    expect(
      canUserAccessTemplate({ isDefault: "false", userId: "user-1" }, "user-1"),
    ).toBe(true);
  });

  it("denies access to non-default templates owned by another user", () => {
    expect(
      canUserAccessTemplate({ isDefault: "false", userId: "owner-1" }, "user-1"),
    ).toBe(false);
  });

  it("denies access when default flag is missing and user does not own", () => {
    expect(
      canUserAccessTemplate({ userId: null }, "user-1"),
    ).toBe(false);
  });
});

