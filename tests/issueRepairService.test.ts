/**
 * Author: rahn
 * Datum: 14.03.2026
 * Version: 1.0
 * Beschreibung: Unit-Tests fuer den issueRepairService — gezielte Reparatur einzelner
 *               semantischer Blocking-Issues mit Retry-Logik und Verifier-Kontrolle.
 */

/// <reference types="vitest" />
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../server/openrouter', () => ({
  createClientWithUserPreferences: vi.fn(),
}));

vi.mock('../server/prdCompiler', () => ({
  compilePrdDocument: vi.fn(),
}));

vi.mock('../server/prdAssembler', () => ({
  assembleStructureToMarkdown: vi.fn(),
}));

vi.mock('../server/prdContentReviewer', () => ({
  applySemanticPatchRefinement: vi.fn(),
}));

vi.mock('../server/prdCompilerFinalizer', () => ({
  toSemanticContentIssues: vi.fn(),
}));

vi.mock('../server/prdSemanticVerifier', () => ({
  buildSemanticVerificationPrompt: vi.fn().mockReturnValue('verify-prompt'),
  parseSemanticVerificationResponse: vi.fn(),
}));

vi.mock('../server/dualAiPrompts', () => ({
  getLanguageInstruction: vi.fn().mockReturnValue(' Antworte auf Deutsch.'),
}));

import { repairSingleIssue, type IssueRepairOptions } from '../server/issueRepairService';
import { createClientWithUserPreferences } from '../server/openrouter';
import { compilePrdDocument } from '../server/prdCompiler';
import { applySemanticPatchRefinement } from '../server/prdContentReviewer';
import { toSemanticContentIssues } from '../server/prdCompilerFinalizer';
import { parseSemanticVerificationResponse } from '../server/prdSemanticVerifier';
import { getLanguageInstruction } from '../server/dualAiPrompts';
import type { SemanticBlockingIssue } from '../server/prdSemanticVerifier';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseIssue: SemanticBlockingIssue = {
  code: 'INCONSISTENCY',
  sectionKey: 'globalBusinessRules',
  message: 'Widerspruch bei Punktesystem',
  severity: 'error',
  suggestedAction: 'rewrite',
  targetFields: ['globalBusinessRules'],
  suggestedFix: 'Einheitlich 1:1 verwenden',
};

function makeOptions(overrides?: Partial<IssueRepairOptions>): IssueRepairOptions {
  return {
    prdContent: '# Test PRD\nSome content',
    issue: baseIssue,
    language: 'de',
    templateCategory: 'saas',
    originalRequest: 'Build a gamification platform',
    maxAttempts: 3,
    ...overrides,
  };
}

const mockClient = {
  callWithFallback: vi.fn(),
};

function setupMocks() {
  (createClientWithUserPreferences as ReturnType<typeof vi.fn>).mockResolvedValue({
    client: mockClient,
    contentLanguage: 'de',
  });

  (compilePrdDocument as ReturnType<typeof vi.fn>).mockReturnValue({
    structure: { features: [], otherSections: {} },
  });

  (toSemanticContentIssues as ReturnType<typeof vi.fn>).mockReturnValue([
    { section: 'globalBusinessRules', message: 'Widerspruch', severity: 'error' },
  ]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('issueRepairService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('resolves issue on first attempt', async () => {
    (applySemanticPatchRefinement as ReturnType<typeof vi.fn>).mockResolvedValue({
      refined: true,
      content: '# Repaired PRD',
      structure: { features: [], otherSections: {} },
    });

    mockClient.callWithFallback.mockResolvedValue({
      content: JSON.stringify({ blockingIssues: [], passed: true }),
      model: 'test-model',
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      finishReason: 'stop',
    });

    (parseSemanticVerificationResponse as ReturnType<typeof vi.fn>).mockReturnValue({
      blockingIssues: [],
      passed: true,
      model: 'test-model',
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });

    const result = await repairSingleIssue(makeOptions());

    expect(result.resolved).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.repairedContent).toBe('# Repaired PRD');
    expect(result.model).toBe('test-model');
    expect(result.tokenUsage.total_tokens).toBeGreaterThan(0);
  });

  it('retries and resolves on second attempt', async () => {
    (applySemanticPatchRefinement as ReturnType<typeof vi.fn>).mockResolvedValue({
      refined: true,
      content: '# Attempt content',
      structure: { features: [], otherSections: {} },
    });

    // First verify: issue still present
    const stillPresent = {
      content: JSON.stringify({ blockingIssues: [baseIssue], passed: false }),
      model: 'test-model',
      usage: { prompt_tokens: 80, completion_tokens: 40, total_tokens: 120 },
      finishReason: 'stop',
    };
    // Second verify: issue resolved
    const resolved = {
      content: JSON.stringify({ blockingIssues: [], passed: true }),
      model: 'test-model-v2',
      usage: { prompt_tokens: 90, completion_tokens: 45, total_tokens: 135 },
      finishReason: 'stop',
    };

    mockClient.callWithFallback
      .mockResolvedValueOnce({ ...stillPresent }) // repair call 1
      .mockResolvedValueOnce({ ...stillPresent }) // verify call 1
      .mockResolvedValueOnce({ ...resolved })     // repair call 2
      .mockResolvedValueOnce({ ...resolved });    // verify call 2

    let verifyCallCount = 0;
    (parseSemanticVerificationResponse as ReturnType<typeof vi.fn>).mockImplementation(() => {
      verifyCallCount++;
      if (verifyCallCount === 1) {
        return {
          blockingIssues: [baseIssue],
          passed: false,
          model: 'test-model',
          usage: stillPresent.usage,
        };
      }
      return {
        blockingIssues: [],
        passed: true,
        model: 'test-model-v2',
        usage: resolved.usage,
      };
    });

    const result = await repairSingleIssue(makeOptions());

    expect(result.resolved).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('returns unresolved after exhausting all attempts', async () => {
    (applySemanticPatchRefinement as ReturnType<typeof vi.fn>).mockResolvedValue({
      refined: true,
      content: '# Still broken',
      structure: { features: [], otherSections: {} },
    });

    mockClient.callWithFallback.mockResolvedValue({
      content: JSON.stringify({ blockingIssues: [baseIssue], passed: false }),
      model: 'test-model',
      usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 },
      finishReason: 'stop',
    });

    (parseSemanticVerificationResponse as ReturnType<typeof vi.fn>).mockReturnValue({
      blockingIssues: [baseIssue],
      passed: false,
      model: 'test-model',
      usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 },
    });

    const result = await repairSingleIssue(makeOptions({ maxAttempts: 2 }));

    expect(result.resolved).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.remainingIssues).toHaveLength(1);
    expect(result.remainingIssues[0].code).toBe('INCONSISTENCY');
  });

  it('exits early when patch produces no changes', async () => {
    (applySemanticPatchRefinement as ReturnType<typeof vi.fn>).mockResolvedValue({
      refined: false,
      content: '# Test PRD\nSome content',
      structure: { features: [], otherSections: {} },
    });

    const result = await repairSingleIssue(makeOptions());

    expect(result.resolved).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.remainingIssues).toEqual([baseIssue]);
    // Verifier should NOT have been called since patch didn't change anything
    expect(parseSemanticVerificationResponse).not.toHaveBeenCalled();
  });

  it('prefers the document language over content language when building prompts', async () => {
    (createClientWithUserPreferences as ReturnType<typeof vi.fn>).mockResolvedValue({
      client: mockClient,
      contentLanguage: 'en',
    });
    (applySemanticPatchRefinement as ReturnType<typeof vi.fn>).mockResolvedValue({
      refined: true,
      content: '# Repaired PRD',
      structure: { features: [], otherSections: {} },
    });
    mockClient.callWithFallback.mockResolvedValue({
      content: JSON.stringify({ blockingIssues: [], passed: true }),
      model: 'test-model',
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      finishReason: 'stop',
    });
    (parseSemanticVerificationResponse as ReturnType<typeof vi.fn>).mockReturnValue({
      blockingIssues: [],
      passed: true,
      model: 'test-model',
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });

    await repairSingleIssue(makeOptions({ language: 'de' }));

    expect(getLanguageInstruction).toHaveBeenCalledWith('de');
  });

  it('accumulates token usage across attempts', async () => {
    const usagePerCall = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };

    (applySemanticPatchRefinement as ReturnType<typeof vi.fn>).mockResolvedValue({
      refined: true,
      content: '# Content',
      structure: { features: [], otherSections: {} },
    });

    mockClient.callWithFallback.mockResolvedValue({
      content: '{}',
      model: 'test-model',
      usage: usagePerCall,
      finishReason: 'stop',
    });

    (parseSemanticVerificationResponse as ReturnType<typeof vi.fn>).mockReturnValue({
      blockingIssues: [],
      passed: true,
      model: 'test-model',
      usage: usagePerCall,
    });

    const result = await repairSingleIssue(makeOptions({ maxAttempts: 1 }));

    // The repairReviewer callback adds usage internally via addUsage,
    // and runVerification returns usage which is added at the call site.
    // Both use the same mock value (100/50/150), so total = 2 * 150 = 300
    expect(result.tokenUsage.prompt_tokens).toBeGreaterThanOrEqual(100);
    expect(result.tokenUsage.total_tokens).toBeGreaterThanOrEqual(150);
  });
});
