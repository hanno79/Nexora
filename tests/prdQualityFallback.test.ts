import { describe, it, expect } from 'vitest';
import { pickNextFallbackModel, pickBestDegradedResult } from '../server/prdQualityFallback';
import { PrdCompilerQualityError, qualityScore } from '../server/prdCompilerFinalizer';
import type { PrdQualityReport } from '../server/prdCompiler';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeQualityReport(overrides: Partial<PrdQualityReport> = {}): PrdQualityReport {
  return {
    valid: false,
    issues: [{ severity: 'error', code: 'test_error', message: 'test issue' }],
    featureCount: 2,
    missingSections: [],
    truncatedLikely: false,
    ...overrides,
  };
}

function makeMockClient(opts: {
  generator?: string;
  fallbackChain?: string[];
}) {
  const preferredModels: Record<string, string | undefined> = {
    generator: opts.generator || 'model-a',
  };
  const chain = opts.fallbackChain || ['model-b', 'model-c'];

  return {
    getPreferredModel(type: string) { return preferredModels[type]; },
    setPreferredModel(type: string, model: string) { preferredModels[type] = model; },
    getFallbackChain() { return chain; },
  } as any;
}

// ── pickNextFallbackModel ────────────────────────────────────────────────────

describe('pickNextFallbackModel', () => {
  it('returns first fallback model that differs from primary', () => {
    const client = makeMockClient({ generator: 'model-a', fallbackChain: ['model-a', 'model-b', 'model-c'] });
    const result = pickNextFallbackModel(client, 'model-a', []);
    expect(result).toBe('model-b');
  });

  it('skips models already tried in repair attempts', () => {
    const client = makeMockClient({ generator: 'model-a', fallbackChain: ['model-b', 'model-c', 'model-d'] });
    const result = pickNextFallbackModel(client, 'model-a', ['model-b']);
    expect(result).toBe('model-c');
  });

  it('returns null when no untried model available', () => {
    const client = makeMockClient({ generator: 'model-a', fallbackChain: ['model-a', 'model-b'] });
    const result = pickNextFallbackModel(client, 'model-a', ['model-b']);
    expect(result).toBeNull();
  });

  it('is case-insensitive for model comparison', () => {
    const client = makeMockClient({ generator: 'Model-A', fallbackChain: ['model-a', 'Model-B'] });
    const result = pickNextFallbackModel(client, 'Model-A', []);
    expect(result).toBe('Model-B');
  });

  it('returns null on empty fallback chain', () => {
    const client = makeMockClient({ generator: 'model-a', fallbackChain: [] });
    const result = pickNextFallbackModel(client, 'model-a', []);
    expect(result).toBeNull();
  });
});

// ── pickBestDegradedResult ───────────────────────────────────────────────────

describe('pickBestDegradedResult', () => {
  it('returns primary result when fallback is a non-quality error', () => {
    const primaryQuality = makeQualityReport({ featureCount: 3 });
    const primaryError = new PrdCompilerQualityError('primary failed', primaryQuality, [
      { content: 'primary repair content', model: 'model-a', usage: { prompt_tokens: 0, completion_tokens: 100, total_tokens: 100 } },
    ]);
    const fallbackError = new Error('network timeout');

    const result = pickBestDegradedResult(primaryError, fallbackError);
    expect(result).not.toBeNull();
    expect(result!.degraded).toBe(true);
    expect(result!.content).toBe('primary repair content');
  });

  it('returns fallback result when it has higher quality score', () => {
    const primaryQuality = makeQualityReport({
      issues: [
        { severity: 'error', code: 'e1', message: 'err1' },
        { severity: 'error', code: 'e2', message: 'err2' },
        { severity: 'error', code: 'e3', message: 'err3' },
      ],
      featureCount: 1,
    });
    const fallbackQuality = makeQualityReport({
      issues: [{ severity: 'warning', code: 'w1', message: 'warn1' }],
      featureCount: 5,
    });

    const primaryError = new PrdCompilerQualityError('primary', primaryQuality, [
      { content: 'primary content', model: 'model-a', usage: { prompt_tokens: 0, completion_tokens: 50, total_tokens: 50 } },
    ]);
    const fallbackError = new PrdCompilerQualityError('fallback', fallbackQuality, [
      { content: 'fallback content', model: 'model-b', usage: { prompt_tokens: 0, completion_tokens: 80, total_tokens: 80 } },
    ]);

    const result = pickBestDegradedResult(primaryError, fallbackError);
    expect(result).not.toBeNull();
    expect(result!.content).toBe('fallback content');
    expect(result!.degraded).toBe(true);
    // Fallback has higher score: 100 - 3 (1 warning) + 10 (5 features) = 107 vs primary 100 - 30 + 2 = 72
    expect(result!.qualityScore).toBeGreaterThan(qualityScore(primaryQuality));
  });

  it('returns null when neither has repair attempts', () => {
    const primaryError = new PrdCompilerQualityError('primary', makeQualityReport(), []);
    const fallbackError = new Error('runtime error');

    const result = pickBestDegradedResult(primaryError, fallbackError);
    expect(result).toBeNull();
  });

  it('merges repair attempts from both errors', () => {
    const primaryError = new PrdCompilerQualityError('primary', makeQualityReport(), [
      { content: 'repair-1', model: 'a', usage: { prompt_tokens: 0, completion_tokens: 10, total_tokens: 10 } },
    ]);
    const fallbackError = new PrdCompilerQualityError('fallback', makeQualityReport(), [
      { content: 'repair-2', model: 'b', usage: { prompt_tokens: 0, completion_tokens: 20, total_tokens: 20 } },
    ]);

    const result = pickBestDegradedResult(primaryError, fallbackError);
    expect(result).not.toBeNull();
    expect(result!.repairAttempts).toHaveLength(2);
  });
});
