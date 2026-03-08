import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMinimalPrdResponse } from './helpers/mockOpenRouter';

const { mockClient, mockFinalizeWithCompilerGates } = vi.hoisted(() => {
  const usage = { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 };
  const mockClient: any = {
    __defaultExecutionContext: undefined as any,
    callWithFallback: vi.fn(async () => ({
      content: 'Final review completed.',
      usage,
      model: 'mock/reviewer:free',
      finishReason: 'stop',
      tier: 'development',
      usedFallback: false,
    })),
    getPreferredModel: vi.fn((role: string) => `mock/${role}:free`),
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
    setDefaultExecutionContext: vi.fn((context?: any) => {
      mockClient.__defaultExecutionContext = context;
    }),
  };

  const mockFinalizeWithCompilerGates = vi.fn(async (options: any) => {
    options.onStageProgress?.({ type: 'content_review_start' });
    options.onStageProgress?.({ type: 'semantic_verification_start' });
    return {
      content: '## System Vision\nPlaceholder',
      structure: { features: [], otherSections: {} },
      quality: {
        valid: true,
        issues: [],
        featureCount: 0,
        truncatedLikely: false,
        missingSections: [],
      },
      qualityScore: 100,
      repairAttempts: [],
      reviewerAttempts: [],
      semanticVerification: {
        verdict: 'pass',
        blockingIssues: [],
        model: 'mock/verifier:free',
        usage,
        sameFamilyFallback: false,
        blockedFamilies: [],
      },
      semanticVerificationHistory: [
        {
          verdict: 'pass',
          blockingIssues: [],
          model: 'mock/verifier:free',
          usage,
          sameFamilyFallback: false,
          blockedFamilies: [],
        },
      ],
      semanticRepairApplied: false,
    };
  });

  return { mockClient, mockFinalizeWithCompilerGates };
});

vi.mock('../server/db', () => ({ db: {}, pool: {} }));
vi.mock('../server/openrouter', () => ({
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

import { DualAiService } from '../server/dualAiService';

function usage(total: number) {
  return {
    prompt_tokens: Math.floor(total / 2),
    completion_tokens: total - Math.floor(total / 2),
    total_tokens: total,
  };
}

describe('DualAiService iterative reviewer-first flow', () => {
  beforeEach(() => {
    mockClient.callWithFallback.mockReset();
    mockClient.callWithFallback.mockResolvedValue({
      content: 'Final review completed.',
      usage: usage(20),
      model: 'mock/reviewer:free',
      finishReason: 'stop',
      tier: 'development',
      usedFallback: false,
    });
    mockClient.getPreferredModel.mockClear();
    mockClient.setPreferredModel.mockClear();
    mockClient.setDefaultExecutionContext.mockClear();
    mockClient.__defaultExecutionContext = undefined;
    mockFinalizeWithCompilerGates.mockReset();
    mockFinalizeWithCompilerGates.mockImplementation(async (options: any) => {
      options.onStageProgress?.({ type: 'content_review_start' });
      options.onStageProgress?.({ type: 'semantic_verification_start' });
      return {
        content: buildMinimalPrdResponse(2, 'en'),
        structure: { features: [], otherSections: {} },
        quality: {
          valid: true,
          issues: [],
          featureCount: 2,
          truncatedLikely: false,
          missingSections: [],
        },
        qualityScore: 100,
        repairAttempts: [],
        reviewerAttempts: [],
        semanticVerification: {
          verdict: 'pass',
          blockingIssues: [],
          model: 'mock/verifier:free',
          usage: usage(20),
          sameFamilyFallback: false,
          blockedFamilies: [],
        },
        semanticVerificationHistory: [
          {
            verdict: 'pass',
            blockingIssues: [],
            model: 'mock/verifier:free',
            usage: usage(20),
            sameFamilyFallback: false,
            blockedFamilies: [],
          },
        ],
        semanticRepairApplied: false,
      };
    });
  });

  it('emits visible compiler progress after final review before completion', async () => {
    const service = new DualAiService();
    const prd = buildMinimalPrdResponse(2, 'en');
    const events: string[] = [];

    vi.spyOn(service as any, 'runIterationGeneratorPhase').mockResolvedValue({
      content: prd,
      usage: usage(40),
      model: 'mock/generator:free',
      tier: 'development',
      usedFallback: false,
    });
    vi.spyOn(service as any, 'runIterationExpansionPhase').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'extractQuestionsWithFallback').mockResolvedValue(['What operational gap remains?']);
    vi.spyOn(service as any, 'runIterationAnswererPhase').mockResolvedValue({
      answerResult: {
        content: 'Resolve the remaining operational gap with deterministic retry handling.',
        usage: usage(30),
        model: 'mock/reviewer:free',
        tier: 'development',
        usedFallback: false,
      },
      answererOutputTruncated: false,
    });
    vi.spyOn(service as any, 'validateAndPreserveIterationStructure').mockResolvedValue({
      shouldContinue: false,
      preservedPRD: prd,
      candidateStructure: null,
    });

    await service.generateIterative(
      prd,
      'Improve reliability and final verification.',
      'improve',
      2,
      true,
      'user-iterative',
      (event) => events.push(event.type),
      undefined,
      undefined,
      undefined,
      'feature',
    );

    const finalReviewDoneIndex = events.indexOf('final_review_done');
    expect(finalReviewDoneIndex).toBeGreaterThan(-1);
    expect(events.slice(finalReviewDoneIndex, finalReviewDoneIndex + 4)).toEqual([
      'final_review_done',
      'compiler_finalization_start',
      'content_review_start',
      'semantic_verification_start',
    ]);
    expect(mockFinalizeWithCompilerGates).toHaveBeenCalledTimes(1);
  });

  it('aborts a hanging final reviewer call when the iterative abort signal fires', async () => {
    const service = new DualAiService();
    const prd = buildMinimalPrdResponse(2, 'en');
    const abortController = new AbortController();
    const attemptUpdates: any[] = [];
    let signalFinalReviewStarted: (() => void) | undefined;
    const finalReviewStarted = new Promise<void>((resolve) => {
      signalFinalReviewStarted = resolve;
    });

    vi.spyOn(service as any, 'runIterationGeneratorPhase').mockResolvedValue({
      content: prd,
      usage: usage(40),
      model: 'mock/generator:free',
      tier: 'development',
      usedFallback: false,
    });
    vi.spyOn(service as any, 'runIterationExpansionPhase').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'extractQuestionsWithFallback').mockResolvedValue(['What operational gap remains?']);
    vi.spyOn(service as any, 'runIterationAnswererPhase').mockResolvedValue({
      answerResult: {
        content: 'Resolve the remaining operational gap with deterministic retry handling.',
        usage: usage(30),
        model: 'mock/reviewer:free',
        tier: 'development',
        usedFallback: false,
      },
      answererOutputTruncated: false,
    });
    vi.spyOn(service as any, 'validateAndPreserveIterationStructure').mockResolvedValue({
      shouldContinue: false,
      preservedPRD: prd,
      candidateStructure: null,
    });

    mockClient.callWithFallback.mockImplementation(async (
      modelType: string,
      _systemPrompt: string,
      _userPrompt: string,
      _maxTokens: number,
      _responseFormat: any,
      _temperature: any,
      constraints?: any,
    ) => {
      if (constraints?.phase !== 'final_review') {
        return {
          content: 'ok',
          usage: usage(20),
          model: `mock/${modelType}:free`,
          finishReason: 'stop',
          tier: 'development',
          usedFallback: false,
        };
      }

      constraints?.onAttemptUpdate?.({
        role: modelType,
        model: 'mock/reviewer:free',
        phase: 'final_review',
        provider: 'openrouter',
        status: 'started',
        startedAt: '2026-03-08T11:00:00.000Z',
      });
      signalFinalReviewStarted?.();

      return await new Promise((_resolve, reject) => {
        const abortSignal = constraints?.abortSignal as AbortSignal | undefined;
        abortSignal?.addEventListener('abort', () => {
          constraints?.onAttemptUpdate?.({
            role: modelType,
            model: 'mock/reviewer:free',
            phase: 'final_review',
            provider: 'openrouter',
            status: 'aborted',
            startedAt: '2026-03-08T11:00:00.000Z',
            endedAt: '2026-03-08T11:00:00.015Z',
            durationMs: 15,
            errorMessage: 'aborted by client',
          });
          const abortError: any = new Error('Model mock/reviewer:free aborted by caller.');
          abortError.name = 'AbortError';
          abortError.code = 'ERR_CLIENT_DISCONNECT';
          reject(abortError);
        }, { once: true });
      });
    });

    const pending = service.generateIterative(
      prd,
      'Improve reliability and final verification.',
      'improve',
      2,
      true,
      'user-iterative',
      undefined,
      undefined,
      abortController.signal,
      (attempt) => attemptUpdates.push(attempt),
      'feature',
    );

    await finalReviewStarted;
    abortController.abort(new Error('client disconnected'));

    await expect(pending).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ERR_CLIENT_DISCONNECT',
    });

    expect(mockFinalizeWithCompilerGates).not.toHaveBeenCalled();
    expect(mockClient.setDefaultExecutionContext).toHaveBeenCalled();
    expect(attemptUpdates.at(-1)?.status).toBe('aborted');
    expect(attemptUpdates.at(-1)?.phase).toBe('final_review');
  });
});
