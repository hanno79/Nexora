import { describe, expect, it } from "vitest";
import crypto from "crypto";
import { extractUserIdFromSessionData, parseCookieHeader, unsignSessionId } from "../server/wsAuthUtils";

function signSessionId(sessionId: string, secret: string): string {
  const sig = crypto
    .createHmac("sha256", secret)
    .update(sessionId)
    .digest("base64")
    .replace(/=+$/g, "");
  return `s:${sessionId}.${sig}`;
}

describe("parseCookieHeader", () => {
  it("parses multiple cookie values", () => {
    const parsed = parseCookieHeader("a=1; connect.sid=s%3Asid.sig; theme=dark");
    expect(parsed.a).toBe("1");
    expect(parsed["connect.sid"]).toBe("s%3Asid.sig");
    expect(parsed.theme).toBe("dark");
  });

  it("returns empty object for missing header", () => {
    expect(parseCookieHeader(undefined)).toEqual({});
  });
});

describe("unsignSessionId", () => {
  it("validates and returns session id for signed cookie", () => {
    const raw = signSessionId("sid-123", "secret-1");
    expect(unsignSessionId(raw, "secret-1")).toBe("sid-123");
  });

  it("supports URL-encoded signed cookies", () => {
    const raw = encodeURIComponent(signSessionId("sid-encoded", "secret-2"));
    expect(unsignSessionId(raw, "secret-2")).toBe("sid-encoded");
  });

  it("returns null for invalid signature", () => {
    const raw = signSessionId("sid-123", "secret-1");
    expect(unsignSessionId(raw, "wrong-secret")).toBeNull();
  });

  it("returns null when format is invalid", () => {
    expect(unsignSessionId("sid.without.prefix", "secret")).toBeNull();
    expect(unsignSessionId("s:no-dot", "secret")).toBeNull();
  });
});

describe("extractUserIdFromSessionData", () => {
  it("extracts claims.sub from passport session", () => {
    const userId = extractUserIdFromSessionData({
      passport: {
        user: {
          claims: { sub: "u-claims" },
        },
      },
    });
    expect(userId).toBe("u-claims");
  });

  it("falls back to passport.user.id when claims are missing", () => {
    const userId = extractUserIdFromSessionData({
      passport: {
        user: {
          id: "u-id",
        },
      },
    });
    expect(userId).toBe("u-id");
  });

  it("supports string passport user id", () => {
    const userId = extractUserIdFromSessionData({
      passport: {
        user: "u-string",
      },
    });
    expect(userId).toBe("u-string");
  });

  it("returns null when no user data exists", () => {
    expect(extractUserIdFromSessionData({})).toBeNull();
    expect(extractUserIdFromSessionData(null)).toBeNull();
  });
});

