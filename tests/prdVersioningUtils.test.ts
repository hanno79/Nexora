import { describe, expect, it } from "vitest";
import {
  buildPrdVersionSnapshot,
  getNextPrdVersionNumber,
} from "../server/prdVersioningUtils";

describe("getNextPrdVersionNumber", () => {
  it("returns v1 for zero versions", () => {
    expect(getNextPrdVersionNumber(0)).toBe("v1");
  });

  it("increments numeric version count", () => {
    expect(getNextPrdVersionNumber(7)).toBe("v8");
  });

  it("guards invalid counts", () => {
    expect(getNextPrdVersionNumber(-1)).toBe("v1");
    expect(getNextPrdVersionNumber(Number.NaN)).toBe("v1");
  });
});

describe("buildPrdVersionSnapshot", () => {
  it("includes all restore-relevant fields from PRD", () => {
    const snapshot = buildPrdVersionSnapshot(
      {
        id: "prd-1",
        title: "My PRD",
        description: "Desc",
        content: "# Content",
        status: "approved",
        structuredContent: { features: [{ id: "f1" }] },
      },
      "v5",
      "user-1",
    );

    expect(snapshot).toEqual({
      prdId: "prd-1",
      versionNumber: "v5",
      title: "My PRD",
      description: "Desc",
      content: "# Content",
      structuredContent: { features: [{ id: "f1" }] },
      status: "approved",
      createdBy: "user-1",
    });
  });

  it("normalizes missing optional fields to null where needed", () => {
    const snapshot = buildPrdVersionSnapshot(
      {
        id: "prd-2",
        title: "Untitled",
        description: null,
        content: "# Content",
        status: "draft",
      },
      "v1",
      "user-2",
    );

    expect(snapshot.description).toBeNull();
    expect((snapshot as any).structuredContent).toBeNull();
  });
});
