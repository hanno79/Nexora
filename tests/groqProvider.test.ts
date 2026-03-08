import { afterEach, describe, expect, it, vi } from 'vitest';
import { GroqProvider } from '../server/providers/groq';

describe('GroqProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('clamps vendor-prefixed llama 4 models to Groq output-token limits', async () => {
    let requestBody: Record<string, unknown> | null = null;

    global.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body || '{}'));
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
        model: 'meta-llama/llama-4-maverick-17b-128e-instruct',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const provider = new GroqProvider('gsk_test_12345678901234567890');

    await provider.callModel({
      model: 'meta-llama/llama-4-maverick-17b-128e-instruct',
      messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 12000,
    });

    expect(requestBody?.max_tokens).toBe(8192);
  });

  it('skips oversized Groq requests during preflight before hitting the network', async () => {
    global.fetch = vi.fn() as typeof fetch;

    const provider = new GroqProvider('gsk_test_12345678901234567890');

    await expect(provider.callModel({
      model: 'meta-llama/llama-4-maverick-17b-128e-instruct',
      messages: [{ role: 'user', content: 'A'.repeat(600_000) }],
      maxTokens: 4096,
    })).rejects.toThrow(/Request zu gross \(preflight\)/i);

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
