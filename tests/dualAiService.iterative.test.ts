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
import { PrdCompilerQualityError, PrdCompilerRuntimeError } from '../server/prdCompilerFinalizer';
import { parsePRDToStructure } from '../server/prdParser';

function createUsage(total: number) {
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
      usage: createUsage(20),
      model: 'mock/reviewer:free',
      finishReason: 'stop',
      tier: 'development',
      usedFallback: false,
    });
    mockClient.getFallbackChain.mockReset();
    mockClient.getFallbackChain.mockReturnValue([]);
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
          usage: createUsage(20),
          sameFamilyFallback: false,
          blockedFamilies: [],
        },
        semanticVerificationHistory: [
          {
            verdict: 'pass',
            blockingIssues: [],
            model: 'mock/verifier:free',
            usage: createUsage(20),
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
      usage: createUsage(40),
      model: 'mock/generator:free',
      tier: 'development',
      usedFallback: false,
    });
    vi.spyOn(service as any, 'runIterationExpansionPhase').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'extractQuestionsWithFallback').mockResolvedValue(['What operational gap remains?']);
    vi.spyOn(service as any, 'runIterationAnswererPhase').mockResolvedValue({
      answerResult: {
        content: 'Resolve the remaining operational gap with deterministic retry handling.',
        usage: createUsage(30),
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
      usage: createUsage(40),
      model: 'mock/generator:free',
      tier: 'development',
      usedFallback: false,
    });
    vi.spyOn(service as any, 'runIterationExpansionPhase').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'extractQuestionsWithFallback').mockResolvedValue(['What operational gap remains?']);
    vi.spyOn(service as any, 'runIterationAnswererPhase').mockResolvedValue({
      answerResult: {
        content: 'Resolve the remaining operational gap with deterministic retry handling.',
        usage: createUsage(30),
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
          usage: createUsage(20),
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

  it('propagates aborts through the injected finalizer cancelCheck', async () => {
    const service = new DualAiService();
    const prd = buildMinimalPrdResponse(2, 'en');
    const abortController = new AbortController();
    let signalFinalizerStarted: (() => void) | undefined;
    const finalizerStarted = new Promise<void>((resolve) => {
      signalFinalizerStarted = resolve;
    });

    vi.spyOn(service as any, 'runIterationGeneratorPhase').mockResolvedValue({
      content: prd,
      usage: createUsage(40),
      model: 'mock/generator:free',
      tier: 'development',
      usedFallback: false,
    });
    vi.spyOn(service as any, 'runIterationExpansionPhase').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'extractQuestionsWithFallback').mockResolvedValue(['What operational gap remains?']);
    vi.spyOn(service as any, 'runIterationAnswererPhase').mockResolvedValue({
      answerResult: {
        content: 'Resolve the remaining operational gap with deterministic retry handling.',
        usage: createUsage(30),
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

    mockFinalizeWithCompilerGates.mockImplementationOnce(async (options: any) => {
      signalFinalizerStarted?.();
      await Promise.resolve();
      options.cancelCheck?.('semantic_verification');
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
        semanticVerificationHistory: [],
        semanticRepairApplied: false,
      };
    });

    const pending = service.generateIterative(
      prd,
      'Improve reliability and final verification.',
      'improve',
      2,
      false,
      'user-iterative-finalizer-cancel',
      undefined,
      undefined,
      abortController.signal,
      undefined,
      'feature',
    );

    await finalizerStarted;
    abortController.abort(new Error('client disconnected'));

    await expect(pending).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ERR_CLIENT_DISCONNECT',
    });

    expect(mockFinalizeWithCompilerGates).toHaveBeenCalledTimes(1);
    expect(mockFinalizeWithCompilerGates.mock.calls[0][0].cancelCheck).toEqual(expect.any(Function));
  });

  it('does not downgrade fallback finalizer aborts into degraded iterative results', async () => {
    const service = new DualAiService();
    const prd = buildMinimalPrdResponse(2, 'en');
    const abortController = new AbortController();
    let signalFallbackFinalizerStarted: (() => void) | undefined;
    let releaseFallbackFinalizer: (() => void) | undefined;
    const fallbackFinalizerStarted = new Promise<void>((resolve) => {
      signalFallbackFinalizerStarted = resolve;
    });
    const fallbackFinalizerGate = new Promise<void>((resolve) => {
      releaseFallbackFinalizer = resolve;
    });

    vi.spyOn(service as any, 'runIterationGeneratorPhase').mockResolvedValue({
      content: prd,
      usage: createUsage(40),
      model: 'mock/generator:free',
      tier: 'development',
      usedFallback: false,
    });
    vi.spyOn(service as any, 'runIterationExpansionPhase').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'extractQuestionsWithFallback').mockResolvedValue(['What operational gap remains?']);
    vi.spyOn(service as any, 'runIterationAnswererPhase').mockResolvedValue({
      answerResult: {
        content: 'Resolve the remaining operational gap with deterministic retry handling.',
        usage: createUsage(30),
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

    mockClient.getFallbackChain.mockReturnValue(['mock/generator-fallback:free']);
    mockFinalizeWithCompilerGates
      .mockRejectedValueOnce(
        new PrdCompilerQualityError(
          'Fallback-worthy compiler repair failure.',
          {
            valid: false,
            issues: [{ code: 'truncated_output', message: 'Document remains incomplete.', severity: 'error' }],
            featureCount: 2,
            truncatedLikely: true,
            missingSections: ['System Vision'],
            fallbackSections: [],
          } as any,
          [],
          undefined,
          {
            failureStage: 'repair_review' as any,
          },
        ),
      )
      .mockImplementationOnce(async (options: any) => {
        signalFallbackFinalizerStarted?.();
        await fallbackFinalizerGate;
        options.cancelCheck?.('semantic_verification');
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
          semanticVerificationHistory: [],
          semanticRepairApplied: false,
        };
      });

    const pending = service.generateIterative(
      prd,
      'Improve reliability and final verification.',
      'improve',
      2,
      false,
      'user-iterative-finalizer-fallback-cancel',
      undefined,
      undefined,
      abortController.signal,
      undefined,
      'feature',
    );

    await fallbackFinalizerStarted;
    abortController.abort(new Error('client disconnected'));
    releaseFallbackFinalizer?.();

    await expect(pending).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ERR_CLIENT_DISCONNECT',
    });

    expect(mockFinalizeWithCompilerGates).toHaveBeenCalledTimes(2);
    expect(mockFinalizeWithCompilerGates.mock.calls[1][0].cancelCheck).toEqual(expect.any(Function));
  });

  it('preserves semantic quality diagnostics when compiler finalization fails', async () => {
    const service = new DualAiService();
    const prd = buildMinimalPrdResponse(2, 'en');

    vi.spyOn(service as any, 'runIterationGeneratorPhase').mockResolvedValue({
      content: prd,
      usage: createUsage(40),
      model: 'mock/generator:free',
      tier: 'development',
      usedFallback: false,
    });
    vi.spyOn(service as any, 'runIterationExpansionPhase').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'extractQuestionsWithFallback').mockResolvedValue(['What operational gap remains?']);
    vi.spyOn(service as any, 'runIterationAnswererPhase').mockResolvedValue({
      answerResult: {
        content: 'Resolve the remaining operational gap with deterministic retry handling.',
        usage: createUsage(30),
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

    mockFinalizeWithCompilerGates.mockRejectedValue(
      new PrdCompilerQualityError(
        'PRD compiler quality gate failed after semantic verification.',
        {
          valid: false,
          issues: [
            {
              code: 'cross_section_inconsistency',
              message: 'Definition of Done conflicts with milestone rollout.',
              severity: 'error',
            },
          ],
          featureCount: 2,
          truncatedLikely: false,
          missingSections: [],
          fallbackSections: [],
        } as any,
        [],
        undefined,
        {
          failureStage: 'semantic_verifier',
          semanticVerification: {
            verdict: 'fail',
            blockingIssues: [
              {
                code: 'cross_section_inconsistency',
                message: 'Definition of Done conflicts with milestone rollout.',
              },
            ],
            model: 'mock/verifier:free',
            usage: createUsage(20),
            sameFamilyFallback: false,
            blockedFamilies: [],
          },
          semanticRepairApplied: true,
          compilerRepairTruncationCount: 2,
          compilerRepairFinishReasons: ['length', 'length'],
          repairRejected: true,
          repairRejectedReason: 'Rejected compiler repair because required feature fields were replaced by placeholders.',
          repairDegradationSignals: ['placeholder_required_fields'],
          degradedCandidateAvailable: true,
          degradedCandidateSource: 'pre_repair_best',
          collapsedFeatureNameIds: ['F-01'],
          placeholderFeatureIds: ['F-01', 'F-02'],
          acceptanceBoilerplateFeatureIds: ['F-02'],
          featureQualityFloorFeatureIds: ['F-01', 'F-02'],
        },
      )
    );

    await expect(
      service.generateIterative(
        prd,
        'Improve reliability and final verification.',
        'improve',
        2,
        true,
        'user-iterative',
        undefined,
        undefined,
        undefined,
        undefined,
        'feature',
      )
    ).rejects.toMatchObject({
      name: 'PrdCompilerQualityError',
      message: 'Unified compiler finalization failed: PRD compiler quality gate failed after semantic verification.',
      failureStage: 'semantic_verifier',
      semanticRepairApplied: true,
      compilerRepairTruncationCount: 2,
      compilerRepairFinishReasons: ['length', 'length'],
      repairRejected: true,
      repairRejectedReason: 'Rejected compiler repair because required feature fields were replaced by placeholders.',
      repairDegradationSignals: ['placeholder_required_fields'],
      degradedCandidateAvailable: true,
      degradedCandidateSource: 'pre_repair_best',
      collapsedFeatureNameIds: ['F-01'],
      placeholderFeatureIds: ['F-01', 'F-02'],
      acceptanceBoilerplateFeatureIds: ['F-02'],
      featureQualityFloorFeatureIds: ['F-01', 'F-02'],
      semanticVerification: {
        verdict: 'fail',
        blockingIssues: [
          expect.objectContaining({ code: 'cross_section_inconsistency' }),
        ],
      },
    });
  });

  it('detects improve-mode drift when baseline features are replaced by unrelated feature families', () => {
    const service = new DualAiService();
    const baseline = parsePRDToStructure(buildMinimalPrdResponse(2, 'en'));
    const candidate = parsePRDToStructure(
      buildMinimalPrdResponse(2, 'en')
        .replace('PRD Authoring Workflow', 'Competitive Matchmaking')
        .replace('Quality Gate Evaluation', 'Kubernetes Cluster Provisioning')
        .replace(
          'Web application with authenticated users, REST API, and PostgreSQL database. External integrations via OpenRouter.',
          'Competitive multiplayer gaming platform for streamers with Kubernetes orchestration, S3 asset storage, and leaderboard infrastructure.'
        )
    );

    const evaluation = (service as any).collectImproveDriftEvaluation({
      baselineStructure: baseline,
      candidateStructure: candidate,
      workflowInputText: 'Improve the baseline product without adding new scope.',
      language: 'en',
      blockedAddedFeatures: ['F-09: Competitive Matchmaking'],
    });

    expect(evaluation.blockingIssues.map((issue: any) => issue.code)).toEqual(
      expect.arrayContaining(['feature_scope_drift_detected', 'section_anchor_mismatch', 'baseline_scope_contradiction'])
    );
    expect(evaluation.blockedAddedFeatures).toEqual(['F-09: Competitive Matchmaking']);
    expect(evaluation.primaryReason).toContain('Affected sections');
  });

  it('preserves finalizer runtime failures as failed_runtime candidates', async () => {
    const service = new DualAiService();
    const existingContent = buildMinimalPrdResponse(2, 'en');

    vi.spyOn(service as any, 'runIterationGeneratorPhase').mockResolvedValue({
      content: existingContent,
      usage: createUsage(40),
      model: 'mock/generator:free',
      tier: 'development',
      usedFallback: false,
    });
    vi.spyOn(service as any, 'runIterationExpansionPhase').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'extractQuestionsWithFallback').mockResolvedValue(['What operational gap remains?']);
    vi.spyOn(service as any, 'runIterationAnswererPhase').mockResolvedValue({
      answerResult: {
        content: 'Resolve the remaining operational gap with deterministic retry handling.',
        usage: createUsage(30),
        model: 'mock/reviewer:free',
        tier: 'development',
        usedFallback: false,
      },
      answererOutputTruncated: false,
    });
    vi.spyOn(service as any, 'validateAndPreserveIterationStructure').mockResolvedValue({
      shouldContinue: false,
      preservedPRD: existingContent,
      candidateStructure: null,
    });

    mockFinalizeWithCompilerGates.mockRejectedValueOnce(
      new PrdCompilerRuntimeError({
        message: 'All 7 configured AI models are temporarily unavailable. Failure summary: 5 rate-limited, 2 timed out.',
        failureStage: 'compiler_repair',
        providerFailureStage: 'compiler_repair',
        runtimeFailureCode: 'provider_exhaustion',
        providerFailureSummary: '5 rate-limited, 2 timed out.',
        providerFailureCounts: {
          rateLimited: 5,
          timedOut: 2,
          provider4xx: 0,
          emptyResponse: 0,
        },
        providerFailedModels: ['gpt-oss-120b', 'qwen/qwen3-coder:free'],
        compiledResult: {
          content: '## System Vision\nRecovered pre-finalizer candidate',
          structure: { features: [], otherSections: {} } as any,
        },
        degradedCandidateAvailable: true,
        degradedCandidateSource: 'pre_repair_best',
      }),
    );

    await expect(
      service.generateIterative(
        existingContent,
        'Improve reliability and final verification.',
        'improve',
        2,
        true,
        'user-runtime',
        undefined,
        undefined,
        undefined,
        undefined,
        'feature',
      )
    ).rejects.toMatchObject({
      name: 'PrdCompilerRuntimeError',
      message: 'Unified compiler finalization failed: All 7 configured AI models are temporarily unavailable. Failure summary: 5 rate-limited, 2 timed out.',
      runtimeFailureCode: 'provider_exhaustion',
      providerFailureStage: 'compiler_repair',
      providerFailedModels: ['gpt-oss-120b', 'qwen/qwen3-coder:free'],
      degradedCandidateAvailable: true,
      degradedCandidateSource: 'pre_repair_best',
    });
  });

  it('targets feature evidence and business rules when deterministic schema drift is detected', () => {
    const service = new DualAiService();
    const candidateMarkdown = [
      '## System Vision',
      'A browser-based Tetris webapp stores score progression and exposes a personal best widget.',
      '',
      '## System Boundaries',
      'The system includes a React frontend, a Node.js backend API, and PostgreSQL persistence.',
      '',
      '## Domain Model',
      '- PlayerProfile (playerId, playerScore, bestScore)',
      '- GameSession (sessionId, playerId, score)',
      '',
      '## Global Business Rules',
      '- Personal best score retrieval must respect cooldown between repeated refresh attempts.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Personal Best Widget',
      '1. Purpose',
      'Show the player best score on the dashboard.',
      '2. Actors',
      'Player, backend API.',
      '3. Trigger',
      'The player opens the dashboard.',
      '4. Preconditions',
      'The player is authenticated.',
      '5. Main Flow',
      '1. The backend reads the best score for the player.',
      '6. Alternate Flows',
      '1. If no score exists, the widget renders zero.',
      '7. Postconditions',
      'The player sees the latest best score.',
      '8. Data Impact',
      'Reads PlayerProfile.player_scores and renders the current best score.',
      '9. UI Impact',
      'The dashboard shows the personal best card.',
      '10. Acceptance Criteria',
      '- [ ] The best score card renders correctly.',
      '',
      '## Non-Functional Requirements',
      '- Personal best queries complete within 300 ms at p95 latency.',
      '',
      '## Error Handling & Recovery',
      '- Score lookup failures show a retry message.',
      '',
      '## Deployment & Infrastructure',
      '- The Node.js API runs behind an authenticated edge gateway with PostgreSQL persistence.',
      '',
      '## Definition of Done',
      '- The personal best widget ships with automated tests.',
      '',
      '## Out of Scope',
      '- Native mobile applications are not part of this release.',
      '',
      '## Timeline & Milestones',
      '- Phase 1 delivers scoring, Phase 2 delivers dashboard refinements.',
      '',
      '## Success Criteria & Acceptance Testing',
      '- Players can see their best score without storage regressions.',
    ].join('\n');
    const baseline = parsePRDToStructure(candidateMarkdown);
    const candidate = parsePRDToStructure(candidateMarkdown);

    const evaluation = (service as any).collectImproveDriftEvaluation({
      baselineStructure: baseline,
      candidateStructure: candidate,
      workflowInputText: 'Improve the existing dashboard experience without widening scope.',
      language: 'en',
      blockedAddedFeatures: [],
    });

    // rule_schema_property_coverage_missing ist jetzt severity 'warning'
    // und wird daher nicht mehr als blockingIssue aufgenommen (nur errors).
    expect(evaluation.blockingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'schema_field_identifier_mismatch',
        sectionKey: 'domainModel',
      }),
      expect.objectContaining({
        code: 'schema_field_identifier_mismatch',
        sectionKey: 'feature:F-01',
      }),
    ]));
  });
});
