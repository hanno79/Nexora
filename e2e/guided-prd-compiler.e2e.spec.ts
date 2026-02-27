import { test, expect } from '@playwright/test';
import {
  compilePrdDocument,
  looksLikeTruncatedOutput,
  validatePrdStructure,
} from '../server/prdCompiler';
import { parsePRDToStructure } from '../server/prdParser';

test.describe('Guided PRD compiler flow (e2e)', () => {
  test('generate mode produces a complete canonical document with planning sections', () => {
    const raw = [
      '## System Vision',
      'A collaborative planning workspace for product teams.',
      '',
      '## System Boundaries',
      'Browser-based app with authenticated access.',
      '',
      '## Domain Model',
      '- User, Workspace, PRD, Version, Comment.',
      '',
      '## Global Business Rules',
      '- Feature IDs are immutable once introduced.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Guided Refinement',
      '1. Purpose',
      'Allow users to improve existing PRDs iteratively.',
      '10. Acceptance Criteria',
      '- Refinement output is complete and structured.',
      '',
      '## Non-Functional Requirements',
      '- Runtime under 1 second for parser/assembler pass.',
      '',
      '## Error Handling & Recovery',
      '- Failed generation retries with repair loop.',
      '',
      '## Deployment & Infrastructure',
      '- Node backend with PostgreSQL persistence.',
      '',
      '## Definition of Done',
      '- All required sections are present and parseable.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'en',
    });

    expect(compiled.quality.valid).toBeTruthy();
    expect(compiled.quality.truncatedLikely).toBeFalsy();
    expect(compiled.quality.featureCount).toBeGreaterThan(0);

    expect(compiled.content).toContain('## Out of Scope');
    expect(compiled.content).toContain('## Timeline & Milestones');
    expect(compiled.content).toContain('## Success Criteria & Acceptance Testing');

    const reparsed = parsePRDToStructure(compiled.content);
    const reparsedQuality = validatePrdStructure(reparsed, compiled.content);
    expect(reparsedQuality.valid).toBeTruthy();
  });

  test('improve mode preserves baseline completeness when candidate output is truncated', async () => {
    const baseline = [
      '## System Vision',
      'Task collaboration platform for cross-functional teams.',
      '',
      '## System Boundaries',
      'Web app only, no native clients in v1.',
      '',
      '## Domain Model',
      '- Team, Project, Task, Comment, User.',
      '',
      '## Global Business Rules',
      '- Every task must map to exactly one project.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Realtime Task Updates',
      '1. Purpose',
      'Ensure task state updates are visible to all active users.',
      '10. Acceptance Criteria',
      '- Status changes are visible in both list and kanban views.',
      '',
      '## Non-Functional Requirements',
      '- Update propagation under 1 second for active users.',
      '',
      '## Error Handling & Recovery',
      '- On socket loss, reconnect and replay latest state.',
      '',
      '## Deployment & Infrastructure',
      '- Dockerized node service and postgres database.',
      '',
      '## Definition of Done',
      '- Stable realtime sync and green test suite.',
      '',
      '## Out of Scope',
      '- Native mobile clients are excluded in this release.',
      '',
      '## Timeline & Milestones',
      '- Week 1 planning, week 2 implementation, week 3 hardening.',
      '',
      '## Success Criteria & Acceptance Testing',
      '- 95% of updates are reflected on all clients in under 1 second.',
    ].join('\n');

    const truncatedCandidate = [
      '## Functional Feature Catalogue',
      '',
      '### F-01: Realtime Task Updates',
      '9. **UI-Auswirkungen**:',
      '   * Aufgabenkarten verschieben sich in der Kanban-Ansicht.',
      '10. **Akzeptanzkriterien**:',
      '   * Eine von einem Benutzer',
    ].join('\n');

    expect(looksLikeTruncatedOutput(truncatedCandidate)).toBeTruthy();

    const compiled = compilePrdDocument(truncatedCandidate, {
      mode: 'improve',
      existingContent: baseline,
      language: 'de',
    });

    expect(compiled.quality.valid).toBeTruthy();
    expect(compiled.quality.truncatedLikely).toBeFalsy();

    expect(compiled.content).toContain('## Out of Scope');
    expect(compiled.content).toContain('## Timeline & Milestones');
    expect(compiled.content).toContain('## Success Criteria & Acceptance Testing');
    expect(compiled.content).toContain('Native mobile clients are excluded in this release.');
  });

  test('canonical output remains deterministic across compile -> parse -> compile', async () => {
    const source = [
      '## System Vision',
      'Structured PRD generation with quality gates.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Compiler Quality Gate',
      '1. Purpose',
      'Reject incomplete outputs and trigger repairs.',
      '10. Acceptance Criteria',
      '- Invalid output never persists to final PRD.',
    ].join('\n');

    const first = compilePrdDocument(source, { mode: 'generate', language: 'en' });
    const reparsed = parsePRDToStructure(first.content);
    const second = compilePrdDocument(first.content, { mode: 'generate', language: 'en' });

    expect(first.quality.valid).toBeTruthy();
    expect(second.quality.valid).toBeTruthy();
    expect(reparsed.features.length).toBeGreaterThan(0);
    expect(second.content).toContain('## Success Criteria & Acceptance Testing');
    expect(second.content).toBe(first.content);
  });

  test('canonical gate rejects unknown top-level headings', async () => {
    const raw = [
      '## System Vision',
      'Stable output.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Gate',
      '1. Purpose',
      'Only canonical headings allowed.',
      '10. Acceptance Criteria',
      '- Unknown headings are rejected.',
      '',
      '## Project Overview',
      'Unexpected section.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, { mode: 'generate', language: 'en' });
    expect(compiled.quality.valid).toBeFalsy();
    expect(
      compiled.quality.issues.some(issue => issue.code === 'unknown_top_level_sections')
    ).toBeTruthy();
    expect(compiled.content).not.toContain('## Project Overview');
  });
});
