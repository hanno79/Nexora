import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterClient, clearGlobalCooldown } from '../server/openrouter';
import { getModelFamily } from '../server/modelFamily';

const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };

describe('OpenRouterClient fallback behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Clear any global cooldowns from previous tests
    clearGlobalCooldown('minimax/minimax-m2.5');
  });

  it('skips deprecated fallback models from the attempt list', async () => {
    const client = new OpenRouterClient('test-key', 'production');
    client.setPreferredModel('reviewer', 'minimax/minimax-m2.5');
    client.setPreferredModel('fallback', 'deepseek/deepseek-r1-0528:free');

    const attempts: string[] = [];
    vi.spyOn(client as any, 'callModel').mockImplementation(async (modelType: 'generator' | 'reviewer' | 'verifier') => {
      const attemptedModel = client.getPreferredModel(modelType)!;
      attempts.push(attemptedModel);
      if (attemptedModel === 'minimax/minimax-m2.5') {
        throw new Error('Model minimax/minimax-m2.5 returned an empty response. Please try again.');
      }
      return { content: 'ok', usage, model: attemptedModel };
    });

    const result = await client.callWithFallback('reviewer', 'system', 'user', 1200);

    expect(result.model).toBe('anthropic/claude-sonnet-4');
    expect(attempts).toEqual([
      'minimax/minimax-m2.5',
      'anthropic/claude-sonnet-4',
    ]);
    expect(attempts).not.toContain('deepseek/deepseek-r1-0528:free');
  });

  it('cools down unstable models after empty responses and skips them on the next call', async () => {
    const client = new OpenRouterClient('test-key', 'production');
    client.setPreferredModel('reviewer', 'minimax/minimax-m2.5');
    client.setPreferredModel('fallback', 'anthropic/claude-sonnet-4');

    const attempts: string[] = [];
    vi.spyOn(client as any, 'callModel').mockImplementation(async (modelType: 'generator' | 'reviewer' | 'verifier') => {
      const attemptedModel = client.getPreferredModel(modelType)!;
      attempts.push(attemptedModel);
      if (attemptedModel === 'minimax/minimax-m2.5') {
        throw new Error('Model minimax/minimax-m2.5 returned an empty response. Please try again.');
      }
      return { content: 'ok', usage, model: attemptedModel };
    });

    await client.callWithFallback('reviewer', 'system', 'user', 1200);
    await client.callWithFallback('reviewer', 'system-2', 'user-2', 1200);

    expect(attempts).toEqual([
      'minimax/minimax-m2.5',
      'anthropic/claude-sonnet-4',
      'anthropic/claude-sonnet-4',
    ]);
  });

  it('defers blocked verifier families until an independent family is tried first', async () => {
    const client = new OpenRouterClient('test-key', 'production');
    client.setPreferredModel('verifier', 'anthropic/claude-sonnet-4');
    client.setFallbackChain(['anthropic/claude-haiku-4']);

    const attempts: string[] = [];
    vi.spyOn(client as any, 'callModel').mockImplementation(async (modelType: 'generator' | 'reviewer' | 'verifier') => {
      const attemptedModel = client.getPreferredModel(modelType)!;
      attempts.push(attemptedModel);
      return { content: 'ok', usage, model: attemptedModel };
    });

    const result = await client.callWithFallback(
      'verifier',
      'system',
      'user',
      1200,
      undefined,
      undefined,
      {
        avoidModelFamilies: ['claude', 'gemini'],
        allowSameFamilyFallback: true,
      },
    );

    expect(result.model).toBe('mistralai/mistral-small-3.1-24b-instruct');
    expect(attempts).toEqual(['mistralai/mistral-small-3.1-24b-instruct']);
  });

  it('allows same-family verifier fallback only after independent candidates fail', async () => {
    const client = new OpenRouterClient('test-key', 'production');
    client.setPreferredModel('verifier', 'anthropic/claude-sonnet-4');
    client.setFallbackChain(['anthropic/claude-haiku-4']);

    const attempts: string[] = [];
    const sameFamilyFallbacks: string[] = [];
    // ÄNDERUNG 08.03.2026: Alle unabhaengigen Kandidaten kontrolliert fehlschlagen lassen,
    // damit der Test auch bei aktiven Direct-Provider-Keys verifiziert, dass Same-Family-
    // Fallbacks erst nach allen unabhaengigen Versuchen zugelassen werden.
    vi.spyOn(client as any, 'callModel').mockImplementation(async (modelType: 'generator' | 'reviewer' | 'verifier') => {
      const attemptedModel = client.getPreferredModel(modelType)!;
      attempts.push(attemptedModel);
      const attemptedFamily = getModelFamily(attemptedModel);
      if (attemptedFamily !== 'claude') {
        throw new Error('forced verifier failure');
      }
      return { content: 'ok', usage, model: attemptedModel };
    });

    const result = await client.callWithFallback(
      'verifier',
      'system',
      'user',
      1200,
      undefined,
      undefined,
      {
        avoidModelFamilies: ['claude', 'gemini'],
        allowSameFamilyFallback: true,
        onSameFamilyFallback: ({ model }) => sameFamilyFallbacks.push(model),
      },
    );

    expect(attempts[0]).toBe('mistralai/mistral-small-3.1-24b-instruct');
    expect(attempts.at(-1)).toBe('anthropic/claude-sonnet-4');
    expect(attempts.slice(0, -1).every(model => {
      const family = getModelFamily(model);
      return family !== 'claude' && family !== 'gemini';
    })).toBe(true);
    expect(sameFamilyFallbacks).toEqual(['anthropic/claude-sonnet-4']);
    expect(result.model).toBe('anthropic/claude-sonnet-4');
  });

  it('surfaces repeated rate-limit failures as a transient provider issue without duplicate error lines', async () => {
    const client = new OpenRouterClient('test-key', 'development');
    client.setPreferredModel('generator', 'model-a:free');
    client.setFallbackChain(['model-b:free']);

    vi.spyOn(client as any, 'callModel').mockImplementation(async () => {
      throw new Error('Rate limit exceeded. OpenRouter has temporarily limited your requests.');
    });

    let thrown: Error | undefined;
    try {
      await client.callWithFallback('generator', 'system', 'user', 1200);
    } catch (error: any) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    expect(thrown?.message).toContain('currently rate limited');
    expect(thrown?.message).not.toContain('verify your models are available on OpenRouter');
    expect(thrown?.message).toContain('Failure summary:');
    expect(thrown?.message.match(/model-a:free:/g)?.length ?? 0).toBe(1);
    expect(thrown?.message.match(/model-b:free:/g)?.length ?? 0).toBe(1);
  });

  it('quarantines repeated provider-400 models for the remainder of the run', async () => {
    const client = new OpenRouterClient('test-key', 'development');
    client.setPreferredModel('generator', 'bad-model:free');
    client.setFallbackChain(['good-model:free']);

    const attempts: string[] = [];
    vi.spyOn(client as any, 'callModel').mockImplementation(async (modelType: 'generator' | 'reviewer' | 'verifier') => {
      const attemptedModel = client.getPreferredModel(modelType)!;
      attempts.push(attemptedModel);
      if (attemptedModel === 'bad-model:free') {
        throw new Error('Provider returned error. Status: 400');
      }
      return { content: 'ok', usage, model: attemptedModel };
    });

    await client.callWithFallback('generator', 'system', 'user', 1200);
    clearGlobalCooldown('bad-model:free');
    await client.callWithFallback('generator', 'system-2', 'user-2', 1200);
    await client.callWithFallback('generator', 'system-3', 'user-3', 1200);

    expect(attempts).toEqual([
      'bad-model:free',
      'good-model:free',
      'bad-model:free',
      'good-model:free',
      'good-model:free',
    ]);
  });
});
