import { describe, expect, it } from "vitest";
import { getMissingReplitAuthEnv, parseReplitDomains, resolveDemoAuthEnabled } from "../server/authMode";

describe("resolveDemoAuthEnabled", () => {
  it("enables demo auth only when LOCAL_DEMO_AUTH=true", () => {
    expect(resolveDemoAuthEnabled({ LOCAL_DEMO_AUTH: "true" })).toBe(true);
    expect(resolveDemoAuthEnabled({ LOCAL_DEMO_AUTH: "false" })).toBe(false);
    expect(resolveDemoAuthEnabled({})).toBe(false);
  });
});

describe("getMissingReplitAuthEnv", () => {
  it("returns all missing required vars", () => {
    expect(getMissingReplitAuthEnv({})).toEqual([
      "REPLIT_DOMAINS",
      "REPL_ID",
      "SESSION_SECRET",
    ]);
  });

  it("returns empty array when all required vars are set", () => {
    expect(
      getMissingReplitAuthEnv({
        REPLIT_DOMAINS: "app.example.com",
        REPL_ID: "repl-id-1",
        SESSION_SECRET: "secret-123",
      }),
    ).toEqual([]);
  });
});

describe("parseReplitDomains", () => {
  it("parses and trims comma-separated domains", () => {
    expect(parseReplitDomains("a.example.com, b.example.com ,, c.example.com")).toEqual([
      "a.example.com",
      "b.example.com",
      "c.example.com",
    ]);
  });
});

