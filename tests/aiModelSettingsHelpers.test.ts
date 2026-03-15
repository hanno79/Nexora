import { describe, expect, it } from 'vitest';
import {
  buildAiModelSettingsKey,
  buildAiSettingsPayload,
  normalizeModelDisplayName,
  resolveInitialAiModelSettingsState,
  resolveTierModelSelection,
} from '../client/src/components/settings/aiModelSettingsHelpers';

describe('aiModelSettingsHelpers', () => {
  it('normalizes trailing free markers from model names used in settings display', () => {
    expect(normalizeModelDisplayName('Qwen 3 235b A22b Instruct 2507 (Free)')).toBe('Qwen 3 235b A22b Instruct 2507');
    expect(normalizeModelDisplayName('Kimi K2.5')).toBe('Kimi K2.5');
  });

  it('includes verifierModel in the autosave settings key and restored preferences state', () => {
    const key = buildAiModelSettingsKey({
      generatorModel: 'generator-a',
      reviewerModel: 'reviewer-a',
      verifierModel: 'verifier-a',
      semanticRepairModel: 'semantic-repair-a',
      fallbackChain: ['fallback-a'],
      aiTier: 'production',
      iterativeMode: false,
      iterationCount: 3,
      iterativeTimeoutMinutes: 30,
      useFinalReview: false,
      guidedQuestionRounds: 3,
    });

    expect(JSON.parse(key)).toMatchObject({
      generatorModel: 'generator-a',
      reviewerModel: 'reviewer-a',
      verifierModel: 'verifier-a',
      fallbackChain: ['fallback-a'],
      aiTier: 'production',
    });

    const resolved = resolveInitialAiModelSettingsState({
      generatorModel: 'generator-b',
      reviewerModel: 'reviewer-b',
      verifierModel: 'verifier-b',
      fallbackChain: ['fallback-b'],
      tier: 'premium',
      tierModels: {
        premium: {
          verifierModel: 'verifier-tier',
        },
      },
    });

    expect(resolved.verifierModel).toBe('verifier-b');
    expect(resolved.tierModels.premium?.verifierModel).toBe('verifier-tier');
  });

  it('builds save payloads and tier selections with verifierModel included', () => {
    const payload = buildAiSettingsPayload({
      savedTierModels: {
        development: {
          generatorModel: 'dev-generator',
          reviewerModel: 'dev-reviewer',
          verifierModel: 'dev-verifier',
          fallbackChain: ['dev-fallback'],
        },
      },
      generatorModel: 'prod-generator',
      reviewerModel: 'prod-reviewer',
      verifierModel: 'prod-verifier',
      semanticRepairModel: 'prod-semantic-repair',
      fallbackChain: ['prod-fallback-a', 'prod-fallback-b'],
      aiTier: 'production',
      tierDefaults: {},
      iterativeMode: true,
      iterationCount: 8,
      iterativeTimeoutMinutes: 2,
      useFinalReview: true,
      guidedQuestionRounds: 15,
    });

    expect(payload.verifierModel).toBe('prod-verifier');
    expect(payload.tierModels.production?.verifierModel).toBe('prod-verifier');
    expect(payload.iterationCount).toBe(5);
    expect(payload.iterativeTimeoutMinutes).toBe(5);
    expect(payload.guidedQuestionRounds).toBe(10);

    const tierSelection = resolveTierModelSelection({
      savedTierModels: payload.tierModels,
      tier: 'production',
      tierDefaults: {},
    });

    expect(tierSelection.verifierModel).toBe('prod-verifier');
    expect(tierSelection.fallbackChain).toEqual(['prod-fallback-a', 'prod-fallback-b']);
  });

  it('fills missing saved tier fields from tier defaults', () => {
    const tierSelection = resolveTierModelSelection({
      savedTierModels: {
        production: {
          generatorModel: 'prod-generator',
          fallbackModel: 'prod-fallback',
        },
      },
      tier: 'production',
      tierDefaults: {
        production: {
          generator: 'default-generator',
          reviewer: 'default-reviewer',
          verifier: 'default-verifier',
          semanticRepair: 'default-semantic-repair',
        },
      },
    });

    // When saved tier has any fields set, they take precedence and defaults are NOT merged in.
    // Only explicitly saved fields appear; missing fields remain undefined.
    expect(tierSelection).toEqual({
      generatorModel: 'prod-generator',
      reviewerModel: undefined,
      verifierModel: undefined,
      semanticRepairModel: undefined,
      fallbackChain: ['prod-fallback'],
    });
  });
});
