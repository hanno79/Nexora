import { describe, expect, it, vi } from "vitest";

async function createGuidedService() {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "postgresql://nexora:nexora@localhost:5432/nexora";
  }

  const { GuidedAiService } = await import("../server/guidedAiService");
  return new GuidedAiService();
}

function seedSession(service: any, sessionId: string, userId: string) {
  service.conversationContexts.create(sessionId, userId, {
    projectIdea: "Build a collaborative editor",
    featureOverview: "Realtime editing and approvals",
    answers: [{ questionId: "q1", question: "Users?", answer: "Team of 20" }],
    roundNumber: 2,
  });
}

function mockFinalizeClient(service: any, callWithFallback: ReturnType<typeof vi.fn>) {
  service.createClientWithUserPreferences = vi.fn().mockResolvedValue({
    client: { callWithFallback },
    contentLanguage: "en",
  });
}

describe("GuidedAiService finalizePRD session handling", () => {
  it("consumes the session before finalize and prevents duplicate parallel finalize", async () => {
    const service: any = await createGuidedService();
    const callWithFallback = vi.fn().mockResolvedValue({
      content: "# Final PRD",
      usage: { total_tokens: 321, completion_tokens: 123 },
      model: "test-model",
    });
    mockFinalizeClient(service, callWithFallback);
    seedSession(service, "s1", "u1");

    const firstFinalize = service.finalizePRD("s1", "u1");
    await expect(service.finalizePRD("s1", "u1")).rejects.toThrow(
      "Session not found or expired. Please start a new guided workflow.",
    );

    const result = await firstFinalize;
    expect(result.prdContent).toBe("# Final PRD");
    expect(callWithFallback).toHaveBeenCalledTimes(1);
  });

  it("restores session context when finalize generation fails", async () => {
    const service: any = await createGuidedService();
    const callWithFallback = vi
      .fn()
      .mockRejectedValueOnce(new Error("Upstream model failed"))
      .mockResolvedValueOnce({
        content: "# Final PRD Retry",
        usage: { total_tokens: 111, completion_tokens: 77 },
        model: "test-model",
      });

    mockFinalizeClient(service, callWithFallback);
    seedSession(service, "s2", "u2");

    await expect(service.finalizePRD("s2", "u2")).rejects.toThrow("Upstream model failed");

    const retry = await service.finalizePRD("s2", "u2");
    expect(retry.prdContent).toBe("# Final PRD Retry");
    expect(callWithFallback).toHaveBeenCalledTimes(2);
  });
});
