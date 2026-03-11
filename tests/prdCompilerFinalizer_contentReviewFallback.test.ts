import { describe, it, expect, vi } from 'vitest';
import { finalizeWithCompilerGates, PrdCompilerQualityError } from '../server/prdCompilerFinalizer';
import type { CompilePrdResult } from '../server/prdCompiler';

function usage(total: number) {
  return {
    prompt_tokens: Math.floor(total / 2),
    completion_tokens: total - Math.floor(total / 2),
    total_tokens: total,
  };
}

describe('prdCompilerFinalizer excessive fallback review guard', () => {
  const featureRawContent = [
    '### F-01: Sprint Board',
    '**Purpose:** Enable delivery teams to visualise and coordinate sprint work by dragging tasks across workflow columns on a shared board.',
    '**Actors:** Primary: scrum master, team members. Secondary: product owner reviewing progress.',
    '**Trigger:** User opens the sprint board view from the navigation menu.',
    '**Preconditions:** An active sprint exists with at least one task assigned to the team.',
    '**Main Flow:**',
    '1. Scrum master opens the board and reviews the current task assignments across columns.',
    '2. Team members drag tasks between To Do, In Progress, and Done columns to reflect status changes.',
    '3. Board broadcasts updates in real time so all participants see the latest state.',
    '**Alternate Flows:**',
    '1. Concurrent move conflict: when two users drag the same task simultaneously the board shows a merge prompt and the later move is queued.',
    '**Postconditions:** Task statuses are persisted and reflected consistently across all team views.',
    '**Data Impact:** Task status records are updated in the sprint table with an audit trail entry per move.',
    '**UI Impact:** Board columns reflect updated task positions with smooth drag-and-drop animations.',
    '**Acceptance Criteria:**',
    '- Teams can move tasks between workflow columns and see updates within one second.',
  ].join('\n');

  it('blocks fallback-heavy improve output at content review after targeted refinement attempts', async () => {
    const content = [
      '## System Vision',
      'A sprint planning workspace for agile delivery teams.',
      '',
      '## System Boundaries',
      'Web application for sprint planning and board management.',
      '',
      '## Domain Model',
      '- Sprint, Task, Team, Board.',
      '',
      '## Global Business Rules',
      '- Sprint goals must be approved before execution begins.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Sprint Board',
      '**Purpose:** Enable delivery teams to visualise and coordinate sprint work by dragging tasks across workflow columns on a shared board.',
      '**Actors:** Primary: scrum master, team members. Secondary: product owner reviewing progress.',
      '**Trigger:** User opens the sprint board view from the navigation menu.',
      '**Preconditions:** An active sprint exists with at least one task assigned to the team.',
      '**Main Flow:**',
      '1. Scrum master opens the board and reviews the current task assignments across columns.',
      '2. Team members drag tasks between To Do, In Progress, and Done columns to reflect status changes.',
      '3. Board broadcasts updates in real time so all participants see the latest state.',
      '**Alternate Flows:**',
      '1. Concurrent move conflict: when two users drag the same task simultaneously the board shows a merge prompt and the later move is queued.',
      '**Postconditions:** Task statuses are persisted and reflected consistently across all team views.',
      '**Data Impact:** Task status records are updated in the sprint table with an audit trail entry per move.',
      '**UI Impact:** Board columns reflect updated task positions with smooth drag-and-drop animations.',
      '**Acceptance Criteria:**',
      '- Teams can move tasks between workflow columns and see updates within one second.',
      '',
      '## Non-Functional Requirements',
      '- Board updates render within one second.',
      '',
      '## Error Handling & Recovery',
      '- Conflicts show retry guidance.',
      '',
      '## Deployment & Infrastructure',
      '- Node service with PostgreSQL.',
      '',
      '## Definition of Done',
      '- QA review and passing tests are required.',
      '',
      '## Out of Scope',
      '- No mobile app in this release.',
      '',
      '## Timeline & Milestones',
      '- Phase 1 delivers backlog import; Phase 2 delivers automation.',
      '',
      '## Success Criteria & Acceptance Testing',
      '- Planning time stays below twenty minutes per sprint.',
    ].join('\n');

    const compiled: CompilePrdResult = {
      content,
      structure: {
        systemVision: 'A sprint planning workspace for agile delivery teams.',
        systemBoundaries: 'Web application for sprint planning and board management.',
        domainModel: '- Sprint, Task, Team, Board.',
        globalBusinessRules: '- Sprint goals must be approved before execution begins.',
        features: [{
          id: 'F-01',
          name: 'Sprint Board',
          rawContent: featureRawContent,
          purpose: 'Enable delivery teams to visualise and coordinate sprint work by dragging tasks across workflow columns on a shared board.',
          actors: 'Primary: scrum master, team members. Secondary: product owner reviewing progress.',
          trigger: 'User opens the sprint board view from the navigation menu.',
          preconditions: 'An active sprint exists with at least one task assigned to the team.',
          mainFlow: [
            'Scrum master opens the board and reviews the current task assignments across columns.',
            'Team members drag tasks between To Do, In Progress, and Done columns to reflect status changes.',
            'Board broadcasts updates in real time so all participants see the latest state.',
          ],
          alternateFlows: [
            'Concurrent move conflict: when two users drag the same task simultaneously the board shows a merge prompt and the later move is queued.',
          ],
          postconditions: 'Task statuses are persisted and reflected consistently across all team views.',
          dataImpact: 'Task status records are updated in the sprint table with an audit trail entry per move.',
          uiImpact: 'Board columns reflect updated task positions with smooth drag-and-drop animations.',
          acceptanceCriteria: ['Teams can move tasks between workflow columns and see updates within one second.'],
        }],
        nonFunctional: '- Board updates render within one second.',
        errorHandling: '- Conflicts show retry guidance.',
        deployment: '- Node service with PostgreSQL.',
        definitionOfDone: '- QA review and passing tests are required.',
        outOfScope: '- No mobile app in this release.',
        timelineMilestones: '- Phase 1 delivers backlog import; Phase 2 delivers automation.',
        successCriteria: '- Planning time stays below twenty minutes per sprint.',
        otherSections: {},
      },
      quality: {
        valid: true,
        truncatedLikely: false,
        missingSections: [],
        featureCount: 1,
        issues: [{ severity: 'warning', code: 'excessive_fallback_sections', message: '11/11 sections were auto-generated by the compiler.' }],
        fallbackSections: ['systemBoundaries', 'domainModel', 'globalBusinessRules', 'nonFunctional', 'errorHandling', 'deployment', 'definitionOfDone', 'outOfScope', 'timelineMilestones', 'successCriteria'],
      },
    };

    const compileDocument = vi.fn(() => compiled);

    let capturedError: unknown;

    try {
      await finalizeWithCompilerGates({
        initialResult: { content, model: 'mock/initial', usage: usage(80) },
        mode: 'improve',
        existingContent: content,
        language: 'en',
        originalRequest: 'Tighten an agile sprint planning PRD.',
        repairReviewer: async () => ({ content, model: 'mock/repair', usage: usage(10) }),
        contentRefineReviewer: async () => ({ content, model: 'mock/refine', usage: usage(10) }),
        compileDocument,
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(PrdCompilerQualityError);
    expect(capturedError).toMatchObject({
      failureStage: 'content_review',
    });
    expect(compileDocument).toHaveBeenCalledTimes(4);
  });

  it('blocks the same fallback-heavy output earlier in compiler repair for generate mode', async () => {
    const content = [
      '## System Vision',
      'A sprint planning workspace for agile delivery teams.',
      '',
      '## System Boundaries',
      'Web application for sprint planning and board management.',
      '',
      '## Domain Model',
      '- Sprint, Task, Team, Board.',
      '',
      '## Global Business Rules',
      '- Sprint goals must be approved before execution begins.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Sprint Board',
      '**Purpose:** Enable delivery teams to visualise and coordinate sprint work by dragging tasks across workflow columns on a shared board.',
      '**Actors:** Primary: scrum master, team members. Secondary: product owner reviewing progress.',
      '**Trigger:** User opens the sprint board view from the navigation menu.',
      '**Preconditions:** An active sprint exists with at least one task assigned to the team.',
      '**Main Flow:**',
      '1. Scrum master opens the board and reviews the current task assignments across columns.',
      '2. Team members drag tasks between To Do, In Progress, and Done columns to reflect status changes.',
      '3. Board broadcasts updates in real time so all participants see the latest state.',
      '**Alternate Flows:**',
      '1. Concurrent move conflict: when two users drag the same task simultaneously the board shows a merge prompt and the later move is queued.',
      '**Postconditions:** Task statuses are persisted and reflected consistently across all team views.',
      '**Data Impact:** Task status records are updated in the sprint table with an audit trail entry per move.',
      '**UI Impact:** Board columns reflect updated task positions with smooth drag-and-drop animations.',
      '**Acceptance Criteria:**',
      '- Teams can move tasks between workflow columns and see updates within one second.',
      '',
      '## Non-Functional Requirements',
      '- Board updates render within one second.',
      '',
      '## Error Handling & Recovery',
      '- Conflicts show retry guidance.',
      '',
      '## Deployment & Infrastructure',
      '- Node service with PostgreSQL.',
      '',
      '## Definition of Done',
      '- QA review and passing tests are required.',
      '',
      '## Out of Scope',
      '- No mobile app in this release.',
      '',
      '## Timeline & Milestones',
      '- Phase 1 delivers backlog import; Phase 2 delivers automation.',
      '',
      '## Success Criteria & Acceptance Testing',
      '- Planning time stays below twenty minutes per sprint.',
    ].join('\n');

    const compiled: CompilePrdResult = {
      content,
      structure: {
        systemVision: 'A sprint planning workspace for agile delivery teams.',
        systemBoundaries: 'Web application for sprint planning and board management.',
        domainModel: '- Sprint, Task, Team, Board.',
        globalBusinessRules: '- Sprint goals must be approved before execution begins.',
        features: [{
          id: 'F-01',
          name: 'Sprint Board',
          rawContent: featureRawContent,
          purpose: 'Enable delivery teams to visualise and coordinate sprint work by dragging tasks across workflow columns on a shared board.',
          actors: 'Primary: scrum master, team members. Secondary: product owner reviewing progress.',
          trigger: 'User opens the sprint board view from the navigation menu.',
          preconditions: 'An active sprint exists with at least one task assigned to the team.',
          mainFlow: [
            'Scrum master opens the board and reviews the current task assignments across columns.',
            'Team members drag tasks between To Do, In Progress, and Done columns to reflect status changes.',
            'Board broadcasts updates in real time so all participants see the latest state.',
          ],
          alternateFlows: [
            'Concurrent move conflict: when two users drag the same task simultaneously the board shows a merge prompt and the later move is queued.',
          ],
          postconditions: 'Task statuses are persisted and reflected consistently across all team views.',
          dataImpact: 'Task status records are updated in the sprint table with an audit trail entry per move.',
          uiImpact: 'Board columns reflect updated task positions with smooth drag-and-drop animations.',
          acceptanceCriteria: ['Teams can move tasks between workflow columns and see updates within one second.'],
        }],
        nonFunctional: '- Board updates render within one second.',
        errorHandling: '- Conflicts show retry guidance.',
        deployment: '- Node service with PostgreSQL.',
        definitionOfDone: '- QA review and passing tests are required.',
        outOfScope: '- No mobile app in this release.',
        timelineMilestones: '- Phase 1 delivers backlog import; Phase 2 delivers automation.',
        successCriteria: '- Planning time stays below twenty minutes per sprint.',
        otherSections: {},
      },
      quality: {
        valid: true,
        truncatedLikely: false,
        missingSections: [],
        featureCount: 1,
        issues: [{ severity: 'warning', code: 'excessive_fallback_sections', message: '11/11 sections were auto-generated by the compiler.' }],
        fallbackSections: ['systemBoundaries', 'domainModel', 'globalBusinessRules', 'nonFunctional', 'errorHandling', 'deployment', 'definitionOfDone', 'outOfScope', 'timelineMilestones', 'successCriteria'],
      },
    };

    const compileDocument = vi.fn(() => compiled);
    const contentRefineReviewer = vi.fn(async () => ({ content, model: 'mock/refine', usage: usage(10) }));

    let capturedError: unknown;

    try {
      await finalizeWithCompilerGates({
        initialResult: { content, model: 'mock/initial', usage: usage(80) },
        mode: 'generate',
        language: 'en',
        originalRequest: 'Generate an agile sprint planning PRD.',
        repairReviewer: async () => ({ content, model: 'mock/repair', usage: usage(10) }),
        contentRefineReviewer,
        compileDocument,
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(PrdCompilerQualityError);
    expect(capturedError).toMatchObject({
      failureStage: 'compiler_repair',
    });
    expect(contentRefineReviewer).not.toHaveBeenCalled();
    expect(compileDocument).toHaveBeenCalledTimes(5);
  });
});
