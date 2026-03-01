import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterClient, clearGlobalCooldown } from '../server/openrouter';

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
    vi.spyOn(client as any, 'callModel').mockImplementation(async (modelType: 'generator' | 'reviewer') => {
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
    vi.spyOn(client as any, 'callModel').mockImplementation(async (modelType: 'generator' | 'reviewer') => {
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
});
