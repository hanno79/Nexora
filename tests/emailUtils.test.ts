import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizeOptionalEmail } from "../server/emailUtils";

describe("normalizeEmail", () => {
  it("trims and lowercases email addresses", () => {
    expect(normalizeEmail("  USER+Tag@Example.COM  ")).toBe("user+tag@example.com");
  });

  it("returns null for empty or non-string inputs", () => {
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail(123)).toBeNull();
  });
});

describe("normalizeOptionalEmail", () => {
  it("preserves undefined for partial updates", () => {
    expect(normalizeOptionalEmail(undefined)).toBeUndefined();
  });

  it("normalizes values otherwise", () => {
    expect(normalizeOptionalEmail(" USER@EXAMPLE.COM ")).toBe("user@example.com");
    expect(normalizeOptionalEmail(null)).toBeNull();
  });
});
