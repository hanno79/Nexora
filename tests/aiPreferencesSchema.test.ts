import { describe, expect, it } from 'vitest';
import { aiPreferencesSchema } from '../shared/schema';

describe('aiPreferencesSchema', () => {
  it('accepts verifierModel at global and tier scope', () => {
    const parsed = aiPreferencesSchema.parse({
      tier: 'production',
      generatorModel: 'google/gemini-2.5-flash',
      reviewerModel: 'anthropic/claude-sonnet-4',
      verifierModel: 'anthropic/claude-sonnet-4',
      tierModels: {
        production: {
          generatorModel: 'google/gemini-2.5-flash',
          reviewerModel: 'anthropic/claude-sonnet-4',
          verifierModel: 'anthropic/claude-sonnet-4',
        },
      },
    });

    expect(parsed.verifierModel).toBe('anthropic/claude-sonnet-4');
    expect(parsed.tierModels?.production?.verifierModel).toBe('anthropic/claude-sonnet-4');
  });
});
