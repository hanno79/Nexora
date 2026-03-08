import { describe, expect, it } from "vitest";
import { readSSEStream, SsePayloadError } from "@/lib/sseReader";

function buildStream(payload: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

describe("sseReader", () => {
  it("returns the result payload when the SSE stream completes successfully", async () => {
    const result = await readSSEStream(
      buildStream('event: result\ndata: {"finalContent":"ok","qualityStatus":"passed"}\n\n'),
      () => {},
      "Generation failed",
    );

    expect(result).toMatchObject({
      finalContent: "ok",
      qualityStatus: "passed",
    });
  });

  it("throws a structured SsePayloadError for SSE error events", async () => {
    const stream = buildStream(
      'event: error\ndata: {"message":"Compiler quality gate failed after final verification.","qualityStatus":"failed_quality","compilerDiagnostics":{"failureStage":"semantic_verifier","semanticBlockingCodes":["cross_section_inconsistency"]}}\n\n',
    );

    let captured: unknown;
    try {
      await readSSEStream(stream, () => {}, "Generation failed");
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(SsePayloadError);
    expect((captured as SsePayloadError).message).toBe("Compiler quality gate failed after final verification.");
    expect((captured as SsePayloadError).payload).toMatchObject({
      qualityStatus: "failed_quality",
      compilerDiagnostics: {
        failureStage: "semantic_verifier",
      },
    });
  });
});
