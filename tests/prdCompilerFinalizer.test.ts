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

  it('runs repair pass when initial output is truncated and returns valid content', async () => {
    const truncated = [
      '## Functional Feature Catalogue',
      '',
      '### F-01: Realtime Updates',
      '10. Acceptance Criteria',
      '- A change by one user',
    ].join('\n');

    const repaired = [
      '## System Vision',
      'Realtime collaboration across active users.',
      '',
      '## System Boundaries',
      'Web client and API.',
      '',
      '## Domain Model',
      '- Task, User, Project.',
      '',
      '## Global Business Rules',
      '- Feature IDs remain stable.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Realtime Updates',
      '1. Purpose',
      'Synchronize updates in under one second.',
      '10. Acceptance Criteria',
      '- Updates are visible in all active sessions within one second.',
      '',
      '## Non-Functional Requirements',
      '- Latency below one second for update propagation.',
      '',
      '## Error Handling & Recovery',
      '- Recover from disconnected sessions.',
      '',
      '## Deployment & Infrastructure',
      '- Node service with PostgreSQL.',
      '',
      '## Definition of Done',
      '- All required sections are complete.',
      '',
      '## Out of Scope',
      '- Native mobile app for this release.',
      '',
      '## Timeline & Milestones',
      '- Milestone 1 and Milestone 2.',
      '',
      '## Success Criteria & Acceptance Testing',
      '- 95% of updates delivered within one second.',
    ].join('\n');

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
      repairGenerator: async () => ({
        content: repaired,
        model: 'mock/repair',
        usage: usage(200),
      }),
    });

    expect(result.repairAttempts).toHaveLength(1);
    expect(result.quality.valid).toBe(true);
    expect(result.content).toContain('## Success Criteria & Acceptance Testing');
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
      expect(prompt).toContain('Keep complete body content in target language');
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
});
