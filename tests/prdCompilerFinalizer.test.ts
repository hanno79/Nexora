import { describe, it, expect, vi } from 'vitest';
import { finalizeWithCompilerGates } from '../server/prdCompilerFinalizer';
import type { CompilePrdResult } from '../server/prdCompiler';

function usage(total: number) {
  return {
    prompt_tokens: Math.floor(total / 2),
    completion_tokens: total - Math.floor(total / 2),
    total_tokens: total,
  };
}

describe('prdCompilerFinalizer', () => {
  it('returns compiled output without repair when quality gates pass', async () => {
    const initial = [
      '## System Vision',
      'A deterministic PRD finalization pipeline.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Finalization',
      '1. Purpose',
      'Finalize content with quality gates.',
      '10. Acceptance Criteria',
      '- Output is complete and structured.',
    ].join('\n');

    const repairGenerator = vi.fn(async () => ({
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
      repairGenerator,
    });

    expect(result.quality.valid).toBe(true);
    expect(result.repairAttempts).toHaveLength(0);
    expect(repairGenerator).not.toHaveBeenCalled();
    expect(result.content).toContain('## Timeline & Milestones');
  });

  it('recovers valid structure from truncated source via fallback sections without repair', async () => {
    const truncated = [
      '## Functional Feature Catalogue',
      '',
      '### F-01: Realtime Updates',
      '10. Acceptance Criteria',
      '- A change by one user',
    ].join('\n');

    const repairGenerator = vi.fn(async () => ({
      content: truncated,
      model: 'mock/repair',
      usage: usage(200),
    }));

    const result = await finalizeWithCompilerGates({
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
      repairGenerator,
    });

    // Compiler fills missing sections with fallbacks → valid without repair
    expect(result.repairAttempts).toHaveLength(0);
    expect(repairGenerator).not.toHaveBeenCalled();
    expect(result.quality.valid).toBe(true);
    // Source truncation is captured as a warning, not an error
    const truncWarning = result.quality.issues.find(i => i.code === 'truncated_output');
    expect(truncWarning?.severity).toBe('warning');
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

    const repairGenerator = vi.fn(async () => ({
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
      repairGenerator,
      compileDocument,
    });

    expect(result.quality.valid).toBe(true);
    expect(result.repairAttempts).toHaveLength(0);
    expect(repairGenerator).not.toHaveBeenCalled();
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
      repairGenerator: async () => ({
        content: invalid,
        model: 'mock/repair',
        usage: usage(10),
      }),
    })).rejects.toThrow(/quality gate failed/i);
  });

  it('does not force repair when finish_reason is length but output is already valid', async () => {
    const complete = [
      '## System Vision',
      'A deterministic and complete PRD output.',
      '',
      '## System Boundaries',
      'Web app with authenticated users.',
      '',
      '## Domain Model',
      '- User, PRD, Version.',
      '',
      '## Global Business Rules',
      '- Feature IDs remain stable across refinements.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Quality Gate',
      '1. Purpose',
      'Ensure complete output.',
      '10. Acceptance Criteria',
      '- Output includes all required sections.',
      '',
      '## Non-Functional Requirements',
      '- Deterministic compilation and parseability.',
      '',
      '## Error Handling & Recovery',
      '- Repair loop available for real truncation.',
      '',
      '## Deployment & Infrastructure',
      '- Node service and PostgreSQL.',
      '',
      '## Definition of Done',
      '- Valid document with complete structure.',
      '',
      '## Out of Scope',
      '- No mobile client in this release.',
      '',
      '## Timeline & Milestones',
      '- Phase 1 and Phase 2.',
      '',
      '## Success Criteria & Acceptance Testing',
      '- 95% of runs produce valid complete output.',
    ].join('\n');

    const repairGenerator = vi.fn(async () => ({
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
      repairGenerator,
    });

    expect(result.quality.valid).toBe(true);
    expect(result.repairAttempts).toHaveLength(0);
    expect(repairGenerator).not.toHaveBeenCalled();
  });

  it('triggers repair when unknown top-level headings are present', async () => {
    const withUnknown = [
      '## System Vision',
      'A deterministic and complete PRD output.',
      '',
      '## System Boundaries',
      'Web app with authenticated users.',
      '',
      '## Domain Model',
      '- User, PRD, Version.',
      '',
      '## Global Business Rules',
      '- Feature IDs remain stable across refinements.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Quality Gate',
      '1. Purpose',
      'Ensure complete output.',
      '10. Acceptance Criteria',
      '- Output includes all required sections.',
      '',
      '## Non-Functional Requirements',
      '- Deterministic compilation and parseability.',
      '',
      '## Error Handling & Recovery',
      '- Repair loop available for real truncation.',
      '',
      '## Deployment & Infrastructure',
      '- Node service and PostgreSQL.',
      '',
      '## Definition of Done',
      '- Valid document with complete structure.',
      '',
      '## Out of Scope',
      '- No mobile client in this release.',
      '',
      '## Timeline & Milestones',
      '- Phase 1 and Phase 2.',
      '',
      '## Success Criteria & Acceptance Testing',
      '- 95% of runs produce valid complete output.',
      '',
      '## Project Overview',
      'Unexpected extra heading that must trigger repair.',
    ].join('\n');

    const repaired = withUnknown.replace(
      '\n## Project Overview\nUnexpected extra heading that must trigger repair.',
      ''
    );

    const repairGenerator = vi.fn(async () => ({
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
      repairGenerator,
    });

    expect(repairGenerator).toHaveBeenCalledTimes(1);
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

    const repairGenerator = vi.fn(async (prompt: string) => {
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
      repairGenerator,
      compileDocument,
      maxRepairPasses: 1,
    });

    expect(result.quality.valid).toBe(true);
    expect(repairGenerator).toHaveBeenCalledTimes(1);
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

    const repairGenerator = vi.fn(async () => ({
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
      repairGenerator,
      compileDocument,
    })).rejects.toThrow(/quality gate failed/i);

    // Should abort after 2 consecutive degradations, not exhaust all 4 passes
    expect(repairGenerator).toHaveBeenCalledTimes(2);
  });

  it('returns qualityScore in result', async () => {
    const complete = [
      '## System Vision', 'Complete PRD output.',
      '', '## Functional Feature Catalogue',
      '', '### F-01: Core', '1. Purpose', 'Core feature.', '10. Acceptance Criteria', '- Works.',
    ].join('\n');

    const result = await finalizeWithCompilerGates({
      initialResult: { content: complete, model: 'mock', usage: usage(50) },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Test score.',
      repairGenerator: async () => ({ content: complete, model: 'mock', usage: usage(10) }),
    });

    expect(result.qualityScore).toBeTypeOf('number');
    expect(result.qualityScore).toBeGreaterThan(0);
  });
});
