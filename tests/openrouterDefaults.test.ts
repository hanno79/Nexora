/*
Author: rahn
Datum: 07.03.2026
Version: 1.1
Beschreibung: Regressionstests fuer sichere OpenRouter-Defaults und Fallback-Ketten.
*/

// ÄNDERUNG 07.03.2026: Development-Tier darf keine direkten Last-Resort-Provider-Fallbacks anhängen.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  OpenRouterClient,
  getDefaultFallbackModelForTier,
  getOpenRouterClient,
  resolveModelTier,
  DEFAULT_FREE_FALLBACK_CHAIN,
  DEFAULT_PRODUCTION_FALLBACK_CHAIN,
  DEFAULT_PREMIUM_FALLBACK_CHAIN,
  getDefaultFallbackChainForTier,
  clearGlobalCooldown,
  getAllActiveCooldowns,
  setGlobalCooldown,
  getProviderCooldownStatus,
  setProviderCooldown,
  clearProviderCooldown,
} from '../server/openrouter';
import { areModelsSameFamily } from '../server/modelFamily';
import { initializeModelRegistry } from '../server/modelRegistry';

describe('openrouter safe defaults', () => {
  beforeAll(async () => {
    await initializeModelRegistry();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves missing or invalid tiers to development', () => {
    expect(resolveModelTier(undefined)).toBe('development');
    expect(resolveModelTier(null)).toBe('development');
    expect(resolveModelTier('invalid-tier')).toBe('development');
    expect(resolveModelTier('production')).toBe('production');
  });

  it('uses tier-appropriate fallback defaults', () => {
    expect(getDefaultFallbackModelForTier('development')).toBe('google/gemma-3-27b-it:free');
    expect(getDefaultFallbackModelForTier('production')).toBe('google/gemini-2.5-flash');
    expect(getDefaultFallbackModelForTier('premium')).toBe('anthropic/claude-sonnet-4');
  });

  it('uses independent verifier defaults per tier', () => {
    const dev = getOpenRouterClient('development').getModels();
    const prod = getOpenRouterClient('production').getModels();
    const premium = getOpenRouterClient('premium').getModels();

    expect(areModelsSameFamily(dev.verifier, dev.generator)).toBe(false);
    expect(areModelsSameFamily(dev.verifier, dev.reviewer)).toBe(false);
    expect(areModelsSameFamily(prod.verifier, prod.generator)).toBe(false);
    expect(areModelsSameFamily(prod.verifier, prod.reviewer)).toBe(false);
    expect(areModelsSameFamily(premium.verifier, premium.generator)).toBe(false);
    expect(areModelsSameFamily(premium.verifier, premium.reviewer)).toBe(false);
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
    vi.spyOn(client as any, 'callModel').mockImplementation(async (modelType: 'generator' | 'reviewer' | 'verifier') => {
      const currentModel = String((client as any).preferredModels?.[modelType] || '');
      attemptedModels.push(currentModel);
      throw new Error('forced failure');
    });

    await expect(
      client.callWithFallback('generator', 'system', 'user', 64)
    ).rejects.toThrow('All');

    // ÄNDERUNG 11.03.2026: Im Development-Tier sind kostenlose Direktprovider erlaubt,
    // aber keine Paid-Modelle (ohne :free Suffix). Prüfung auf tatsächlich bezahlte Modelle
    // statt auf alle Modelle der Production/Premium-Ketten, da Free-Modelle dort auch enthalten sind.
    const paidModelsInChains = [
      ...DEFAULT_PRODUCTION_FALLBACK_CHAIN,
      ...DEFAULT_PREMIUM_FALLBACK_CHAIN,
    ].filter(m => !m.endsWith(':free'));

    expect(attemptedModels.length).toBeGreaterThan(0);
    expect(attemptedModels.some((m) => paidModelsInChains.includes(m))).toBe(false);
    expect(attemptedModels.some((m) => m.includes('gemini-2.5-flash'))).toBe(false);
    expect(attemptedModels.some((m) => m.includes('claude-sonnet-4'))).toBe(false);
  });

  it('leitet im development-tier keine direkte basisvariante aus free-fallbacks ab', async () => {
    const originalNvidiaKey = process.env.NVIDIA_API_KEY;
    process.env.NVIDIA_API_KEY = 'nvapi-test';

    try {
      const client = new OpenRouterClient('test-key', 'development');
      const attemptedModels: string[] = [];
      client.setPreferredModel('generator', 'nvidia/nemotron-3-nano-30b-a3b:free');
      client.setFallbackChain(['google/gemma-3-27b-it:free']);

      vi.spyOn(client as any, 'callModel').mockImplementation(async (modelType: 'generator' | 'reviewer' | 'verifier') => {
        const currentModel = String((client as any).preferredModels?.[modelType] || '');
        attemptedModels.push(currentModel);
        throw new Error('forced failure');
      });

      await expect(
        client.callWithFallback('generator', 'system', 'user', 64)
      ).rejects.toThrow('All');

      expect(attemptedModels).toContain('google/gemma-3-27b-it:free');
      expect(attemptedModels).not.toContain('google/gemma-3-27b-it');
    } finally {
      if (originalNvidiaKey === undefined) {
        delete process.env.NVIDIA_API_KEY;
      } else {
        process.env.NVIDIA_API_KEY = originalNvidiaKey;
      }
    }
  });

  it('haengt im development-tier keine direkten last-resort-provider-fallbacks an', async () => {
    const originalNvidiaKey = process.env.NVIDIA_API_KEY;
    const originalGroqKey = process.env.GROQ_API_KEY;
    const originalCerebrasKey = process.env.CEREBRAS_API_KEY;
    process.env.NVIDIA_API_KEY = 'nvapi-test';
    process.env.GROQ_API_KEY = 'groq-test';
    process.env.CEREBRAS_API_KEY = 'cerebras-test';

    try {
      const client = new OpenRouterClient('test-key', 'development');
      const attemptedModels: string[] = [];
      client.setPreferredModel('generator', 'nvidia/nemotron-3-nano-30b-a3b:free');
      client.setFallbackChain(['google/gemma-3-27b-it:free']);

      vi.spyOn(client as any, 'callModel').mockImplementation(async (modelType: 'generator' | 'reviewer' | 'verifier') => {
        const currentModel = String((client as any).preferredModels?.[modelType] || '');
        attemptedModels.push(currentModel);
        throw new Error('forced failure');
      });

      await expect(
        client.callWithFallback('generator', 'system', 'user', 64)
      ).rejects.toThrow('All');

      expect(attemptedModels).toContain('nvidia/nemotron-3-nano-30b-a3b:free');
      expect(attemptedModels).toContain('google/gemma-3-27b-it:free');
      expect(attemptedModels).not.toContain('meta/llama-3.3-70b-instruct');
      expect(attemptedModels).not.toContain('llama-3.3-70b-versatile');
      expect(attemptedModels).not.toContain('llama-3.3-70b');
    } finally {
      if (originalNvidiaKey === undefined) {
        delete process.env.NVIDIA_API_KEY;
      } else {
        process.env.NVIDIA_API_KEY = originalNvidiaKey;
      }
      if (originalGroqKey === undefined) {
        delete process.env.GROQ_API_KEY;
      } else {
        process.env.GROQ_API_KEY = originalGroqKey;
      }
      if (originalCerebrasKey === undefined) {
        delete process.env.CEREBRAS_API_KEY;
      } else {
        process.env.CEREBRAS_API_KEY = originalCerebrasKey;
      }
    }
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
    vi.spyOn(client as any, 'callModel').mockImplementation(async (modelType: 'generator' | 'reviewer' | 'verifier') => {
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
    vi.spyOn(client as any, 'callModel').mockImplementation(async (modelType: 'generator' | 'reviewer' | 'verifier') => {
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

  it('tries remaining openrouter fallbacks after one free model hits a rate limit', async () => {
    clearGlobalCooldown('model-a:free');
    clearGlobalCooldown('model-b:free');

    const client = new OpenRouterClient('test-key', 'development');
    client.setPreferredModel('generator', 'model-a:free');
    client.setFallbackChain(['model-b:free']);

    const attemptedModels: string[] = [];
    vi.spyOn(client as any, 'callModel').mockImplementation(async (modelType: 'generator' | 'reviewer' | 'verifier') => {
      const currentModel = String((client as any).preferredModels?.[modelType] || '');
      attemptedModels.push(currentModel);
      if (currentModel === 'model-b:free') {
        return { content: 'ok', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, model: currentModel };
      }
      throw new Error('Rate limit exceeded. OpenRouter has temporarily limited your requests.');
    });

    const result = await client.callWithFallback('generator', 'system', 'user', 64);

    expect(result.model).toBe('model-b:free');
    expect(attemptedModels).toContain('model-a:free');
    expect(attemptedModels).toContain('model-b:free');

    clearGlobalCooldown('model-a:free');
    clearGlobalCooldown('model-b:free');
  });

  // --- Rate Limit (German message) Cooldown ---

  it('applies cooldown for German rate limit message (rate limit erreicht)', async () => {
    clearGlobalCooldown('test-cerebras-model');

    const client = new OpenRouterClient('test-key', 'development');
    // Access private method via any-cast
    (client as any).applyFailureCooldown('test-cerebras-model', 'Cerebras API: Rate limit erreicht. Bitte warten Sie einen Moment.');

    const cooldowns = getAllActiveCooldowns();
    expect(cooldowns['test-cerebras-model']).toBeDefined();
    expect(cooldowns['test-cerebras-model'].reason).toBe('rate limited');

    clearGlobalCooldown('test-cerebras-model');
  });

  it('applies cooldowns for bare 429, ENOTFOUND, and socket hang up messages', async () => {
    clearGlobalCooldown('test-rate-model');
    clearGlobalCooldown('test-notfound-model');
    clearGlobalCooldown('test-socket-model');

    const client = new OpenRouterClient('test-key', 'development');
    (client as any).applyFailureCooldown('test-rate-model', '429');
    (client as any).applyFailureCooldown('test-notfound-model', 'ENOTFOUND api.openrouter.ai');
    (client as any).applyFailureCooldown('test-socket-model', 'socket hang up');

    const cooldowns = getAllActiveCooldowns();
    expect(cooldowns['test-rate-model']?.reason).toBe('rate limited');
    expect(cooldowns['test-notfound-model']?.reason).toBe('model not found');
    expect(cooldowns['test-socket-model']?.reason).toBe('provider connection error');

    clearGlobalCooldown('test-rate-model');
    clearGlobalCooldown('test-notfound-model');
    clearGlobalCooldown('test-socket-model');
  });

  // --- Think Tag Stripping ---

  it('strips think tags from OpenRouter API response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'test',
          model: 'test-model',
          choices: [{
            message: { role: 'assistant', content: '<think>\nI need to reason about this.\n</think>\n\nActual content here.' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      ) as Response
    );

    const client = new OpenRouterClient('test-key', 'development');
    const result = await client.callModel('generator', 'system', 'user', 100, 0.1);

    expect(result.content).toBe('Actual content here.');
    expect(result.content).not.toContain('<think>');
    expect(result.content).not.toContain('</think>');
  });

  it('keeps timeout active until the response body is consumed and falls back on stalled body reads', async () => {
    const originalTimeout = process.env.OPENROUTER_TIMEOUT_MS;
    process.env.OPENROUTER_TIMEOUT_MS = '25';

    try {
      const stalledResponse = vi.fn(async (_url: string, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal | undefined;
        return {
          ok: true,
          json: () =>
            new Promise((_resolve, reject) => {
              signal?.addEventListener(
                'abort',
                () => reject(Object.assign(new Error('aborted during body read'), { name: 'AbortError' })),
                { once: true },
              );
            }),
        } as any;
      });

      const successResponse = new Response(
        JSON.stringify({
          id: 'fallback-success',
          model: 'model-fallback:free',
          choices: [{
            message: { role: 'assistant', content: 'Recovered fallback content.' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      ) as Response;

      const fetchMock = vi.spyOn(globalThis, 'fetch')
        .mockImplementationOnce(stalledResponse as any)
        .mockResolvedValueOnce(successResponse);

      const client = new OpenRouterClient('test-key', 'development');
      client.setPreferredModel('generator', 'model-primary:free');
      client.setFallbackChain(['model-fallback:free']);

      const result = await client.callWithFallback('generator', 'system', 'user', 100);

      expect(result.model).toBe('model-fallback:free');
      expect(result.usedFallback).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      if (originalTimeout === undefined) {
        delete process.env.OPENROUTER_TIMEOUT_MS;
      } else {
        process.env.OPENROUTER_TIMEOUT_MS = originalTimeout;
      }
    }
  });

  // --- Provider-Level Circuit Breaker ---

  it('sets provider cooldown when direct provider times out', async () => {
    // Clean slate
    clearProviderCooldown('nvidia');
    clearGlobalCooldown('meta/llama-3.3-70b-instruct');

    const originalKey = process.env.NVIDIA_API_KEY;
    process.env.NVIDIA_API_KEY = 'nvapi-test';

    try {
      const client = new OpenRouterClient('test-key', 'development');
      client.setPreferredModel('generator', 'meta/llama-3.3-70b-instruct');
      client.setFallbackChain([]);

      vi.spyOn(client as any, 'callModel').mockImplementation(async () => {
        throw new Error('nvidia Provider Error: Provider request timed out after 120000ms');
      });

      await expect(
        client.callWithFallback('generator', 'system', 'user', 64)
      ).rejects.toThrow('All');

      // Provider cooldown should be set
      const providerCd = getProviderCooldownStatus('nvidia');
      expect(providerCd).not.toBeNull();
      expect(providerCd!.reason).toContain('timeout');
    } finally {
      clearProviderCooldown('nvidia');
      clearGlobalCooldown('meta/llama-3.3-70b-instruct');
      if (originalKey === undefined) {
        delete process.env.NVIDIA_API_KEY;
      } else {
        process.env.NVIDIA_API_KEY = originalKey;
      }
    }
  });

  it('skips remaining nvidia models after provider cooldown is set', async () => {
    // Clean slate
    clearProviderCooldown('nvidia');
    clearGlobalCooldown('meta/llama-3.3-70b-instruct');
    clearGlobalCooldown('meta/llama-3.1-8b-instruct');

    const originalKey = process.env.NVIDIA_API_KEY;
    process.env.NVIDIA_API_KEY = 'nvapi-test';

    try {
      // Pre-set provider cooldown (simulates previous timeout)
      setProviderCooldown('nvidia', 60_000, 'timeout on previous model');

      const client = new OpenRouterClient('test-key', 'development');
      // Both models route to NVIDIA
      client.setPreferredModel('generator', 'meta/llama-3.3-70b-instruct');
      client.setFallbackChain(['google/gemma-3-27b-it:free']);

      const attemptedModels: string[] = [];
      vi.spyOn(client as any, 'callModel').mockImplementation(async (modelType: 'generator' | 'reviewer' | 'verifier') => {
        const currentModel = String((client as any).preferredModels?.[modelType] || '');
        attemptedModels.push(currentModel);
        if (currentModel === 'google/gemma-3-27b-it:free') {
          return { content: 'ok', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, model: currentModel };
        }
        throw new Error('forced failure');
      });

      const result = await client.callWithFallback('generator', 'system', 'user', 64);

      expect(result.model).toBe('google/gemma-3-27b-it:free');
      // NVIDIA models should be skipped due to provider cooldown
      expect(attemptedModels).not.toContain('meta/llama-3.3-70b-instruct');
      expect(attemptedModels).not.toContain('meta/llama-3.1-8b-instruct');
      expect(attemptedModels).toContain('google/gemma-3-27b-it:free');
    } finally {
      clearProviderCooldown('nvidia');
      clearGlobalCooldown('meta/llama-3.3-70b-instruct');
      clearGlobalCooldown('meta/llama-3.1-8b-instruct');
      for (const model of DEFAULT_FREE_FALLBACK_CHAIN) clearGlobalCooldown(model);
      if (originalKey === undefined) {
        delete process.env.NVIDIA_API_KEY;
      } else {
        process.env.NVIDIA_API_KEY = originalKey;
      }
    }
  });

  // --- Tier-Aware Fallback Chains ---

  it('development tier fallback chain contains only free models', () => {
    const chain = getDefaultFallbackChainForTier('development');
    expect(chain).toBe(DEFAULT_FREE_FALLBACK_CHAIN);
    for (const model of chain) {
      expect(model).toMatch(/:free$/);
    }
  });

  it('production tier fallback chain contains only paid models', () => {
    const chain = getDefaultFallbackChainForTier('production');
    expect(chain).toBe(DEFAULT_PRODUCTION_FALLBACK_CHAIN);
    expect(chain.length).toBeGreaterThanOrEqual(3);
    // All models must be paid (no :free suffix) — free fallbacks were removed
    // to prevent non-development tiers from accidentally using free endpoints
    const freeModels = chain.filter(m => m.endsWith(':free'));
    expect(freeModels.length).toBe(0);
  });

  it('premium tier fallback chain contains paid models', () => {
    const chain = getDefaultFallbackChainForTier('premium');
    expect(chain).toBe(DEFAULT_PREMIUM_FALLBACK_CHAIN);
    const paidModels = chain.filter(m => !m.endsWith(':free'));
    expect(paidModels.length).toBeGreaterThanOrEqual(2);
  });

  it('production tier fallback model is paid (not free)', () => {
    const model = getDefaultFallbackModelForTier('production');
    expect(model).not.toMatch(/:free$/);
    expect(model).toBe('google/gemini-2.5-flash');
  });

  it('premium tier fallback model is paid (not free)', () => {
    const model = getDefaultFallbackModelForTier('premium');
    expect(model).not.toMatch(/:free$/);
    expect(model).toBe('anthropic/claude-sonnet-4');
  });

  it('development tier fallback model remains free', () => {
    const model = getDefaultFallbackModelForTier('development');
    expect(model).toMatch(/:free$/);
  });
});
