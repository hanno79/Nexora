import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTENT_REVIEW_REFINE } from '../server/tokenBudgets';
import { buildMinimalPrdResponse } from './helpers/mockOpenRouter';

const { mockClient, mockFinalizeWithCompilerGates } = vi.hoisted(() => {
  const usage = { prompt_tokens: 50, completion_tokens: 75, total_tokens: 125 };
  const mockClient = {
    callWithFallback: vi.fn(async () => ({
      content: '## System Vision\nMock content',
      usage,
      model: 'mock/generator:free',
      finishReason: 'stop',
      tier: 'development',
      usedFallback: false,
    })),
    getPreferredModel: vi.fn(() => 'mock/generator:free'),
    setPreferredModel: vi.fn(),
    setPreferredTier: vi.fn(),
    setFallbackChain: vi.fn(),
    getFallbackChain: vi.fn(() => []),
    getTier: vi.fn(() => 'development'),
    getModels: vi.fn(() => ({
      generator: 'mock/generator:free',
      reviewer: 'mock/reviewer:free',
      verifier: 'mock/verifier:free',
      cost: '$0/Million Tokens',
    })),
  };

  const mockFinalizeWithCompilerGates = vi.fn(async () => ({
    content: '## System Vision\nFinalized guided content',
    quality: { valid: true, issues: [], featureCount: 3, truncatedLikely: false },
    qualityScore: 100,
    repairAttempts: [],
    reviewerAttempts: [],
    semanticVerificationHistory: [],
    structure: undefined,
  }));

  return { mockClient, mockFinalizeWithCompilerGates };
});

vi.mock('../server/db', () => ({ db: {}, pool: {} }));
vi.mock('../server/openrouter', () => ({
  getOpenRouterClient: vi.fn(() => mockClient),
  createClientWithUserPreferences: vi.fn(async () => ({
    client: mockClient,
    contentLanguage: 'en',
  })),
}));
vi.mock('../server/prdCompilerFinalizer', async () => {
  const actual = await vi.importActual<typeof import('../server/prdCompilerFinalizer')>('../server/prdCompilerFinalizer');
  return {
    ...actual,
    finalizeWithCompilerGates: mockFinalizeWithCompilerGates,
  };
});

import { GuidedAiService } from '../server/guidedAiService';

describe('GuidedAiService', () => {
  beforeEach(() => {
    mockClient.callWithFallback.mockClear();
    mockFinalizeWithCompilerGates.mockClear();
  });

  it('übergibt im Guided-Improve-Flow Reviewer- und Verifier-Hooks an den Finalizer', async () => {
    const service = new GuidedAiService({ cleanupExpired: vi.fn() } as any);

    await service.skipToFinalize('Improve reliability and auditability.', 'user-guided', {
      mode: 'improve',
      existingContent: buildMinimalPrdResponse(3, 'en'),
      templateCategory: 'feature',
    });

    expect(mockFinalizeWithCompilerGates).toHaveBeenCalledTimes(1);
    const finalizerOptions = mockFinalizeWithCompilerGates.mock.calls[0][0];
    expect(finalizerOptions.mode).toBe('improve');
    expect(finalizerOptions.templateCategory).toBe('feature');
    expect(typeof finalizerOptions.contentRefineReviewer).toBe('function');
    expect(typeof finalizerOptions.semanticVerifier).toBe('function');

    await finalizerOptions.contentRefineReviewer('Bitte den Inhalt präzisieren.');

    const refineCall = mockClient.callWithFallback.mock.calls.find(
      ([, , prompt]) => prompt === 'Bitte den Inhalt präzisieren.',
    );

    expect(refineCall).toBeTruthy();
    expect(refineCall?.[0]).toBe('reviewer');
    expect(String(refineCall?.[1])).toContain('PRD content refinement specialist');
    expect(refineCall?.[3]).toBe(CONTENT_REVIEW_REFINE);

    mockClient.callWithFallback.mockResolvedValueOnce({
      content: '{"verdict":"pass","blockingIssues":[]}',
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      model: 'mock/verifier:free',
      finishReason: 'stop',
      tier: 'development',
      usedFallback: false,
    });

    await finalizerOptions.semanticVerifier({
      content: '## System Vision\nVerifier target',
      structure: { features: [], otherSections: {} },
      mode: 'improve',
      existingContent: buildMinimalPrdResponse(3, 'en'),
      language: 'en',
      templateCategory: 'feature',
      originalRequest: 'Improve reliability and auditability.',
      avoidModelFamilies: ['gemini', 'claude'],
    });

    const verifierCall = mockClient.callWithFallback.mock.calls.find(
      ([modelType]) => modelType === 'verifier',
    );

    expect(verifierCall).toBeTruthy();
    expect(verifierCall?.[6]).toMatchObject({
      avoidModelFamilies: ['gemini', 'claude'],
      allowSameFamilyFallback: true,
    });
  });
});
