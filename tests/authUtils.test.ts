import { describe, expect, it } from "vitest";
import { isUnauthorizedError } from "../client/src/lib/authUtils";

describe("isUnauthorizedError", () => {
  it("detects 401 via status property", () => {
    const error = new Error("Access denied") as Error & { status?: number };
    error.status = 401;

    expect(isUnauthorizedError(error)).toBe(true);
  });

  it("detects plain unauthorized message", () => {
    expect(isUnauthorizedError(new Error("Unauthorized"))).toBe(true);
  });

  it("detects legacy prefixed message", () => {
    expect(isUnauthorizedError(new Error("401: Unauthorized"))).toBe(true);
  });

  it("does not treat generic 403 text as unauthorized login error", () => {
    expect(isUnauthorizedError(new Error("You don't have permission to access this PRD"))).toBe(false);
  });
});
