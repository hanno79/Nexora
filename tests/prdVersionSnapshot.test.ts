import { describe, expect, it } from "vitest";
import { shouldCreatePrdVersionSnapshot } from "../server/prdVersioning";

const basePrd = {
  title: "Initial title",
  description: "Initial description",
  content: "# Initial content",
  structuredContent: {
    goals: ["Ship MVP"],
    features: [{ id: "feature-1", title: "Login" }],
  },
};

describe("shouldCreatePrdVersionSnapshot", () => {
  it("returns false for metadata-only updates", () => {
    expect(
      shouldCreatePrdVersionSnapshot(basePrd as any, {
        linearIssueId: "LINEAR-123",
        linearIssueUrl: "https://linear.app/issue/123",
      } as any),
    ).toBe(false);
  });

  it("returns false for status-only updates", () => {
    expect(
      shouldCreatePrdVersionSnapshot(basePrd as any, {
        status: "approved",
      } as any),
    ).toBe(false);
  });

  it("returns false when tracked fields are unchanged", () => {
    expect(
      shouldCreatePrdVersionSnapshot(basePrd as any, {
        content: "# Initial content",
      } as any),
    ).toBe(false);
  });

  it("returns true when title changes", () => {
    expect(
      shouldCreatePrdVersionSnapshot(basePrd as any, {
        title: "Updated title",
      } as any),
    ).toBe(true);
  });

  it("returns true when description changes", () => {
    expect(
      shouldCreatePrdVersionSnapshot(basePrd as any, {
        description: "Updated description",
      } as any),
    ).toBe(true);
  });

  it("returns true when content changes", () => {
    expect(
      shouldCreatePrdVersionSnapshot(basePrd as any, {
        content: "# Updated content",
      } as any),
    ).toBe(true);
  });

  it("does not snapshot when structuredContent is deeply equal", () => {
    expect(
      shouldCreatePrdVersionSnapshot(basePrd as any, {
        structuredContent: {
          goals: ["Ship MVP"],
          features: [{ id: "feature-1", title: "Login" }],
        },
      } as any),
    ).toBe(false);
  });

  it("snapshots when structuredContent changes", () => {
    expect(
      shouldCreatePrdVersionSnapshot(basePrd as any, {
        structuredContent: {
          goals: ["Ship MVP", "Increase retention"],
          features: [{ id: "feature-1", title: "Login" }],
        },
      } as any),
    ).toBe(true);
  });
});
