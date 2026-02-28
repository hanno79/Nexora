import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OpenRouterClient,
  getDefaultFallbackModelForTier,
  getOpenRouterClient,
  resolveModelTier,
} from '../server/openrouter';

describe('openrouter safe defaults', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves missing or invalid tiers to development', () => {
    expect(resolveModelTier(undefined)).toBe('development');
    expect(resolveModelTier(null)).toBe('development');
    expect(resolveModelTier('invalid-tier')).toBe('development');
    expect(resolveModelTier('production')).toBe('production');
  });

  it('uses free fallback defaults across all tiers', () => {
    expect(getDefaultFallbackModelForTier('development')).toBe('google/gemma-3-27b-it:free');
    expect(getDefaultFallbackModelForTier('production')).toBe('google/gemma-3-27b-it:free');
    expect(getDefaultFallbackModelForTier('premium')).toBe('google/gemma-3-27b-it:free');
  });

  it('creates clients with development tier by default', () => {
    const client = getOpenRouterClient();
    expect(client.getTier()).toBe('development');
  });

  it('ignores process.env.AI_TIER to prevent global paid model override', () => {
    const original = process.env.AI_TIER;
    try {
      process.env.AI_TIER = 'production';
      const client = getOpenRouterClient();
      expect(client.getTier()).toBe('development');

      process.env.AI_TIER = 'premium';
      const client2 = getOpenRouterClient();
      expect(client2.getTier()).toBe('development');
    } finally {
      if (original === undefined) {
        delete process.env.AI_TIER;
      } else {
        process.env.AI_TIER = original;
      }
    }
  });

  it('respects explicitly passed tier parameter', () => {
    const client = getOpenRouterClient('production');
    expect(client.getTier()).toBe('production');
  });

  it('maps 403 key-limit responses to quota message', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: 'Key limit exceeded (monthly limit).' } }),
        { status: 403, headers: { 'content-type': 'application/json' } }
      ) as Response
    );

    const client = new OpenRouterClient('test-key', 'development');
    await expect(
      client.callModel('generator', 'system', 'user', 100, 0.1)
    ).rejects.toThrow('key quota exceeded');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 403 unauthorized responses to auth error message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: 'invalid api key' } }),
        { status: 403, headers: { 'content-type': 'application/json' } }
      ) as Response
    );

    const client = new OpenRouterClient('test-key', 'development');
    await expect(
      client.callModel('generator', 'system', 'user', 100, 0.1)
    ).rejects.toThrow('invalid or unauthorized');
  });

  it('maps 429 responses to rate-limit message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('rate limited', { status: 429 }) as Response
    );

    const client = new OpenRouterClient('test-key', 'development');
    await expect(
      client.callModel('generator', 'system', 'user', 100, 0.1)
    ).rejects.toThrow('Rate limit exceeded');
  });

  it('does not inject paid fallback models for development defaults', async () => {
    const client = new OpenRouterClient('test-key', 'development');
    const attemptedModels: string[] = [];
    vi.spyOn(client as any, 'callModel').mockImplementation(async (modelType: 'generator' | 'reviewer') => {
      const currentModel = String((client as any).preferredModels?.[modelType] || '');
      attemptedModels.push(currentModel);
      throw new Error('forced failure');
    });

    await expect(
      client.callWithFallback('generator', 'system', 'user', 64)
    ).rejects.toThrow('All');

    expect(attemptedModels.length).toBeGreaterThan(0);
    expect(attemptedModels.every((m) => m.endsWith(':free'))).toBe(true);
    expect(attemptedModels.some((m) => m.includes('gemini-2.5-flash'))).toBe(false);
    expect(attemptedModels.some((m) => m.includes('claude-sonnet-4'))).toBe(false);
  });
});
