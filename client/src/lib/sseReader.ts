/**
 * Reads a server-sent events (SSE) stream, invoking onEvent for each progress
 * event and returning the final `result`-typed payload.
 *
 * Extracted from DualAiDialog so it can be unit-tested and reused without
 * depending on component state or i18n context.
 */
export class SsePayloadError extends Error {
  payload: any;

  constructor(payload: any, fallbackMessage: string) {
    super(payload?.message || fallbackMessage);
    this.name = 'SsePayloadError';
    this.payload = payload;
  }
}

export async function readSSEStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: any) => void,
  errorMessage: string = 'Generation failed',
): Promise<any | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: any = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Process complete SSE messages (separated by double newline)
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (const part of parts) {
      const lines = part.split('\n');
      let eventType = '';
      let data = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim();
        else if (line.startsWith('data: ')) data += line.slice(6);
        else if (line.startsWith('data:')) data += line.slice(5);
      }
      if (!data) continue;
      let isErrorEvent = false;
      try {
        const parsed = JSON.parse(data);
        if (eventType === 'result') {
          result = parsed;
        } else if (eventType === 'error') {
          isErrorEvent = true;
          throw new SsePayloadError(parsed, errorMessage);
        } else {
          onEvent(parsed);
        }
      } catch (e: any) {
        if (isErrorEvent) throw e;
        if (e.message?.includes('Server error')) throw e;
        console.warn('SSE parse error:', e);
      }
    }
  }
  return result;
}
