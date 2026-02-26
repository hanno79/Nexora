import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, getQueryFn } from "../client/src/lib/queryClient";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("queryClient error handling", () => {
  it("apiRequest throws error with HTTP status attached", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    ) as any;

    try {
      await apiRequest("GET", "/api/example");
      throw new Error("Expected apiRequest to throw");
    } catch (error) {
      const httpError = error as Error & { status?: number };
      expect(httpError.message).toBe("Unauthorized");
      expect(httpError.status).toBe(401);
    }
  });

  it("getQueryFn returns null on 401 when configured with on401=returnNull", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    ) as any;

    const queryFn = getQueryFn<unknown>({ on401: "returnNull" });
    const result = await queryFn({ queryKey: ["/api/example"] } as any);

    expect(result).toBeNull();
  });
});
