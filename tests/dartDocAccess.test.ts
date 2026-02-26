import { describe, expect, it } from "vitest";
import { isDartDocUpdateConsistent, normalizeDartDocId } from "../server/dartDocAccess";

describe("normalizeDartDocId", () => {
  it("returns trimmed doc id for non-empty strings", () => {
    expect(normalizeDartDocId("  doc-123  ")).toBe("doc-123");
  });

  it("returns null for empty or non-string values", () => {
    expect(normalizeDartDocId("   ")).toBeNull();
    expect(normalizeDartDocId(null)).toBeNull();
    expect(normalizeDartDocId(undefined)).toBeNull();
    expect(normalizeDartDocId(123)).toBeNull();
  });
});

describe("isDartDocUpdateConsistent", () => {
  it("allows update when PRD has no stored doc id", () => {
    expect(isDartDocUpdateConsistent(null, "doc-123")).toBe(true);
  });

  it("allows update when doc id matches existing mapping", () => {
    expect(isDartDocUpdateConsistent("doc-123", " doc-123 ")).toBe(true);
  });

  it("rejects update when doc id does not match existing mapping", () => {
    expect(isDartDocUpdateConsistent("doc-123", "doc-999")).toBe(false);
  });

  it("rejects empty requested doc id", () => {
    expect(isDartDocUpdateConsistent("doc-123", "   ")).toBe(false);
  });
});
