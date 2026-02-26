import { describe, expect, it } from "vitest";
import {
  parseClerkAuthorizedParties,
  resolveAuthProvider,
} from "../server/authProvider";

describe("resolveAuthProvider", () => {
  it("prefers explicit AUTH_PROVIDER=clerk", () => {
    expect(
      resolveAuthProvider({
        AUTH_PROVIDER: "clerk",
      }),
    ).toBe("clerk");
  });

  it("prefers explicit AUTH_PROVIDER=replit even if Clerk key is present", () => {
    expect(
      resolveAuthProvider({
        AUTH_PROVIDER: "replit",
        CLERK_SECRET_KEY: "sk_test_123",
      }),
    ).toBe("replit");
  });

  it("auto-selects Clerk when CLERK_SECRET_KEY exists", () => {
    expect(
      resolveAuthProvider({
        CLERK_SECRET_KEY: "sk_test_123",
      }),
    ).toBe("clerk");
  });

  it("falls back to replit when no Clerk key is configured", () => {
    expect(resolveAuthProvider({})).toBe("replit");
  });
});

describe("parseClerkAuthorizedParties", () => {
  it("parses comma-separated entries", () => {
    expect(
      parseClerkAuthorizedParties(
        "http://localhost:5000, https://nexora.example.com",
      ),
    ).toEqual(["http://localhost:5000", "https://nexora.example.com"]);
  });

  it("returns undefined for empty input", () => {
    expect(parseClerkAuthorizedParties(undefined)).toBeUndefined();
    expect(parseClerkAuthorizedParties(" ,  ")).toBeUndefined();
  });
});
