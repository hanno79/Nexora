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

  it('recovers truncated generate output when deterministic completion yields a valid PRD', async () => {
    const truncated = [
      '## Functional Feature Catalogue',
      '',
      '### F-01: Realtime Updates',
      '10. Acceptance Criteria',
      '- A change by one user',
    ].join('\n');
    let compileCall = 0;
    const compileDocument = vi.fn((candidate: string) => {
      compileCall++;
      if (compileCall === 1) {
        return compilePrdDocument(candidate, {
          mode: 'generate',
          language: 'en',
          strictCanonical: true,
          strictLanguageConsistency: true,
          enableFeatureAggregation: true,
        });
      }

      return {
        content: [
          '## System Vision',
          'Realtime collaboration keeps all active users in sync.',
          '',
          '## Non-Functional Requirements',
          'Realtime updates stay responsive under concurrent load.',
          '',
          '## Functional Feature Catalogue',
          '',
          '### F-01: Realtime Updates',
          '1. Purpose',
          'Synchronize task updates across all connected sessions in under one second.',
          '2. Actors',
          'Collaborating team member.',
          '3. Trigger',
          'A user changes a task status or assignee.',
          '4. Preconditions',
          'The user is authenticated and the shared board is open.',
          '5. Main Flow',
          '1. The user updates a task on the board.',
          '2. The system broadcasts the change to all active clients.',
          '3. Each client refreshes the affected task card in place.',
          '6. Alternate Flows',
          '1. If a websocket reconnect is in progress, the client applies the change after session recovery.',
          '7. Postconditions',
          'Every active client shows the same task state after the update completes.',
          '8. Data Impact',
          'Updates Task.status, Task.assigneeId, and board activity metadata.',
          '9. UI Impact',
          'The affected task card updates immediately without a full page refresh.',
          '10. Acceptance Criteria',
          '- Active users see the updated task state within one second.',
          '- Reconnected clients receive the latest task state after recovering the session.',
          '',
          '## Timeline & Milestones',
          '- Phase 1 delivers F-01 Realtime Updates.',
          '',
          '## Success Criteria & Acceptance Testing',
          'Realtime updates stay consistent across all active sessions.',
        ].join('\n'),
        structure: {
          systemVision: 'Realtime collaboration keeps all active users in sync.',
          features: [
            {
              id: 'F-01',
              name: 'Realtime Updates',
              rawContent: 'Structured feature body',
              purpose: 'Synchronize task updates across all connected sessions in under one second.',
              actors: 'Collaborating team member.',
              trigger: 'A user changes a task status or assignee.',
              preconditions: 'The user is authenticated and the shared board is open.',
              mainFlow: [
                'The user updates a task on the board.',
                'The system broadcasts the change to all active clients.',
                'Each client refreshes the affected task card in place.',
              ],
              alternateFlows: [
                'If a websocket reconnect is in progress, the client applies the change after session recovery.',
              ],
              postconditions: 'Every active client shows the same task state after the update completes.',
              dataImpact: 'Updates Task.status, Task.assigneeId, and board activity metadata.',
              uiImpact: 'The affected task card updates immediately without a full page refresh.',
              acceptanceCriteria: [
                'Active users see the updated task state within one second.',
                'Reconnected clients receive the latest task state after recovering the session.',
              ],
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
      } as CompilePrdResult;
    });

    const repairReviewer = vi.fn(async () => ({
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
      repairReviewer,
      compileDocument,
    });

    expect(result.quality.valid).toBe(true);
    expect(result.content).toContain('## System Vision');
    expect(result.content).toContain('## Timeline & Milestones');
    expect(repairReviewer.mock.calls.length).toBeLessThanOrEqual(1);
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
            acceptanceCriteria: [
              'Update visible in all active sessions within one second.',
              'Recovered sessions show the latest task state after reconnect.',
            ],
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

  it('repairs deterministic feature core gaps via targeted patch refinement before full-document compiler repair', async () => {
    const content = buildSemanticVerifierPrd(
      '- Release is complete after semantic verification passes and diagnostics are persisted.'
    );
    let compileCall = 0;
    const compileDocument = vi.fn((candidate: string) => {
      compileCall++;
      if (candidate.includes('PlayerProfile.xp')) {
        return {
          content: candidate,
          structure: {
            systemVision: 'A Tetris platform combines power-ups with roguelite progression.',
            outOfScope: '- Native mobile clients are excluded from this release.',
            features: [
              {
                id: 'F-01',
                name: 'Core Tetris Session',
                rawContent: 'Structured feature body',
                purpose: 'Deliver classic Tetris gameplay with power-ups and progression.',
                trigger: 'The player starts a run.',
                preconditions: 'A game session is active and the player profile already tracks XP and cooldown-aware power-up state.',
                mainFlow: ['The player starts a run.', 'The system updates progression and score.'],
                postconditions: 'The run updates score, XP progression, and power-up lifecycle state consistently after completion.',
                dataImpact: 'Updates PlayerProfile.xp, PlayerProfile.level, GameSession.activePowerUpId, GameSession.score, and PowerUp.cooldown.',
                acceptanceCriteria: [
                  'The session records XP progression after each completed run.',
                  'Power-up cooldown state remains consistent with gameplay events.',
                ],
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
            primaryCapabilityAnchors: ['power', 'progression'],
            featurePriorityWindow: ['F-01'],
            coreFeatureIds: ['F-01'],
            supportFeatureIds: [],
          },
        } as CompilePrdResult;
      }

      return {
        content: candidate,
        structure: {
          systemVision: 'A Tetris platform combines power-ups with roguelite progression.',
          outOfScope: '- Native mobile clients are excluded from this release.',
          features: [
            {
              id: 'F-01',
              name: 'Core Tetris Session',
              rawContent: 'Structured feature body',
              purpose: 'Deliver classic Tetris gameplay with power-ups and progression.',
              trigger: 'The player starts a run.',
              preconditions: 'A game session is active.',
              mainFlow: ['The player starts a run.', 'The system stores the run score.'],
              postconditions: 'The run finishes and score is stored.',
              dataImpact: 'Updates GameSession.score after each run.',
              acceptanceCriteria: ['The player can finish a run.'],
            },
          ],
          otherSections: {},
        },
        quality: {
          valid: false,
          truncatedLikely: false,
          missingSections: [],
          featureCount: 1,
          issues: [
            {
              code: 'feature_core_semantic_gap',
              message: 'Feature "F-01" mentions progression but Preconditions, Postconditions, or Data Impact do not encode it consistently.',
              severity: 'error' as const,
              evidencePath: 'feature:F-01.purpose',
            },
          ],
          primaryCapabilityAnchors: ['power', 'progression'],
          featurePriorityWindow: ['F-01'],
          coreFeatureIds: [],
          supportFeatureIds: [],
        },
      } as CompilePrdResult;
    });

    const repairReviewer = vi.fn(async (prompt: string, pass: number) => {
      expect(pass).toBe(1);
      expect(prompt).toContain('Return JSON only');
      expect(prompt).toContain('Target Fields: preconditions, postconditions, dataImpact');
      expect(prompt).not.toContain('Target Fields: purpose');
      expect(prompt).not.toContain('Target Fields: trigger');
      expect(prompt).not.toContain('Target Fields: mainFlow');
      expect(prompt).not.toContain('Target Fields: acceptanceCriteria');
      return {
        content: JSON.stringify({
          features: [
            {
              id: 'F-01',
              fields: {
                preconditions: 'A game session is active and the player profile already tracks XP and cooldown-aware power-up state.',
                postconditions: 'The run updates score, XP progression, and power-up lifecycle state consistently after completion.',
                dataImpact: 'Updates PlayerProfile.xp, PlayerProfile.level, GameSession.activePowerUpId, GameSession.score, and PowerUp.cooldown.',
              },
            },
          ],
        }),
        model: 'mock/repair',
        usage: usage(20),
        finishReason: 'stop',
      };
    });

    const result = await finalizeWithCompilerGates({
      initialResult: {
        content,
        model: 'mock/initial',
        usage: usage(50),
      },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Create a Tetris PRD focused on power-ups and roguelite progression.',
      repairReviewer,
      compileDocument,
      enableContentReview: false,
    });

    expect(result.quality.valid).toBe(true);
    expect(compileCall).toBeGreaterThan(1);
    expect(result.repairAttempts).toHaveLength(0);
    expect(result.reviewerAttempts).toHaveLength(1);
    expect(repairReviewer).toHaveBeenCalledTimes(1);
    expect(result.primaryCapabilityAnchors?.length).toBeGreaterThan(0);
  });

  it('routes schema field reference blockers into deterministic domain-model and feature repair before full-document compiler repair', async () => {
    const content = buildSemanticVerifierPrd(
      '- Release is complete after semantic verification passes and compiler evidence stays consistent.'
    );
    let compileCall = 0;
    const compileDocument = vi.fn((candidate: string) => {
      compileCall++;
      const compiled = compilePrdDocument(candidate, {
        mode: 'generate',
        language: 'en',
        strictCanonical: true,
        strictLanguageConsistency: true,
        enableFeatureAggregation: true,
      });
      const schemaReferenceRepaired = candidate.includes('lastLoginAt');

      return {
        ...compiled,
        quality: {
          ...compiled.quality,
          valid: schemaReferenceRepaired,
          issues: schemaReferenceRepaired
            ? []
            : [{
              code: 'schema_field_reference_missing',
              message: 'Reference "User.lastLoginAt" in feature:F-01.dataImpact is not declared in the Domain Model for entity "User".',
              severity: 'error' as const,
              evidencePath: 'feature:F-01.dataImpact',
            }],
          primaryCapabilityAnchors: ['semantic', 'verification'],
          featurePriorityWindow: ['F-01'],
          coreFeatureIds: ['F-01'],
          supportFeatureIds: [],
        },
      } as CompilePrdResult;
    });

    const repairReviewer = vi.fn(async (prompt: string, pass: number) => {
      expect(pass).toBe(1);
      expect(prompt).toContain('## Target Section: domainModel');
      expect(prompt).toContain('## Target Feature: F-01');
      expect(prompt).toContain('User.lastLoginAt');
      return {
        content: JSON.stringify({
          sections: {
            domainModel: 'User stores userId, email, passwordHash, and lastLoginAt. PRD stores prdId, status, and ownerId. Feature stores featureId and title.',
          },
          features: [
            {
              id: 'F-01',
              fields: {
                postconditions: 'The document remains accepted only after semantic verification passes and User.lastLoginAt is recorded for the editor session.',
                dataImpact: 'Updates SemanticVerificationResult.status, RepairAttempt.evidence, and User.lastLoginAt after each accepted run.',
              },
            },
          ],
        }),
        model: 'mock/repair',
        usage: usage(18),
        finishReason: 'stop',
      };
    });

    const result = await finalizeWithCompilerGates({
      initialResult: {
        content,
        model: 'mock/initial',
        usage: usage(50),
      },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Generate a verified PRD with tracked editor login timestamps.',
      repairReviewer,
      compileDocument,
      enableContentReview: false,
    });

    expect(result.quality.valid).toBe(true);
    expect(result.repairAttempts).toHaveLength(0);
    expect(result.reviewerAttempts).toHaveLength(1);
    expect(repairReviewer).toHaveBeenCalledTimes(1);
    expect(compileCall).toBeGreaterThan(1);
  });

  it('routes out-of-scope reintroduction blockers into deterministic section repair before full-document compiler repair', async () => {
    const content = replaceSectionBody(
      buildSemanticVerifierPrd('- Release is complete after documentation review and semantic verification.'),
      'Success Criteria & Acceptance Testing',
      [
        '- Semantic verification blocks inconsistent PRDs before final acceptance.',
        '- Native mobile rollout is part of this release success criteria.',
      ].join('\n')
    );
    let compileCall = 0;
    const compileDocument = vi.fn((candidate: string) => {
      compileCall++;
      const compiled = compilePrdDocument(candidate, {
        mode: 'generate',
        language: 'en',
        strictCanonical: true,
        strictLanguageConsistency: true,
        enableFeatureAggregation: true,
      });
      const scopeLeakRemoved = !candidate.includes('Native mobile rollout is part of this release success criteria.');

      return {
        ...compiled,
        quality: {
          ...compiled.quality,
          valid: scopeLeakRemoved,
          issues: scopeLeakRemoved
            ? []
            : [{
              code: 'out_of_scope_reintroduced',
              message: 'Out-of-scope item "mobile client work" is reintroduced in successCriteria.',
              severity: 'error' as const,
              evidencePath: 'successCriteria',
            }],
        },
      } as CompilePrdResult;
    });

    const repairReviewer = vi.fn(async (prompt: string, pass: number) => {
      expect(pass).toBe(1);
      expect(prompt).toContain('## Target Section: successCriteria');
      expect(prompt).toContain('out_of_scope_reintroduced');
      return {
        content: JSON.stringify({
          sections: {
            successCriteria: [
              '- Semantic verification blocks inconsistent PRDs before final acceptance.',
              '- Accepted PRDs exclude native mobile work from this release scope.',
              '- Reviewer and verifier diagnostics remain visible for every accepted revision.',
            ].join('\n'),
          },
        }),
        model: 'mock/repair',
        usage: usage(12),
        finishReason: 'stop',
      };
    });

    const result = await finalizeWithCompilerGates({
      initialResult: {
        content,
        model: 'mock/initial',
        usage: usage(40),
      },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Generate a verified PRD with release-specific success criteria.',
      repairReviewer,
      compileDocument,
      enableContentReview: false,
    });

    expect(result.quality.valid).toBe(true);
    expect(result.repairAttempts).toHaveLength(0);
    expect(result.reviewerAttempts).toHaveLength(1);
    expect(result.content).not.toContain('Native mobile rollout is part of this release success criteria.');
    expect(repairReviewer).toHaveBeenCalledTimes(1);
    expect(compileCall).toBeGreaterThan(1);
  });

  it('normalizes out-of-scope future leakage before spending AI repair budget', async () => {
    const content = buildSemanticVerifierPrd(
      '- Release is complete after documentation review and semantic verification.'
    ).replace(
      'This scope excludes degraded acceptance after semantic verifier failure, mobile client work, and unreviewed manual imports.',
      'VR integration is deferred to a later roadmap phase, but it is not in this release.'
    );

    const repairReviewer = vi.fn(async () => ({
      content,
      model: 'mock/repair',
      usage: usage(10),
      finishReason: 'stop',
    }));

    const result = await finalizeWithCompilerGates({
      initialResult: {
        content,
        model: 'mock/initial',
        usage: usage(40),
      },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Generate a verified PRD.',
      repairReviewer,
      enableContentReview: false,
    });

    expect(result.quality.valid).toBe(true);
    expect(result.content).toContain('VR integration is excluded from this release.');
    expect(repairReviewer).not.toHaveBeenCalled();
  });

  it('rewrites generic success criteria boilerplate during deterministic targeted repair', async () => {
    const content = replaceSectionBody(
      buildSemanticVerifierPrd('- Release is complete after documentation review and semantic verification.'),
      'Success Criteria & Acceptance Testing',
      [
        'The project is successful when:',
        '- Core workflows are implemented.',
        '- Stakeholders can use the release.',
      ].join('\n')
    );
    const repairedSuccessCriteria = [
      '- Semantic verification blocks inconsistent PRDs before release approval.',
      '- Targeted repair resolves fixable blockers without changing canonical feature IDs.',
      '- Reviewer and verifier diagnostics remain attached to every accepted PRD.',
    ].join('\n');

    const compileDocument = vi.fn((candidate: string) => {
      const compiled = compilePrdDocument(candidate, {
        mode: 'generate',
        language: 'en',
        strictCanonical: true,
        strictLanguageConsistency: true,
        enableFeatureAggregation: true,
      });
      const stillGeneric = String(compiled.structure.successCriteria || '').includes('The project is successful when:');

      return {
        ...compiled,
        quality: {
          ...compiled.quality,
          valid: !stillGeneric,
          issues: stillGeneric
            ? [{
              code: 'template_semantic_boilerplate_successCriteria',
              message: 'Section "successCriteria" contains generic boilerplate and is not template-specific.',
              severity: 'error' as const,
            }]
            : [],
        },
      } as CompilePrdResult;
    });

    const repairReviewer = vi.fn(async (prompt: string, pass: number) => {
      expect(pass).toBe(1);
      expect(prompt).toContain('successCriteria');
      return {
        content: JSON.stringify({
          sections: {
            successCriteria: repairedSuccessCriteria,
          },
        }),
        model: 'mock/repair',
        usage: usage(12),
        finishReason: 'stop',
      };
    });

    const result = await finalizeWithCompilerGates({
      initialResult: {
        content,
        model: 'mock/initial',
        usage: usage(40),
      },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Generate a verified PRD with concrete release criteria.',
      repairReviewer,
      compileDocument,
      enableContentReview: false,
    });

    expect(result.quality.valid).toBe(true);
    expect(result.repairAttempts).toHaveLength(0);
    expect(result.reviewerAttempts).toHaveLength(1);
    expect(result.content).toContain('Semantic verification blocks inconsistent PRDs before release approval.');
    expect(result.content).not.toContain('The project is successful when:');
    expect(repairReviewer).toHaveBeenCalledTimes(1);
    expect(compileDocument.mock.calls.length).toBeGreaterThan(1);
  });

  it('rewrites generic timeline boilerplate during deterministic targeted repair', async () => {
    const content = replaceSectionBody(
      buildSemanticVerifierPrd('- Release is complete after documentation review and semantic verification.'),
      'Timeline & Milestones',
      [
        'The project will be delivered in several phases:',
        '- Phase 1 covers initial implementation.',
        '- Phase 2 covers additional improvements.',
      ].join('\n')
    );
    const repairedTimeline = [
      '- Milestone 1 hardens compiler repair diagnostics before release approval.',
      '- Milestone 2 validates semantic verification against the canonical feature catalogue.',
      '- Milestone 3 persists reviewer-visible evidence for every accepted PRD.',
    ].join('\n');

    const compileDocument = vi.fn((candidate: string) => {
      const compiled = compilePrdDocument(candidate, {
        mode: 'generate',
        language: 'en',
        strictCanonical: true,
        strictLanguageConsistency: true,
        enableFeatureAggregation: true,
      });
      const stillGeneric = String(compiled.structure.timelineMilestones || '').includes('The project will be delivered in several phases:');

      return {
        ...compiled,
        quality: {
          ...compiled.quality,
          valid: !stillGeneric,
          issues: stillGeneric
            ? [{
              code: 'generic_section_boilerplate_timelineMilestones',
              message: 'Section appears generic and not context-specific: Timeline & Milestones',
              severity: 'error' as const,
            }]
            : [],
        },
      } as CompilePrdResult;
    });

    const repairReviewer = vi.fn(async (prompt: string, pass: number) => {
      expect(pass).toBe(1);
      expect(prompt).toContain('timelineMilestones');
      return {
        content: JSON.stringify({
          sections: {
            timelineMilestones: repairedTimeline,
          },
        }),
        model: 'mock/repair',
        usage: usage(12),
        finishReason: 'stop',
      };
    });

    const result = await finalizeWithCompilerGates({
      initialResult: {
        content,
        model: 'mock/initial',
        usage: usage(40),
      },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Generate a verified PRD with concrete delivery milestones.',
      repairReviewer,
      compileDocument,
      enableContentReview: false,
    });

    expect(result.quality.valid).toBe(true);
    expect(result.repairAttempts).toHaveLength(0);
    expect(result.reviewerAttempts).toHaveLength(1);
    expect(result.content).toContain('Milestone 1 hardens compiler repair diagnostics before release approval.');
    expect(result.content).not.toContain('The project will be delivered in several phases:');
    expect(repairReviewer).toHaveBeenCalledTimes(1);
    expect(compileDocument.mock.calls.length).toBeGreaterThan(1);
  });

  it('preserves deterministic reviewer attempts on compiler quality errors after targeted repair', async () => {
    const content = replaceSectionBody(
      buildSemanticVerifierPrd('- Release is complete after documentation review and semantic verification.'),
      'Timeline & Milestones',
      [
        'The project will be delivered in several phases:',
        '- Phase 1 covers initial implementation.',
        '- Phase 2 covers additional improvements.',
      ].join('\n')
    );
    const repairedTimeline = [
      '- Milestone 1 hardens compiler repair diagnostics before release approval.',
      '- Milestone 2 validates semantic verification against the canonical feature catalogue.',
      '- Milestone 3 persists reviewer-visible evidence for every accepted PRD.',
    ].join('\n');

    const compileDocument = vi.fn((candidate: string) => {
      const compiled = compilePrdDocument(candidate, {
        mode: 'generate',
        language: 'en',
        strictCanonical: true,
        strictLanguageConsistency: true,
        enableFeatureAggregation: true,
      });
      const stillGeneric = String(compiled.structure.timelineMilestones || '').includes('The project will be delivered in several phases:');

      return {
        ...compiled,
        quality: {
          ...compiled.quality,
          valid: false,
          issues: stillGeneric
            ? [{
              code: 'generic_section_boilerplate_timelineMilestones',
              message: 'Section appears generic and not context-specific: Timeline & Milestones',
              severity: 'error' as const,
            }]
            : [{
              code: 'persistent_quality_gap_for_test',
              message: 'A non-deterministic residual quality gap still blocks the repaired candidate.',
              severity: 'error' as const,
            }],
        },
      } as CompilePrdResult;
    });

    const repairReviewer = vi.fn(async (prompt: string, pass: number) => {
      expect(pass).toBe(1);
      expect(prompt).toContain('timelineMilestones');
      return {
        content: JSON.stringify({
          sections: {
            timelineMilestones: repairedTimeline,
          },
        }),
        model: 'mock/repair',
        usage: usage(12),
        finishReason: 'stop',
      };
    });

    let capturedError: unknown;
    try {
      await finalizeWithCompilerGates({
        initialResult: {
          content,
          model: 'mock/initial',
          usage: usage(40),
        },
        mode: 'generate',
        language: 'en',
        originalRequest: 'Generate a verified PRD with concrete delivery milestones.',
        repairReviewer,
        compileDocument,
        enableContentReview: false,
        maxRepairPasses: 0,
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(PrdCompilerQualityError);
    const qualityError = capturedError as PrdCompilerQualityError;
    expect(qualityError.repairAttempts).toHaveLength(0);
    expect(qualityError.reviewerAttempts).toHaveLength(1);
    expect(qualityError.reviewerAttempts[0]?.model).toBe('mock/repair');
    expect(qualityError.failureStage).toBe('compiler_repair');
    expect(repairReviewer).toHaveBeenCalledTimes(1);
  });

  it('rewrites timeline milestones from the canonical feature map before semantic repair', async () => {
    const original = [
      '## System Vision',
      'A browser-based Tetris platform focuses on core gameplay and long-term progression.',
      '',
      '## System Boundaries',
      'The system runs as a web application with authenticated users and persistent cloud storage.',
      '',
      '## Domain Model',
      'PlayerProfile stores profile state and progression. GameSession stores run score and session state.',
      '',
      '## Global Business Rules',
      'Feature IDs stay stable across all planning sections.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Player Profile',
      'Feature ID: F-01',
      '1. Purpose',
      'Allow players to update their saved profile preferences.',
      '2. Actors',
      'Player.',
      '3. Trigger',
      'The player opens profile settings.',
      '4. Preconditions',
      'The player is authenticated.',
      '5. Main Flow',
      '1. The player edits profile settings.',
      '2. The system persists the updated profile.',
      '6. Alternate Flows',
      '1. Validation errors block the save.',
      '7. Postconditions',
      'The profile remains saved across sessions.',
      '8. Data Impact',
      'Updates PlayerProfile preferences.',
      '9. UI Impact',
      'Shows editable profile controls.',
      '10. Acceptance Criteria',
      '- [ ] Players can save profile updates.',
      '- [ ] Saved profile changes appear after refresh.',
      '',
      '### F-02: Core Tetris Gameplay',
      'Feature ID: F-02',
      '1. Purpose',
      'Deliver the primary Tetris gameplay loop with persistent scoring.',
      '2. Actors',
      'Player.',
      '3. Trigger',
      'The player starts a run.',
      '4. Preconditions',
      'A new game session is available.',
      '5. Main Flow',
      '1. The player starts a run.',
      '2. The system updates score and run state.',
      '6. Alternate Flows',
      '1. Pausing and resuming the run preserves session state.',
      '7. Postconditions',
      'Run score is stored for later comparison.',
      '8. Data Impact',
      'Updates GameSession.score.',
      '9. UI Impact',
      'Shows the active board and score HUD.',
      '10. Acceptance Criteria',
      '- [ ] Players can complete a run.',
      '- [ ] The score HUD updates during active play.',
      '',
      '## Non-Functional Requirements',
      'Core gameplay remains responsive.',
      '',
      '## Error Handling & Recovery',
      'Recoverable failures do not lose player progress.',
      '',
      '## Deployment & Infrastructure',
      'The service runs in a containerized web environment.',
      '',
      '## Definition of Done',
      'Feature references remain consistent across sections.',
      '',
      '## Out of Scope',
      'Native mobile applications are excluded from this release.',
      '',
      '## Timeline & Milestones',
      '- Phase 1 delivers F-01 Core Tetris Gameplay.',
      '- Phase 2 delivers F-02 Player Profile hardening.',
      '',
      '## Success Criteria & Acceptance Testing',
      'Milestones match the implemented feature catalogue.',
    ].join('\n');

    const compileDocument = vi.fn((candidate: string) => {
      const compiled = compilePrdDocument(candidate, {
        mode: 'generate',
        language: 'en',
        strictCanonical: true,
        strictLanguageConsistency: true,
        enableFeatureAggregation: true,
      });
      const hasCanonicalTimeline =
        compiled.structure.timelineMilestones?.includes('F-01 Player Profile')
        && compiled.structure.timelineMilestones?.includes('F-02 Core Tetris Gameplay');

      return {
        ...compiled,
        quality: {
          ...compiled.quality,
          valid: true,
          issues: hasCanonicalTimeline
            ? compiled.quality.issues.filter(issue => issue.code !== 'timeline_feature_reference_mismatch')
            : compiled.quality.issues,
        },
      } as CompilePrdResult;
    });

    const repairReviewer = vi.fn(async () => ({
      content: original,
      model: 'mock/repair',
      usage: usage(10),
    }));

    const result = await finalizeWithCompilerGates({
      initialResult: { content: original, model: 'mock/initial', usage: usage(40) },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Generate a Tetris PRD with stable feature planning.',
      repairReviewer,
      compileDocument,
      enableContentReview: false,
    });

    expect(result.quality.valid).toBe(true);
    expect(result.timelineRewrittenFromFeatureMap).toBe(true);
    expect(result.timelineRewriteAppliedLines).toBeGreaterThan(0);
    expect(result.canonicalFeatureIds).toEqual(expect.arrayContaining(['F-01', 'F-02']));
    expect(result.content).toContain('F-01: Player Profile');
    expect(result.content).toContain('F-02: Core Tetris Gameplay');
    expect(repairReviewer).not.toHaveBeenCalled();
    expect(compileDocument.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('short-circuits compiler repair when feature catalogue format mismatch survives deterministic normalization', async () => {
    const compileDocument = vi.fn(() => ({
      content: '## Functional Feature Catalogue\n\n### F001 – Turbo Drop\n\nFeature ID: F001\n',
      structure: {
        features: [],
        featureCatalogueIntro: 'Visible feature catalogue heading but no parseable canonical feature blocks.',
        otherSections: {},
      },
      quality: {
        valid: false,
        truncatedLikely: false,
        missingSections: [],
        featureCount: 0,
        issues: [
          {
            code: 'feature_catalogue_format_mismatch',
            message: 'Feature catalogue exists in raw markdown but could not be parsed into canonical F-XX features.',
            severity: 'error' as const,
          },
        ],
        structuralParseReason: 'feature_catalogue_format_mismatch',
        rawFeatureHeadingSamples: ['### F001 – Turbo Drop'],
        normalizationApplied: true,
        normalizedFeatureCountRecovered: 0,
      },
    }));

    const repairReviewer = vi.fn(async () => ({
      content: 'unused',
      model: 'mock/repair',
      usage: usage(10),
    }));

    let capturedError: unknown;
    try {
      await finalizeWithCompilerGates({
        initialResult: {
          content: '## Functional Feature Catalogue\n\n### F001 – Turbo Drop',
          model: 'mock/initial',
          usage: usage(20),
        },
        mode: 'generate',
        language: 'en',
        originalRequest: 'Generate a deterministic PRD.',
        repairReviewer,
        compileDocument,
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(PrdCompilerQualityError);
    expect(repairReviewer).not.toHaveBeenCalled();
    expect((capturedError as PrdCompilerQualityError).quality.structuralParseReason).toBe('feature_catalogue_format_mismatch');
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

    expect(repairReviewer).toHaveBeenCalledTimes(0);
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
        missingSections: ['Definition of Done'],
        featureCount: 0,
        issues: [
          {
            code: 'missing_section_definitionOfDone',
            message: 'Missing required section: Definition of Done',
            severity: 'error',
          },
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
        features: [{
          id: 'F-01',
          name: 'Feature',
          rawContent: 'Feature body',
          purpose: 'Deliver a concrete, user-visible capability with deterministic validation and language fixes.',
          actors: 'Authenticated user',
          trigger: 'The user starts the workflow from the editor UI.',
          preconditions: 'A valid PRD draft is loaded and compiler validation is enabled.',
          mainFlow: [
            'The user starts the workflow.',
            'The system validates the PRD and applies the requested repair.',
            'The updated PRD is presented back to the user.',
          ],
          alternateFlows: [
            'If validation fails, the system returns actionable feedback instead of persisting invalid content.',
          ],
          postconditions: 'The repaired PRD remains valid and available for review.',
          dataImpact: 'Updates the PRD revision and attached diagnostics.',
          acceptanceCriteria: [
            'The workflow produces a valid PRD after repairing boilerplate, leaks, and language mismatches.',
            'Users receive actionable diagnostics when the repair cannot produce a valid PRD.',
          ],
        }],
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
            valid: false, truncatedLikely: false, missingSections: ['Definition of Done'],
            featureCount: 1,
            issues: [{ code: 'missing_section_definitionOfDone', message: 'Missing required section: Definition of Done', severity: 'error' as const }],
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

  it('rejects collapsing full-document repairs and keeps the best pre-repair candidate as degraded content', async () => {
    const bestContent = [
      '## System Vision',
      'A collaborative task platform helps teams capture, prioritize, and complete work quickly.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Task Capture',
      '1. Purpose',
      'Allow users to create structured tasks with title, due date, and priority.',
      '2. Actors',
      'Authenticated user',
      '3. Trigger',
      'The user submits the create-task form.',
      '4. Preconditions',
      'The user is signed in and the workspace is active.',
      '5. Main Flow',
      '1. The user enters task details.',
      '2. The system validates the task.',
      '3. The system stores the task and refreshes the board.',
      '7. Postconditions',
      'The new task is visible on the board with the selected priority and due date.',
      '8. Data Impact',
      'Creates Task.title, Task.priority, Task.dueDate, and Task.status.',
      '10. Acceptance Criteria',
      '- A created task appears on the board with the entered priority and due date.',
    ].join('\n');

    const collapsedRepair = [
      '## System Vision',
      'A collaborative task platform helps teams capture, prioritize, and complete work quickly.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: F-01',
      'Feature ID: F-01',
      '1. Purpose',
      '**',
      '2. Actors',
      '**',
      '3. Trigger',
      '**',
      '4. Preconditions',
      '**',
      '5. Main Flow',
      '1. **',
      '7. Postconditions',
      '**',
      '8. Data Impact',
      '**',
      '10. Acceptance Criteria',
      '- The feature works as expected for all users.',
      '',
      '### F-02: F-02',
      'Feature ID: F-02',
      '1. Purpose',
      '**',
      '2. Actors',
      '**',
      '3. Trigger',
      '**',
      '4. Preconditions',
      '**',
      '5. Main Flow',
      '1. **',
      '7. Postconditions',
      '**',
      '8. Data Impact',
      '**',
      '10. Acceptance Criteria',
      '- The feature works as expected for all users.',
      '',
      '## Definition of Done',
      '',
    ].join('\n');

    const compileDocument = vi.fn((content: string) => {
      if (content === collapsedRepair) {
        return {
          content,
          structure: {
            systemVision: 'A collaborative task platform helps teams capture, prioritize, and complete work quickly.',
            features: [
              {
                id: 'F-01',
                name: 'F-01',
                rawContent: 'collapsed',
                purpose: '**',
                actors: '**',
                trigger: '**',
                preconditions: '**',
                mainFlow: ['**'],
                postconditions: '**',
                dataImpact: '**',
                acceptanceCriteria: ['The feature works as expected for all users.'],
              },
              {
                id: 'F-02',
                name: 'F-02',
                rawContent: 'collapsed',
                purpose: '**',
                actors: '**',
                trigger: '**',
                preconditions: '**',
                mainFlow: ['**'],
                postconditions: '**',
                dataImpact: '**',
                acceptanceCriteria: ['The feature works as expected for all users.'],
              },
            ],
            otherSections: {},
          },
          quality: {
            valid: false,
            truncatedLikely: false,
            missingSections: ['Definition of Done'],
            featureCount: 2,
            issues: [
              {
                code: 'missing_section_definitionOfDone',
                message: 'Missing required section: Definition of Done',
                severity: 'error' as const,
              },
              {
                code: 'boilerplate_repetition_detected',
                message: 'Repeated boilerplate sentence detected across feature blocks.',
                severity: 'error' as const,
              },
            ],
          },
        } as CompilePrdResult;
      }

      return {
        content,
        structure: {
          systemVision: 'A collaborative task platform helps teams capture, prioritize, and complete work quickly.',
          features: [
            {
              id: 'F-01',
              name: 'Task Capture',
              rawContent: 'good',
              purpose: 'Allow users to create structured tasks with title, due date, and priority.',
              actors: 'Authenticated user',
              trigger: 'The user submits the create-task form.',
              preconditions: 'The user is signed in and the workspace is active.',
              mainFlow: [
                'The user enters task details.',
                'The system validates the task.',
                'The system stores the task and refreshes the board.',
              ],
              postconditions: 'The new task is visible on the board with the selected priority and due date.',
              dataImpact: 'Creates Task.title, Task.priority, Task.dueDate, and Task.status.',
              acceptanceCriteria: [
                'A created task appears on the board with the entered priority and due date.',
              ],
            },
          ],
          otherSections: {},
        },
        quality: {
          valid: false,
          truncatedLikely: false,
          missingSections: ['Definition of Done'],
          featureCount: 1,
          issues: [
            {
              code: 'missing_section_definitionOfDone',
              message: 'Missing required section: Definition of Done',
              severity: 'error' as const,
            },
          ],
        },
      } as CompilePrdResult;
    });

    let capturedError: unknown;
    try {
      await finalizeWithCompilerGates({
        initialResult: { content: bestContent, model: 'mock/initial', usage: usage(30) },
        mode: 'generate',
        language: 'en',
        originalRequest: 'Generate a task management PRD.',
        maxRepairPasses: 1,
        repairReviewer: async () => ({
          content: collapsedRepair,
          model: 'mock/repair',
          usage: usage(12),
          finishReason: 'stop',
        }),
        compileDocument,
        enableContentReview: false,
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(PrdCompilerQualityError);
    const qualityError = capturedError as PrdCompilerQualityError;
    expect(qualityError.repairRejected).toBe(true);
    expect(qualityError.repairRejectedReason).toMatch(/Rejected compiler repair/i);
    expect(qualityError.repairDegradationSignals).toEqual(expect.arrayContaining([
      'feature_names_collapsed_to_ids',
      'placeholder_required_fields',
      'dummy_main_flow',
    ]));
    expect(qualityError.collapsedFeatureNameIds).toEqual([]);
    expect(qualityError.placeholderFeatureIds).toEqual(expect.arrayContaining(['F-01']));
    expect(qualityError.acceptanceBoilerplateFeatureIds).toEqual([]);
    expect(qualityError.featureQualityFloorFeatureIds).toEqual(expect.arrayContaining(['F-01']));
    expect(qualityError.featureQualityFloorFailedFeatureIds).toEqual([]);
    expect(qualityError.featureQualityFloorPassed).toBe(true);
    expect(qualityError.primaryFeatureQualityReason).toBeUndefined();
    expect(qualityError.emptyMainFlowFeatureIds).toEqual([]);
    expect(qualityError.placeholderPurposeFeatureIds).toEqual([]);
    expect(qualityError.thinAcceptanceCriteriaFeatureIds).toEqual([]);
    expect(qualityError.compiledContent).toBe(bestContent);
    expect(qualityError.degradedCandidateAvailable).toBe(true);
    expect(qualityError.degradedCandidateSource).toBe('pre_repair_best');
    expect(qualityError.displayedCandidateSource).toBe('pre_repair_best');
    expect(qualityError.diagnosticsAlignedWithDisplayedCandidate).toBe(true);
  });

  it('stops full-document compiler repair after repeated length truncations and exposes diagnostics', async () => {
    const compileDocument = vi.fn(() => ({
      content: 'invalid',
      structure: { features: [], otherSections: {} },
      quality: {
        valid: false,
        truncatedLikely: false,
        missingSections: ['System Vision'],
        featureCount: 0,
        issues: [
          { code: 'missing_section_systemVision', message: 'Missing required section: System Vision', severity: 'error' as const },
        ],
      },
    }));

    let capturedError: unknown;
    try {
      await finalizeWithCompilerGates({
        initialResult: { content: 'initial', model: 'mock', usage: usage(10) },
        mode: 'generate',
        language: 'en',
        originalRequest: 'Generate complete PRD.',
        maxRepairPasses: 5,
        repairReviewer: async () => ({
          content: 'still invalid',
          model: 'mock/repair',
          usage: usage(10),
          finishReason: 'length',
        }),
        compileDocument,
        enableContentReview: false,
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(PrdCompilerQualityError);
    expect(compileDocument).toHaveBeenCalled();
    const qualityError = capturedError as PrdCompilerQualityError;
    expect(qualityError.compilerRepairTruncationCount).toBe(2);
    expect(qualityError.compilerRepairFinishReasons).toEqual(['length', 'length']);
  });

  it('recovers sparse generate output when deterministic completion fills required sections', async () => {
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

    let compileCall = 0;
    const compileDocument = vi.fn((candidate: string) => {
      compileCall++;
      if (compileCall === 1) {
        return compilePrdDocument(candidate, {
          mode: 'generate',
          language: 'en',
          strictCanonical: true,
          strictLanguageConsistency: true,
          enableFeatureAggregation: true,
        });
      }

      return {
        content: [
          '## System Vision',
          'A task management tool helps agile teams plan, update, and complete work quickly.',
          '',
          '## Non-Functional Requirements',
          'Board interactions remain responsive during active sprint planning.',
          '',
          '## Functional Feature Catalogue',
          '',
          '### F-01: Sprint Board',
          '1. Purpose',
          'Manage sprint tasks on a kanban board with clear workflow states and assignee visibility.',
          '2. Actors',
          'Team member, scrum master.',
          '3. Trigger',
          'A user opens the active sprint board.',
          '4. Preconditions',
          'An active sprint exists and the user has board access.',
          '5. Main Flow',
          '1. The user reviews tasks grouped by workflow column.',
          '2. The user drags a task to a new column.',
          '3. The system persists the change and refreshes the board state.',
          '6. Alternate Flows',
          '1. If the update conflicts with a stale board state, the system reloads the task and asks the user to retry.',
          '7. Postconditions',
          'The moved task appears in the target column with the latest board state.',
          '8. Data Impact',
          'Updates Task.status, Task.columnId, and board activity timestamps.',
          '9. UI Impact',
          'The board updates in place and highlights the moved task.',
          '10. Acceptance Criteria',
          '- Tasks can be moved between columns and persist after refresh.',
          '- Conflicting updates return clear feedback without losing the latest task state.',
          '',
          '## Success Criteria & Acceptance Testing',
          'Teams can update sprint tasks without losing the latest board state.',
        ].join('\n'),
        structure: {
          systemVision: 'A task management tool helps agile teams plan, update, and complete work quickly.',
          features: [
            {
              id: 'F-01',
              name: 'Sprint Board',
              rawContent: 'Structured feature body',
              purpose: 'Manage sprint tasks on a kanban board with clear workflow states and assignee visibility.',
              actors: 'Team member, scrum master.',
              trigger: 'A user opens the active sprint board.',
              preconditions: 'An active sprint exists and the user has board access.',
              mainFlow: [
                'The user reviews tasks grouped by workflow column.',
                'The user drags a task to a new column.',
                'The system persists the change and refreshes the board state.',
              ],
              alternateFlows: [
                'If the update conflicts with a stale board state, the system reloads the task and asks the user to retry.',
              ],
              postconditions: 'The moved task appears in the target column with the latest board state.',
              dataImpact: 'Updates Task.status, Task.columnId, and board activity timestamps.',
              uiImpact: 'The board updates in place and highlights the moved task.',
              acceptanceCriteria: [
                'Tasks can be moved between columns and persist after refresh.',
                'Conflicting updates return clear feedback without losing the latest task state.',
              ],
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
      } as CompilePrdResult;
    });

    const repairReviewer = vi.fn(async () => ({ content: minimal, model: 'mock/repair', usage: usage(10) }));
    const result = await finalizeWithCompilerGates({
      initialResult: { content: minimal, model: 'mock', usage: usage(80) },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Generate an agile task management tool PRD.',
      repairReviewer,
      compileDocument,
    });

    expect(result.quality.valid).toBe(true);
    expect(result.content).toContain('## Non-Functional Requirements');
    expect(result.content).toContain('## Success Criteria & Acceptance Testing');
    expect(repairReviewer.mock.calls.length).toBeLessThanOrEqual(1);
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

  it('stops before a second compiler repair pass when cancelCheck aborts the finalizer', async () => {
    const compileDocument = vi.fn((content: string) => ({
      content,
      structure: { features: [], otherSections: {} },
      quality: {
        valid: false,
        truncatedLikely: true,
        missingSections: ['System Vision'],
        featureCount: 0,
        issues: [
          {
            code: 'truncated_output',
            message: 'The PRD remains structurally incomplete.',
            severity: 'error' as const,
          },
        ],
      },
    }) as CompilePrdResult);
    const repairReviewer = vi.fn(async () => ({
      content: 'still invalid',
      model: 'mock/repair',
      usage: usage(10),
      finishReason: 'stop',
    }));
    const cancelCheck = vi.fn((stage: string) => {
      if (stage === 'compiler_repair_pass_2') {
        const abortError: any = new Error('Finalizer cancelled before second repair pass.');
        abortError.name = 'AbortError';
        abortError.code = 'ERR_CLIENT_DISCONNECT';
        throw abortError;
      }
    });

    await expect(finalizeWithCompilerGates({
      initialResult: { content: 'initial', model: 'mock/initial', usage: usage(20) },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Generate a complete PRD.',
      maxRepairPasses: 4,
      repairReviewer,
      compileDocument,
      enableContentReview: false,
      cancelCheck,
    })).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ERR_CLIENT_DISCONNECT',
    });

    expect(repairReviewer).toHaveBeenCalledTimes(1);
    expect(cancelCheck).toHaveBeenCalledWith('compiler_repair_pass_1');
    expect(cancelCheck).toHaveBeenCalledWith('compiler_repair_pass_2');
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
    const repairedDefinitionOfDone = replaceSectionBody(
      compiledOriginal.content,
      'Definition of Done',
      '- Release is complete only after semantic verification passes and diagnostics are persisted.'
    );
    const repairedDefinitionOfDoneBody = repairedDefinitionOfDone
      .split('## Definition of Done\n')[1]
      .split('\n\n## Out of Scope')[0]
      .trim();
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
    const semanticRefineReviewer = vi.fn(async () => ({
      content: JSON.stringify({
        sections: {
          definitionOfDone: repairedDefinitionOfDoneBody,
        },
      }),
      model: 'mock/reviewer',
      usage: usage(12),
      finishReason: 'stop',
    }));

    const result = await finalizeWithCompilerGates({
      initialResult: { content: original, model: 'mock/initial', usage: usage(40) },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Generate a verified PRD.',
      repairReviewer: async () => ({ content: original, model: 'mock/repair', usage: usage(10) }),
      semanticRefineReviewer,
      semanticVerifier,
      enableContentReview: false,
    });

    expect(result.semanticVerification?.verdict).toBe('pass');
    expect(result.semanticRepairApplied).toBe(true);
    expect(result.semanticRepairAttempted).toBe(true);
    expect(result.semanticRepairIssueCodes).toEqual(['cross_section_inconsistency']);
    expect(result.semanticRepairSectionKeys).toEqual(['definitionOfDone']);
    expect(semanticRefineReviewer).toHaveBeenCalledTimes(1);
    expect(semanticVerifier).toHaveBeenCalledTimes(2);
    expect(result.reviewerAttempts).toHaveLength(1);
  });

  it('runs a second targeted semantic repair cycle when new blockers emerge after the first repair', async () => {
    const original = buildSemanticVerifierPrd('- Release is complete.');
    const compiledOriginal = compilePrdDocument(original, {
      mode: 'improve',
      language: 'en',
      strictCanonical: true,
      strictLanguageConsistency: true,
      enableFeatureAggregation: true,
      contextHint: 'Improve the PRD without semantic contradictions.',
    });
    const firstRepair = replaceSectionBody(
      compiledOriginal.content,
      'System Vision',
      'The release ships a Tetris loop with power-ups and explicit roguelite meta progression that must remain consistent across feature lifecycle data.'
    );
    const secondRepair = replaceSectionBody(
      firstRepair,
      'Domain Model',
      'PlayerProfile stores playerId, xp, and level for roguelite progression. GameSession stores sessionId, activePowerUpId, and score for each run. PowerUp stores powerUpId, label, effectType, and cooldown.'
    );
    const firstRepairVisionBody = firstRepair
      .split('## System Vision\n')[1]
      .split('\n\n## System Boundaries')[0]
      .trim();
    const secondRepairDomainBody = secondRepair
      .split('## Domain Model\n')[1]
      .split('\n\n## Global Business Rules')[0]
      .trim();
    const semanticVerifier = vi.fn()
      .mockResolvedValueOnce({
        verdict: 'fail' as const,
        blockingIssues: [
          {
            code: 'cross_section_inconsistency',
            sectionKey: 'systemVision',
            message: 'System Vision does not describe the roguelite progression consistently.',
            suggestedAction: 'rewrite' as const,
          },
          {
            code: 'feature_section_semantic_mismatch',
            sectionKey: 'feature:F-01',
            message: 'Feature F-01 does not encode the progression in lifecycle fields. Rewrite: preconditions, postconditions, dataImpact',
            suggestedAction: 'enrich' as const,
            targetFields: ['preconditions', 'postconditions', 'dataImpact'] as const,
          },
        ],
        model: 'mock/verifier',
        usage: usage(8),
      })
      .mockResolvedValueOnce({
        verdict: 'fail' as const,
        blockingIssues: [
          {
            code: 'schema_field_mismatch',
            sectionKey: 'domainModel',
            message: 'Domain Model still lacks the cooldown field required by the business rules.',
            suggestedAction: 'rewrite' as const,
          },
        ],
        model: 'mock/verifier',
        usage: usage(8),
      })
      .mockResolvedValueOnce({
        verdict: 'pass' as const,
        blockingIssues: [],
        model: 'mock/verifier',
        usage: usage(8),
      });

    const semanticRefineReviewer = vi.fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          sections: {
            systemVision: firstRepairVisionBody,
          },
          features: [
            {
              id: 'F-01',
              fields: {
                preconditions: 'A game session is active and the player profile already tracks XP and level progression.',
                postconditions: 'The run updates progression state consistently with the active power-up and earned XP.',
                dataImpact: 'Updates PlayerProfile.xp, PlayerProfile.level, GameSession.activePowerUpId, and GameSession.score.',
              },
            },
          ],
        }),
        model: 'mock/reviewer',
        usage: usage(12),
        finishReason: 'stop',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          sections: {
            domainModel: secondRepairDomainBody,
          },
        }),
        model: 'mock/reviewer',
        usage: usage(12),
        finishReason: 'stop',
      });

    const result = await finalizeWithCompilerGates({
      initialResult: { content: original, model: 'mock/initial', usage: usage(40) },
      mode: 'improve',
      language: 'en',
      originalRequest: 'Improve the Tetris PRD without semantic contradictions.',
      repairReviewer: async () => ({ content: original, model: 'mock/repair', usage: usage(10) }),
      semanticRefineReviewer,
      semanticVerifier,
      enableContentReview: false,
    });

    expect(result.semanticVerification?.verdict).toBe('pass');
    expect(result.semanticRepairApplied).toBe(true);
    expect(result.semanticRepairAttempted).toBe(true);
    expect(result.repairCycleCount).toBe(2);
    expect(result.initialSemanticBlockingIssues?.map(issue => issue.sectionKey)).toEqual(['systemVision', 'feature:F-01']);
    expect(result.postRepairSemanticBlockingIssues?.map(issue => issue.sectionKey)).toEqual(['domainModel']);
    expect(result.finalSemanticBlockingIssues).toEqual([]);
    expect(semanticRefineReviewer).toHaveBeenCalledTimes(2);
    expect(semanticVerifier).toHaveBeenCalledTimes(3);
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
      semanticRefineReviewer: async () => ({
        content: JSON.stringify({
          sections: {
            definitionOfDone: '- Release is complete after documentation review.',
          },
        }),
        model: 'mock/reviewer',
        usage: usage(12),
        finishReason: 'stop',
      }),
      semanticVerifier,
      enableContentReview: false,
    })).rejects.toMatchObject({
      failureStage: 'semantic_verifier',
      semanticRepairApplied: true,
      semanticRepairAttempted: true,
      semanticRepairIssueCodes: ['cross_section_inconsistency'],
      semanticRepairSectionKeys: ['definitionOfDone'],
      repairGapReason: 'repair_no_substantive_change',
      repairCycleCount: 2,
    });

    try {
      await finalizeWithCompilerGates({
        initialResult: { content: original, model: 'mock/initial', usage: usage(40) },
        mode: 'generate',
        language: 'en',
        originalRequest: 'Generate a verified PRD.',
        repairReviewer: async () => ({ content: original, model: 'mock/repair', usage: usage(10) }),
        semanticRefineReviewer: async () => ({
          content: JSON.stringify({
            sections: {
              definitionOfDone: '- Release is complete after documentation review.',
            },
          }),
          model: 'mock/reviewer',
          usage: usage(12),
          finishReason: 'stop',
        }),
        semanticVerifier,
        enableContentReview: false,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(PrdCompilerQualityError);
      const qualityError = error as PrdCompilerQualityError;
      expect(qualityError.quality.issues.some(issue => issue.code === 'semantic_verifier_blocked')).toBe(true);
      expect(qualityError.semanticRepairAttempted).toBe(true);
      expect(qualityError.repairGapReason).toBe('repair_no_substantive_change');
      expect(qualityError.postRepairSemanticBlockingIssues.map(issue => issue.sectionKey)).toEqual(['definitionOfDone']);
      expect(qualityError.finalSemanticBlockingIssues.map(issue => issue.sectionKey)).toEqual(['definitionOfDone']);
    }
  });

  it('retries semantic repair with smaller batches after truncation', async () => {
    const original = buildSemanticVerifierPrd('- Release is complete.');
    const compiledOriginal = compilePrdDocument(original, {
      mode: 'generate',
      language: 'en',
      strictCanonical: true,
      strictLanguageConsistency: true,
      enableFeatureAggregation: true,
      contextHint: 'Generate a verified PRD.',
    });
    const repairedDefinitionOfDone = replaceSectionBody(
      compiledOriginal.content,
      'Definition of Done',
      '- Release is complete only after semantic verification passes and diagnostics are persisted.'
    );
    const repairedTimeline = replaceSectionBody(
      repairedDefinitionOfDone,
      'Timeline & Milestones',
      '- Milestone 1 stabilizes compiler repair.\n- Milestone 2 resolves semantic blockers before release.\n- Milestone 3 publishes persisted diagnostics and recovery guidance.'
    );
    const repairedDefinitionOfDoneBody = repairedTimeline
      .split('## Definition of Done\n')[1]
      .split('\n\n## Out of Scope')[0]
      .trim();
    const repairedTimelineBody = repairedTimeline
      .split('## Timeline & Milestones\n')[1]
      .split('\n\n## Success Criteria & Acceptance Testing')[0]
      .trim();

    const semanticVerifier = vi.fn()
      .mockResolvedValueOnce({
        verdict: 'fail' as const,
        blockingIssues: [
          {
            code: 'cross_section_inconsistency',
            sectionKey: 'definitionOfDone',
            message: 'Definition of Done omits the mandatory semantic verification gate.',
            suggestedAction: 'rewrite' as const,
          },
          {
            code: 'business_rule_contradiction',
            sectionKey: 'timelineMilestones',
            message: 'Timeline does not reserve a milestone for semantic verification recovery.',
            suggestedAction: 'rewrite' as const,
          },
        ],
        model: 'mock/verifier',
        usage: usage(8),
      })
      .mockResolvedValueOnce({
        verdict: 'pass' as const,
        blockingIssues: [],
        model: 'mock/verifier',
        usage: usage(8),
      });

    const semanticRefineReviewer = vi.fn()
      .mockResolvedValueOnce({
        content: '{"sections":{"definitionOfDone":"truncated',
        model: 'mock/reviewer',
        usage: usage(12),
        finishReason: 'length',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          sections: {
            definitionOfDone: repairedDefinitionOfDoneBody,
          },
        }),
        model: 'mock/reviewer',
        usage: usage(12),
        finishReason: 'stop',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          sections: {
            timelineMilestones: repairedTimelineBody,
          },
        }),
        model: 'mock/reviewer',
        usage: usage(12),
        finishReason: 'stop',
      });

    const result = await finalizeWithCompilerGates({
      initialResult: { content: original, model: 'mock/initial', usage: usage(40) },
      mode: 'generate',
      language: 'en',
      originalRequest: 'Generate a verified PRD.',
      repairReviewer: async () => ({ content: original, model: 'mock/repair', usage: usage(10) }),
      semanticRefineReviewer,
      semanticVerifier,
      enableContentReview: false,
    });

    expect(result.semanticVerification?.verdict).toBe('pass');
    expect(result.semanticRepairApplied).toBe(true);
    expect(result.semanticRepairTruncated).toBe(true);
    expect(result.semanticRepairSectionKeys).toEqual(['definitionOfDone', 'timelineMilestones']);
    expect(semanticRefineReviewer).toHaveBeenCalledTimes(2);
    expect(semanticVerifier).toHaveBeenCalledTimes(2);
  });
});
