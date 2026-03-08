import { describe, it, expect, vi } from 'vitest';
import { finalizeWithCompilerGates, PrdCompilerQualityError } from '../server/prdCompilerFinalizer';
import { compilePrdDocument, type CompilePrdResult } from '../server/prdCompiler';

function usage(total: number) {
  return {
    prompt_tokens: Math.floor(total / 2),
    completion_tokens: total - Math.floor(total / 2),
    total_tokens: total,
  };
}

function buildSemanticVerifierPrd(definitionOfDoneLine: string): string {
  return [
    '## System Vision',
    'A deterministic platform for AI-assisted PRD creation finalizes outputs only after compiler validation, semantic verification, and explicit reviewer diagnostics are complete.',
    '',
    '## System Boundaries',
    'The workflow runs as a web application with authenticated users, API-backed persistence, and a compiler-driven review flow without any separate native client.',
    '',
    '## Domain Model',
    'Core entities are User, PRD, Feature, RepairAttempt, ReviewRun, and SemanticVerificationResult, each with stable identifiers, timestamps, and ownership links.',
    '',
    '## Global Business Rules',
    'Feature IDs remain stable across review passes, semantic verification must complete before acceptance, and no degraded result may bypass compiler or reviewer quality gates.',
    '',
    '## Functional Feature Catalogue',
    '',
    '### F-01: Semantic Verification',
    '1. Purpose',
    'Validate the final PRD before acceptance and block inconsistent output until targeted repair succeeds with traceable diagnostics.',
    '2. Actors',
    'Reviewer model, verifier model, and the authenticated editor user coordinate the final quality decision.',
    '3. Trigger',
    'Compiler finalization starts semantic verification after a structured PRD candidate has passed deterministic validation.',
    '4. Preconditions',
    'A compiled PRD candidate exists, required settings are available, and diagnostics capture is active for the request.',
    '5. Main Flow',
    '1. The verifier inspects the compiled PRD against cross-section consistency rules.',
    '2. The finalizer accepts the document only after the verifier reports a pass.',
    '3. The accepted result stores reviewer and verifier evidence for later inspection.',
    '6. Alternate Flows',
    '1. A blocking semantic issue triggers one targeted repair attempt through the refinement reviewer.',
    '2. Persistent semantic blockers force a hard rejection instead of a silent degraded accept path.',
    '7. Postconditions',
    'The document is accepted only when semantics pass and the verifier outcome is attached to the final result.',
    '8. Data Impact',
    'Verification verdicts, blocking issues, and repair evidence are stored in diagnostics and revision metadata.',
    '9. UI Impact',
    'The run result shows verifier outcome, repair status, and clear reasons whenever acceptance is denied.',
    '10. Acceptance Criteria',
    '- Semantic verification completes before final acceptance and surfaces actionable blocker messages.',
    '- Final results expose deterministic diagnostics for both reviewer and verifier decisions.',
    '',
    '## Non-Functional Requirements',
    'Final verification must remain deterministic, finish within one request roundtrip, and expose reproducible diagnostics for failed reviews.',
    '',
    '## Error Handling & Recovery',
    'Blocking verifier findings stop final acceptance, trigger targeted repair when configured, and never fall back to silent approval.',
    '',
    '## Deployment & Infrastructure',
    'The service runs in a containerized Node environment with reviewer and verifier roles executing inside the same request workflow.',
    '',
    '## Definition of Done',
    definitionOfDoneLine,
    '- Semantic verifier diagnostics are stored before final acceptance is recorded.',
    '- Reviewer-visible evidence explains why a release candidate passed or failed.',
    '',
    '## Out of Scope',
    'This scope excludes degraded acceptance after semantic verifier failure, mobile client work, and unreviewed manual imports.',
    '',
    '## Timeline & Milestones',
    'Milestone 1 stabilizes compiler repair, milestone 2 adds semantic verification, and milestone 3 persists reviewer-visible diagnostics.',
    '',
    '## Success Criteria & Acceptance Testing',
    'Semantic verification blocks inconsistent PRDs, targeted repair resolves fixable issues, and final acceptance always includes traceable diagnostics.',
  ].join('\n');
}

function replaceSectionBody(content: string, heading: string, body: string): string {
  const marker = `## ${heading}`;
  const start = content.indexOf(marker);
  if (start < 0) return content;

  const nextHeading = content.indexOf('\n## ', start + marker.length);
  const prefix = content.slice(0, start);
  const suffix = nextHeading >= 0 ? content.slice(nextHeading) : '';
  return `${prefix}${marker}\n\n${body.trim()}\n${suffix}`;
}

describe('prdCompilerFinalizer', () => {
  it('returns compiled output without repair when quality gates pass', async () => {
    const initial = buildSemanticVerifierPrd(
      '- Final acceptance requires deterministic verification evidence and complete review diagnostics.'
    );

    const repairReviewer = vi.fn(async () => ({
      content: initial,
      model: 'mock/repair',
      usage: usage(12),
    }));

    const result = await finalizeWithCompilerGates({
      initialResult: {
        content: initial,
        model: 'mock/initial',
        usage: usage(100),
      },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Generate a deterministic PRD.',
      repairReviewer,
    });

    expect(result.quality.valid).toBe(true);
    expect(result.repairAttempts).toHaveLength(0);
    expect(repairReviewer).not.toHaveBeenCalled();
    expect(result.content).toContain('## Timeline & Milestones');
  });

  it('rejects truncated generate output when compiler fallback sections dominate after repair attempts', async () => {
    const truncated = [
      '## Functional Feature Catalogue',
      '',
      '### F-01: Realtime Updates',
      '10. Acceptance Criteria',
      '- A change by one user',
    ].join('\n');

    const repairReviewer = vi.fn(async () => ({
      content: truncated,
      model: 'mock/repair',
      usage: usage(200),
    }));

    let capturedError: unknown;

    try {
      await finalizeWithCompilerGates({
        initialResult: {
          content: truncated,
          model: 'mock/initial',
          usage: usage(120),
          finishReason: 'length',
        },
        mode: 'generate',
        language: 'en',
        originalRequest: 'Refine realtime updates section.',
        maxRepairPasses: 2,
        repairReviewer,
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(PrdCompilerQualityError);
    expect(repairReviewer).toHaveBeenCalledTimes(2);

    const qualityError = capturedError as PrdCompilerQualityError;
    expect(qualityError.failureStage).toBe('compiler_repair');
    expect(
      qualityError.quality.issues.some(issue => issue.code === 'excessive_fallback_sections')
    ).toBe(true);
  });

  it('accepts compiler-valid output even when raw source heuristically looks truncated', async () => {
    const sourceLooksTruncated = [
      '## Functional Feature Catalogue',
      '',
      '### F-01: Realtime Updates',
      '10. Acceptance Criteria',
      '- A change by one user and',
    ].join('\n');

    const compileDocument = vi.fn(() => ({
      content: [
        '## System Vision',
        'Realtime collaboration across active users.',
        '',
        '## Functional Feature Catalogue',
        '',
        '### F-01: Realtime Updates',
        '1. Purpose',
        'Synchronize updates in under one second.',
        '10. Acceptance Criteria',
        '- Updates are visible in all active sessions within one second.',
      ].join('\n'),
      structure: {
        systemVision: 'Realtime collaboration across active users.',
        features: [
          {
            id: 'F-01',
            name: 'Realtime Updates',
            rawContent: 'Structured feature content.',
            purpose: 'Synchronize updates in under one second.',
            actors: 'Team member',
            trigger: 'Status change',
            preconditions: 'Authenticated session',
            mainFlow: ['User updates task', 'System broadcasts update'],
            alternateFlows: ['Connection drops and retry is attempted'],
            postconditions: 'All clients observe consistent state',
            dataImpact: 'Task status updated',
            uiImpact: 'Task card reflects new status',
            acceptanceCriteria: ['Update visible within one second'],
          },
        ],
        otherSections: {},
      },
      quality: {
        valid: true,
        truncatedLikely: false,
        missingSections: [],
        featureCount: 1,
        issues: [],
      },
    }));

    const repairReviewer = vi.fn(async () => ({
      content: 'unused',
      model: 'mock/repair',
      usage: usage(10),
    }));

    const result = await finalizeWithCompilerGates({
      initialResult: {
        content: sourceLooksTruncated,
        model: 'mock/initial',
        usage: usage(50),
      },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Generate complete PRD.',
      repairReviewer,
      compileDocument,
    });

    expect(result.quality.valid).toBe(true);
    expect(result.repairAttempts).toHaveLength(0);
    expect(repairReviewer).not.toHaveBeenCalled();
  });

  it('fails after max repair attempts if output remains invalid', async () => {
    const invalid = [
      '## System Vision',
      'Only a partial draft without any feature catalogue entries.',
    ].join('\n');

    await expect(finalizeWithCompilerGates({
      initialResult: {
        content: invalid,
        model: 'mock/initial',
        usage: usage(50),
      },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Generate complete PRD.',
      maxRepairPasses: 1,
      repairReviewer: async () => ({
        content: invalid,
        model: 'mock/repair',
        usage: usage(10),
      }),
    })).rejects.toThrow(/quality gate failed/i);
  });

  it('does not force repair when finish_reason is length but output is already valid', async () => {
    const complete = buildSemanticVerifierPrd(
      '- The document is complete only when all required sections remain canonical despite a length finish reason.'
    );

    const repairReviewer = vi.fn(async () => ({
      content: complete,
      model: 'mock/repair',
      usage: usage(10),
    }));

    const result = await finalizeWithCompilerGates({
      initialResult: {
        content: complete,
        model: 'mock/initial',
        usage: usage(100),
        finishReason: 'length',
      },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Generate complete PRD.',
      repairReviewer,
    });

    expect(result.quality.valid).toBe(true);
    expect(result.repairAttempts).toHaveLength(0);
    expect(repairReviewer).not.toHaveBeenCalled();
  });

  it('triggers repair when unknown top-level headings are present', async () => {
    const repaired = buildSemanticVerifierPrd(
      '- The canonical PRD is complete only when unknown top-level headings have been removed during repair.'
    );
    const withUnknown = `${repaired}\n\n## Project Overview\nUnexpected extra heading that must trigger repair.`;

    const repairReviewer = vi.fn(async () => ({
      content: repaired,
      model: 'mock/repair',
      usage: usage(40),
    }));

    const result = await finalizeWithCompilerGates({
      initialResult: {
        content: withUnknown,
        model: 'mock/initial',
        usage: usage(100),
      },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Generate complete canonical PRD.',
      repairReviewer,
    });

    expect(repairReviewer).toHaveBeenCalledTimes(1);
    expect(result.quality.valid).toBe(true);
    expect(result.content).not.toContain('## Project Overview');
  });

  it('includes new quality-gate repair instructions for boilerplate, leaks, and language', async () => {
    const invalid: CompilePrdResult = {
      content: 'invalid',
      structure: {
        features: [],
        otherSections: {},
      },
      quality: {
        valid: false,
        truncatedLikely: false,
        missingSections: [],
        featureCount: 0,
        issues: [
          {
            code: 'boilerplate_repetition_detected',
            message: 'Repeated boilerplate sentence detected.',
            severity: 'error',
          },
          {
            code: 'meta_prompt_leak_detected',
            message: 'Prompt/meta leakage detected.',
            severity: 'error',
          },
          {
            code: 'language_mismatch_section_systemVision',
            message: 'Section language mismatch.',
            severity: 'error',
          },
        ],
      },
    };

    const valid: CompilePrdResult = {
      content: 'valid',
      structure: {
        systemVision: 'Valid output.',
        features: [{ id: 'F-01', name: 'Feature', rawContent: 'Feature body' }],
        otherSections: {},
      },
      quality: {
        valid: true,
        truncatedLikely: false,
        missingSections: [],
        featureCount: 1,
        issues: [],
      },
    };

    const compileDocument = vi.fn((content: string) => {
      if (content.includes('fixed-output')) return valid;
      return invalid;
    });

    const repairReviewer = vi.fn(async (prompt: string) => {
      expect(prompt).toContain('Resolve repeated boilerplate phrasing');
      expect(prompt).toContain('Remove prompt/meta artifacts');
      expect(prompt).toContain('Target language: en');
      return {
        content: 'fixed-output',
        model: 'mock/repair',
        usage: usage(10),
      };
    });

    const result = await finalizeWithCompilerGates({
      initialResult: {
        content: 'initial',
        model: 'mock/initial',
        usage: usage(10),
      },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Generate complete PRD.',
      repairReviewer,
      compileDocument,
      maxRepairPasses: 1,
    });

    expect(result.quality.valid).toBe(true);
    expect(repairReviewer).toHaveBeenCalledTimes(1);
  });

  it('preserves best result when repair degrades quality', async () => {
    let callCount = 0;
    const compileDocument = vi.fn((content: string) => {
      callCount++;
      // Initial: score ~80 (1 error, 1 feature)
      if (callCount === 1) {
        return {
          content,
          structure: { features: [{ id: 'F-01', name: 'A', rawContent: 'body' }], otherSections: {} },
          quality: {
            valid: false, truncatedLikely: false, missingSections: [],
            featureCount: 1,
            issues: [{ code: 'unknown_heading', message: 'Extra heading', severity: 'error' as const }],
          },
        };
      }
      // Repair 1: worse — score ~57 (3 errors, truncated, 0 features)
      if (callCount === 2) {
        return {
          content,
          structure: { features: [], otherSections: {} },
          quality: {
            valid: false, truncatedLikely: true, missingSections: [],
            featureCount: 0,
            issues: [
              { code: 'boilerplate', message: 'Boilerplate', severity: 'error' as const },
              { code: 'truncated', message: 'Truncated', severity: 'error' as const },
              { code: 'language', message: 'Language', severity: 'error' as const },
            ],
          },
        };
      }
      // Repair 2: even worse — abort should have triggered
      return {
        content,
        structure: { features: [], otherSections: {} },
        quality: {
          valid: false, truncatedLikely: true, missingSections: ['System Vision'],
          featureCount: 0,
          issues: [
            { code: 'a', message: 'a', severity: 'error' as const },
            { code: 'b', message: 'b', severity: 'error' as const },
            { code: 'c', message: 'c', severity: 'error' as const },
            { code: 'd', message: 'd', severity: 'error' as const },
          ],
        },
      };
    });

    const repairReviewer = vi.fn(async () => ({
      content: 'repair-attempt',
      model: 'mock/repair',
      usage: usage(10),
    }));

    await expect(finalizeWithCompilerGates({
      initialResult: { content: 'initial', model: 'mock', usage: usage(10) },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Test degradation guard.',
      maxRepairPasses: 4,
      repairReviewer,
      compileDocument,
    })).rejects.toThrow(/quality gate failed/i);

    // Should abort after 2 consecutive degradations, not exhaust all 4 passes
    expect(repairReviewer).toHaveBeenCalledTimes(2);
  });

  it('rejects sparse generate output even when compiler fallback sections are template-appropriate', async () => {
    // Only system vision and feature catalogue are provided → all others are fallbacks.
    const minimal = [
      '## System Vision',
      'A task management tool for agile development teams.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Sprint Board',
      '1. Purpose',
      'Manage sprint tasks on a kanban board.',
      '10. Acceptance Criteria',
      '- Tasks can be moved between columns.',
    ].join('\n');

    const repairReviewer = vi.fn(async () => ({ content: minimal, model: 'mock/repair', usage: usage(10) }));
    let capturedError: unknown;

    try {
      await finalizeWithCompilerGates({
        initialResult: { content: minimal, model: 'mock', usage: usage(80) },
        mode: 'generate',
        language: 'en',
        originalRequest: 'Generate an agile task management tool PRD.',
        repairReviewer,
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(PrdCompilerQualityError);
    expect(repairReviewer).toHaveBeenCalledTimes(2);

    const qualityError = capturedError as PrdCompilerQualityError;
    expect(qualityError.failureStage).toBe('compiler_repair');
    expect(
      qualityError.quality.issues.some(issue => issue.code === 'excessive_fallback_sections')
    ).toBe(true);
  });

  it('returns qualityScore in result', async () => {
    const complete = buildSemanticVerifierPrd(
      '- The score is returned only when the final PRD remains compiler-valid and semantically reviewable.'
    );

    const result = await finalizeWithCompilerGates({
      initialResult: { content: complete, model: 'mock', usage: usage(50) },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Test score.',
      repairReviewer: async () => ({ content: complete, model: 'mock', usage: usage(10) }),
    });

    expect(result.qualityScore).toBeTypeOf('number');
    expect(result.qualityScore).toBeGreaterThan(0);
  });

  it('accepts a semantic verifier pass without targeted semantic repair', async () => {
    const content = buildSemanticVerifierPrd('- Verifier pass recorded in diagnostics.');

    const semanticVerifier = vi.fn(async () => ({
      verdict: 'pass' as const,
      blockingIssues: [],
      model: 'mock/verifier',
      usage: usage(12),
    }));
    const contentRefineReviewer = vi.fn(async () => ({
      content,
      model: 'mock/reviewer',
      usage: usage(10),
    }));

    const result = await finalizeWithCompilerGates({
      initialResult: { content, model: 'mock/initial', usage: usage(50) },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Generate a verified PRD.',
      repairReviewer: async () => ({ content, model: 'mock/repair', usage: usage(10) }),
      contentRefineReviewer,
      semanticVerifier,
      enableContentReview: false,
    });

    expect(result.semanticVerification?.verdict).toBe('pass');
    expect(result.semanticRepairApplied).toBe(false);
    expect(contentRefineReviewer).not.toHaveBeenCalled();
    expect(semanticVerifier).toHaveBeenCalledTimes(1);
  });

  it('passes generator and reviewer model families to the semantic verifier guard', async () => {
    const badContent = [
      '## System Vision',
      'Partial draft without enough structure.',
    ].join('\n');
    const repaired = buildSemanticVerifierPrd('- Verifier pass recorded in diagnostics.');
    const semanticVerifier = vi.fn(async (input) => ({
      verdict: 'pass' as const,
      blockingIssues: [],
      model: 'mistralai/mistral-small-3.1-24b-instruct',
      usage: usage(12),
      blockedFamilies: input.avoidModelFamilies,
    }));

    await finalizeWithCompilerGates({
      initialResult: { content: badContent, model: 'google/gemini-2.5-flash', usage: usage(50) },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Generate a verified PRD.',
      repairReviewer: async () => ({
        content: repaired,
        model: 'anthropic/claude-sonnet-4',
        usage: usage(10),
      }),
      semanticVerifier,
      enableContentReview: false,
    });

    const verifierInput = semanticVerifier.mock.calls[0][0];
    expect(verifierInput.avoidModelFamilies).toEqual(expect.arrayContaining(['gemini', 'claude']));
  });

  it('runs one targeted semantic repair before accepting a verifier pass', async () => {
    const original = buildSemanticVerifierPrd('- Release is complete.');
    const compiledOriginal = compilePrdDocument(original, {
      mode: 'generate',
      language: 'en',
      strictCanonical: true,
      strictLanguageConsistency: true,
      enableFeatureAggregation: true,
      contextHint: 'Generate a verified PRD.',
    });
    const repaired = replaceSectionBody(
      compiledOriginal.content,
      'Definition of Done',
      '- Release is complete only after semantic verification passes and diagnostics are persisted.'
    );
    const semanticVerifier = vi.fn()
      .mockResolvedValueOnce({
        verdict: 'fail' as const,
        blockingIssues: [{
          code: 'cross_section_inconsistency',
          sectionKey: 'definitionOfDone',
          message: 'Definition of Done omits the mandatory semantic verification gate.',
          suggestedAction: 'rewrite' as const,
        }],
        model: 'mock/verifier',
        usage: usage(8),
      })
      .mockResolvedValueOnce({
        verdict: 'pass' as const,
        blockingIssues: [],
        model: 'mock/verifier',
        usage: usage(8),
      });
    const contentRefineReviewer = vi.fn(async () => ({
      content: repaired,
      model: 'mock/reviewer',
      usage: usage(12),
    }));

    const result = await finalizeWithCompilerGates({
      initialResult: { content: original, model: 'mock/initial', usage: usage(40) },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Generate a verified PRD.',
      repairReviewer: async () => ({ content: original, model: 'mock/repair', usage: usage(10) }),
      contentRefineReviewer,
      semanticVerifier,
      enableContentReview: false,
    });

    expect(result.semanticVerification?.verdict).toBe('pass');
    expect(result.semanticRepairApplied).toBe(true);
    expect(contentRefineReviewer).toHaveBeenCalledTimes(1);
    expect(semanticVerifier).toHaveBeenCalledTimes(2);
    expect(result.reviewerAttempts).toHaveLength(1);
  });

  it('fails hard when semantic verifier still reports blockers after targeted repair', async () => {
    const original = buildSemanticVerifierPrd('- Release is complete.');

    const semanticVerifier = vi.fn(async () => ({
      verdict: 'fail' as const,
      blockingIssues: [{
        code: 'cross_section_inconsistency',
        sectionKey: 'definitionOfDone',
        message: 'Definition of Done omits the mandatory semantic verification gate.',
        suggestedAction: 'rewrite' as const,
      }],
      model: 'mock/verifier',
      usage: usage(8),
    }));

    await expect(finalizeWithCompilerGates({
      initialResult: { content: original, model: 'mock/initial', usage: usage(40) },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Generate a verified PRD.',
      repairReviewer: async () => ({ content: original, model: 'mock/repair', usage: usage(10) }),
      contentRefineReviewer: async () => ({ content: original, model: 'mock/reviewer', usage: usage(12) }),
      semanticVerifier,
      enableContentReview: false,
    })).rejects.toMatchObject({
      failureStage: 'semantic_verifier',
      semanticRepairApplied: true,
    });

    try {
      await finalizeWithCompilerGates({
        initialResult: { content: original, model: 'mock/initial', usage: usage(40) },
        mode: 'generate',
        language: 'en',
        originalRequest: 'Generate a verified PRD.',
        repairReviewer: async () => ({ content: original, model: 'mock/repair', usage: usage(10) }),
        contentRefineReviewer: async () => ({ content: original, model: 'mock/reviewer', usage: usage(12) }),
        semanticVerifier,
        enableContentReview: false,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(PrdCompilerQualityError);
      const qualityError = error as PrdCompilerQualityError;
      expect(qualityError.quality.issues.some(issue => issue.code === 'semantic_verifier_blocked')).toBe(true);
    }
  });
});
