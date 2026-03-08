import { describe, expect, it, vi } from 'vitest';
import { buildMinimalPrdResponse } from './helpers/mockOpenRouter';

let capturedFeatureList = '';

vi.mock('../server/services/llm/expandFeature', () => ({
  expandAllFeatures: vi.fn(async (
    _userInput: string,
    _vision: string,
    featureListText: string,
  ) => {
    capturedFeatureList = featureListText;
    return {
      expandedFeatures: [],
      totalTokens: 0,
      modelsUsed: [],
    };
  }),
}));

import { runFeatureExpansionPipeline } from '../server/prdFeatureExpansion';

describe('prdFeatureExpansion improve-mode constraints', () => {
  it('reuses baseline feature ids and blocks new draft-only features when discovery is disabled', async () => {
    capturedFeatureList = '';
    const draftContent = `${buildMinimalPrdResponse(2, 'en')}\n\n### F-09: Competitive Matchmaking\n\n1. Purpose\nAdds a new multiplayer feature family.\n`;

    const result = await runFeatureExpansionPipeline({
      inputText: 'Improve the baseline Tetris scope without widening it.',
      draftContent,
      client: {} as any,
      language: 'en',
      allowFeatureDiscovery: false,
      allowedFeatureIds: ['F-01', 'F-02'],
    });

    expect(result.featureListModel).toBe('existing-feature-catalogue');
    expect(result.blockedFeatureIds).toEqual(['F-09: Competitive Matchmaking']);
    expect(capturedFeatureList).toContain('F-01:');
    expect(capturedFeatureList).toContain('F-02:');
    expect(capturedFeatureList).not.toContain('F-09: Competitive Matchmaking');
  });
});
