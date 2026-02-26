import { describe, expect, it, vi } from "vitest";
import { logger, sanitizeForLogging } from "../server/logger";

describe("sanitizeForLogging", () => {
  it("redacts sensitive keys and truncates long strings", () => {
    const sanitized = sanitizeForLogging({
      requestBody: { item: { text: "very secret payload" } },
      response: { token: "top-secret-token" },
      apiKey: "abc123",
      normal: "ok",
      long: "x".repeat(500),
    });

    expect(sanitized?.requestBody).toBe("[REDACTED object]");
    expect(sanitized?.response).toBe("[REDACTED object]");
    expect(String(sanitized?.apiKey)).toContain("[REDACTED");
    expect(sanitized?.normal).toBe("ok");
    expect(String(sanitized?.long)).toContain("[truncated");
  });

  it("normalizes Error instances", () => {
    const sanitized = sanitizeForLogging({
      error: new Error("boom"),
    });

    expect(sanitized?.error).toEqual({
      name: "Error",
      message: "boom",
    });
  });
});

describe("logger", () => {
  it("writes sanitized JSON lines", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.info("test", {
      payload: { text: "confidential content" },
      status: 400,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0][0]);
    const parsed = JSON.parse(line);

    expect(parsed.msg).toBe("test");
    expect(parsed.status).toBe(400);
    expect(parsed.payload).toBe("[REDACTED object]");

    spy.mockRestore();
  });
});
