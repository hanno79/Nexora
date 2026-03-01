import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OpenRouterClient,
  getDefaultFallbackModelForTier,
  getOpenRouterClient,
  resolveModelTier,
  DEFAULT_FREE_FALLBACK_CHAIN,
  clearGlobalCooldown,
  getAllActiveCooldowns,
  setGlobalCooldown,
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

  it('DEFAULT_FREE_FALLBACK_CHAIN contains at least 4 free models', () => {
    expect(DEFAULT_FREE_FALLBACK_CHAIN.length).toBeGreaterThanOrEqual(4);
    for (const model of DEFAULT_FREE_FALLBACK_CHAIN) {
      // All must end in :free or be the openrouter/free auto-router
      expect(model).toMatch(/:free$|^openrouter\/free$/);
    }
  });

  it('iterates the full fallback chain when set on client', async () => {
    // Clean up any stale cooldowns
    for (const model of DEFAULT_FREE_FALLBACK_CHAIN) {
      clearGlobalCooldown(model);
    }
    clearGlobalCooldown('nvidia/nemotron-3-nano-30b-a3b:free');

    const client = new OpenRouterClient('test-key', 'development');
    const chain = ['model-a:free', 'model-b:free', 'model-c:free'];
    client.setFallbackChain(chain);
    client.setPreferredModel('generator', 'nvidia/nemotron-3-nano-30b-a3b:free');

    const attemptedModels: string[] = [];
    vi.spyOn(client as any, 'callModel').mockImplementation(async (modelType: 'generator' | 'reviewer') => {
      const currentModel = String((client as any).preferredModels?.[modelType] || '');
      attemptedModels.push(currentModel);
      if (currentModel === 'model-c:free') {
        return { content: 'ok', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, model: currentModel };
      }
      throw new Error('forced failure');
    });

    const result = await client.callWithFallback('generator', 'system', 'user', 64);

    expect(result.model).toBe('model-c:free');
    expect(result.usedFallback).toBe(true);
    // Should try: primary (nemotron), then chain[0], chain[1], chain[2]
    expect(attemptedModels).toContain('nvidia/nemotron-3-nano-30b-a3b:free');
    expect(attemptedModels).toContain('model-a:free');
    expect(attemptedModels).toContain('model-b:free');
    expect(attemptedModels).toContain('model-c:free');

    // Clean up
    for (const m of attemptedModels) clearGlobalCooldown(m);
  });

  it('global cooldown store persists across client instances', () => {
    setGlobalCooldown('test-model:free', 60_000, 'rate limited');
    const cooldowns = getAllActiveCooldowns();
    expect(cooldowns['test-model:free']).toBeDefined();
    expect(cooldowns['test-model:free'].reason).toBe('rate limited');

    clearGlobalCooldown('test-model:free');
    const afterClear = getAllActiveCooldowns();
    expect(afterClear['test-model:free']).toBeUndefined();
  });

  it('skips models with active global cooldown in fallback chain', async () => {
    // Clean slate
    clearGlobalCooldown('model-x:free');
    clearGlobalCooldown('model-y:free');
    clearGlobalCooldown('nvidia/nemotron-3-nano-30b-a3b:free');

    // Put model-x on cooldown
    setGlobalCooldown('model-x:free', 60_000, 'rate limited');

    const client = new OpenRouterClient('test-key', 'development');
    client.setFallbackChain(['model-x:free', 'model-y:free']);
    client.setPreferredModel('generator', 'nvidia/nemotron-3-nano-30b-a3b:free');

    const attemptedModels: string[] = [];
    vi.spyOn(client as any, 'callModel').mockImplementation(async (modelType: 'generator' | 'reviewer') => {
      const currentModel = String((client as any).preferredModels?.[modelType] || '');
      attemptedModels.push(currentModel);
      if (currentModel === 'model-y:free') {
        return { content: 'ok', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, model: currentModel };
      }
      throw new Error('forced failure');
    });

    const result = await client.callWithFallback('generator', 'system', 'user', 64);

    expect(result.model).toBe('model-y:free');
    // model-x should be skipped because it's on cooldown
    expect(attemptedModels).not.toContain('model-x:free');
    expect(attemptedModels).toContain('model-y:free');

    // Clean up
    clearGlobalCooldown('model-x:free');
    clearGlobalCooldown('model-y:free');
    for (const m of attemptedModels) clearGlobalCooldown(m);
  });
});
