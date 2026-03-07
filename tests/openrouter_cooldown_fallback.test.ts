/*
Author: rahn
Datum: 07.03.2026
Version: 1.0
Beschreibung: Regressionstest fuer Last-Resort-Fallbacks bei aktiven Modell-Cooldowns.
*/

// ÄNDERUNG 07.03.2026: Bereits gekuehlte Modelle duerfen kontrolliert als letzter Versuch genutzt werden.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { OpenRouterClient, clearGlobalCooldown, setGlobalCooldown } from '../server/openrouter';
import { initializeModelRegistry } from '../server/modelRegistry';

describe('openrouter cooldown fallback', () => {
  beforeAll(async () => {
    await initializeModelRegistry();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearGlobalCooldown('model-a:free');
    clearGlobalCooldown('model-b:free');
    clearGlobalCooldown('model-c:free');
  });

  it('verwendet gekuehlte fallback-modelle als letzten versuch, wenn der regulaere durchlauf erschoepft ist', async () => {
    setGlobalCooldown('model-b:free', 60_000, 'rate limited');
    setGlobalCooldown('model-c:free', 60_000, 'complete expansion failure');

    const client = new OpenRouterClient('test-key', 'development');
    client.setPreferredModel('generator', 'model-a:free');
    client.setFallbackChain(['model-b:free', 'model-c:free']);

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
    expect(attemptedModels[0]).toBe('model-a:free');
    expect(attemptedModels).toContain('model-b:free');
    expect(attemptedModels.slice(-2)).toEqual(['model-b:free', 'model-c:free']);
  });
});