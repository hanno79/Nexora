/// <reference types="vitest" />
import {
  compilePrdDocument,
  looksLikeTruncatedOutput,
} from '../server/prdCompiler';

describe('prdCompiler', () => {
  it('detects likely truncated output tails', () => {
    const truncated = `
9. **UI-Auswirkungen**:
   * Neue Aufgaben erscheinen sofort in der Liste.
10. **Akzeptanzkriterien**:
   * Eine von einem Benutzer`;

    expect(looksLikeTruncatedOutput(truncated)).toBe(true);
  });

  it('preserves baseline structure in improve mode when candidate is incomplete', () => {
    const existing = [
      '## System Vision',
      'Task management collaboration platform with real-time updates.',
      '',
      '## System Boundaries',
      'Web app for authenticated teams.',
      '',
      '## Domain Model',
      '- Entities: Task, User, Board, Comment.',
      '',
      '## Global Business Rules',
      '- Feature IDs remain stable.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Task Updates',
      '1. Purpose',
      'Users can update task status.',
      '10. Acceptance Criteria',
      '- Status updates are visible to all users.',
      '',
      '## Non-Functional Requirements',
      '- Performance under 1s for realtime updates.',
      '',
      '## Error Handling & Recovery',
      '- Reconnect websocket on drop.',
      '',
      '## Deployment & Infrastructure',
      '- Node.js service, PostgreSQL.',
      '',
      '## Definition of Done',
      '- All required sections are complete.',
      '',
      '## Out of Scope',
      '- No native mobile app in this release.',
      '',
      '## Timeline & Milestones',
      '- Week 1 setup, week 2 delivery.',
      '',
      '## Success Criteria & Acceptance Testing',
      '- 95% realtime updates arrive within 1 second.',
    ].join('\n');

    const incompleteCandidate = `
## Functional Feature Catalogue

### F-01: Task Updates
9. **UI-Auswirkungen**:
   * Neue Aufgaben erscheinen sofort in der Liste.
10. **Akzeptanzkriterien**:
   * Eine von einem Benutzer`;

    const compiled = compilePrdDocument(incompleteCandidate, {
      mode: 'improve',
      existingContent: existing,
      language: 'en',
    });

    expect(compiled.quality.valid).toBe(true);
    expect(compiled.quality.featureCount).toBeGreaterThan(0);
    expect(compiled.content).toContain('## Out of Scope');
    expect(compiled.content).toContain('## Timeline & Milestones');
    expect(compiled.content).toContain('## Success Criteria & Acceptance Testing');
    expect(compiled.content).toContain('No native mobile app in this release');
  });

  it('adds required planning sections in generate mode', () => {
    const raw = [
      '## System Vision',
      'Simple PRD for a task board.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Create Task',
      '1. Purpose',
      'Users can create tasks quickly.',
      '10. Acceptance Criteria',
      '- Task appears in list immediately.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'en',
    });

    expect(compiled.quality.valid).toBe(true);
    expect(
      compiled.quality.issues.some(issue => issue.code === 'excessive_fallback_sections')
    ).toBe(true);
    expect(compiled.content).toContain('## Out of Scope');
    expect(compiled.content).toContain('## Timeline & Milestones');
    expect(compiled.content).toContain('## Success Criteria & Acceptance Testing');
  });

  it('keeps output stable across compile-parse-compile cycles', () => {
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

    const first = compilePrdDocument(source, {
      mode: 'generate',
      language: 'en',
    });

    const second = compilePrdDocument(first.content, {
      mode: 'generate',
      language: 'en',
    });

    expect(first.quality.valid).toBe(true);
    expect(second.quality.valid).toBe(true);
    expect(second.content).toBe(first.content);
  });

  it('preserves baseline section context in improve mode', () => {
    const existing = [
      '## System Vision',
      'Nexora keeps existing PRD context stable across refinements.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Baseline Feature',
      '1. Purpose',
      'Keep baseline context stable.',
      '10. Acceptance Criteria',
      '- Baseline survives improve runs.',
    ].join('\n');

    const candidate = [
      '## System Vision',
      'Completely new rewritten vision without baseline wording.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Baseline Feature',
      '1. Purpose',
      'A rewritten feature description.',
      '10. Acceptance Criteria',
      '- New acceptance details.',
    ].join('\n');

    const compiled = compilePrdDocument(candidate, {
      mode: 'improve',
      existingContent: existing,
      language: 'en',
    });

    expect(compiled.quality.valid).toBe(true);
    expect(compiled.content).toContain('Nexora keeps existing PRD context stable across refinements.');
    expect(compiled.content).toContain('Completely new rewritten vision without baseline wording.');
  });

  it('does not enforce a hard improve-mode feature cap', () => {
    const existing = [
      '## System Vision',
      'A configuration governance platform that centralises notification routing, billing record exports, access auditing, credential rotation, domain identity mapping, and data retention enforcement for enterprise teams.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Existing Feature',
      '1. Purpose',
      'Centralise governance configuration for enterprise teams across billing, auditing, and retention workflows.',
      '10. Acceptance Criteria',
      '- Existing feature remains.',
    ].join('\n');

    const candidate = [
      '## Functional Feature Catalogue',
      '',
      '### F-01: Existing Feature',
      '1. Purpose',
      'Centralise governance configuration for enterprise teams across billing, auditing, and retention workflows.',
      '10. Acceptance Criteria',
      '- Existing improved.',
      '',
      '### F-02: Notification Routing',
      '1. Purpose',
      'Route per-project notification preferences to the correct delivery channel.',
      '10. Acceptance Criteria',
      '- Notification routing preferences persist.',
      '',
      '### F-03: Billing Export',
      '1. Purpose',
      'Export billing records in CSV format for compliance reporting.',
      '10. Acceptance Criteria',
      '- Billing export file is generated.',
      '',
      '### F-04: Access Auditing',
      '1. Purpose',
      'Review recent access and permission changes across the governance platform.',
      '10. Acceptance Criteria',
      '- Audit entries are filterable by actor and date.',
      '',
      '### F-05: Credential Rotation',
      '1. Purpose',
      'Rotate integration credentials safely without service interruption.',
      '10. Acceptance Criteria',
      '- Rotated credentials become active immediately.',
      '',
      '### F-06: Domain Identity Mapping',
      '1. Purpose',
      'Map customer email domains to identity providers for the governance platform.',
      '10. Acceptance Criteria',
      '- Domain identity mapping resolves correct provider.',
      '',
      '### F-07: Retention Enforcement',
      '1. Purpose',
      'Apply retention windows to archived records for data governance compliance.',
      '10. Acceptance Criteria',
      '- Retention enforcement is applied by scheduled job.',
    ].join('\n');

    const compiled = compilePrdDocument(candidate, {
      mode: 'improve',
      existingContent: existing,
      language: 'en',
    });

    expect(compiled.quality.valid).toBe(true);
    expect(compiled.structure.features.length).toBe(7);
    expect(compiled.content).toContain('### F-07:');
    expect(
      compiled.quality.issues.some(issue => issue.code === 'improve_new_feature_limit_applied')
    ).toBe(false);
  });

  it('enforces strict canonical heading gate and rejects unknown top-level sections', () => {
    const raw = [
      '## System Vision',
      'Canonical vision.',
      '',
      '## System Boundaries',
      'Bounded scope.',
      '',
      '## Domain Model',
      '- User, PRD.',
      '',
      '## Global Business Rules',
      '- Stable IDs.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Compiler Gate',
      '1. Purpose',
      'Reject unknown sections.',
      '10. Acceptance Criteria',
      '- Unknown headings fail quality gate.',
      '',
      '## Non-Functional Requirements',
      '- Deterministic output.',
      '',
      '## Error Handling & Recovery',
      '- Repair loops.',
      '',
      '## Deployment & Infrastructure',
      '- Node + Postgres.',
      '',
      '## Definition of Done',
      '- Canonical output only.',
      '',
      '## Out of Scope',
      '- No mobile.',
      '',
      '## Timeline & Milestones',
      '- Phase 1, 2.',
      '',
      '## Success Criteria & Acceptance Testing',
      '- 95% valid output.',
      '',
      '## Project Overview',
      'This must be rejected by canonical gate.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'en',
    });

    expect(compiled.quality.valid).toBe(false);
    expect(
      compiled.quality.issues.some(issue => issue.code === 'unknown_top_level_sections')
    ).toBe(true);
    expect(compiled.content).not.toContain('## Project Overview');
  });

  it('accepts common template headings by canonicalizing them before quality gate', () => {
    const raw = [
      '## Problem Statement',
      'Teams lose context when refining PRDs across runs.',
      '',
      '## Goals & Success Metrics',
      '- Increase complete PRD outputs to 95%.',
      '',
      '## Target Audience',
      '- Product managers and technical leads.',
      '',
      '## User Stories',
      '- As a PM, I want iterative refinement so that missing sections are completed.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Canonical Compilation',
      '1. Purpose',
      'Normalize PRDs into stable canonical output.',
      '10. Acceptance Criteria',
      '- Output contains all required sections without unknown top-level headings.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'en',
    });

    expect(compiled.quality.valid).toBe(true);
    expect(
      compiled.quality.issues.some(issue => issue.code === 'unknown_top_level_sections')
    ).toBe(false);
    expect(compiled.content).toContain('## System Vision');
    expect(compiled.content).toContain('## System Boundaries');
    expect(compiled.content).toContain('## Success Criteria & Acceptance Testing');
    expect(compiled.content).toContain('As a PM, I want iterative refinement');
  });

  it('accepts guided legacy numbered headings by canonicalizing them before quality gate', () => {
    const raw = [
      '## 4. Ziele & Success Metrics',
      '- Reduce PRD refinement cycle time by 30%.',
      '',
      '## 5. Target Users',
      '- Product managers and engineering leads.',
      '',
      '## 9. User Interface Guidelines',
      '- Keep interactions consistent and accessible.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Guided Canonicalization',
      '1. Purpose',
      'Normalize guided outputs under strict compiler gates.',
      '10. Acceptance Criteria',
      '- Legacy guided headings no longer fail the unknown heading gate.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'de',
    });

    expect(compiled.quality.valid).toBe(true);
    expect(
      compiled.quality.issues.some(issue => issue.code === 'unknown_top_level_sections')
    ).toBe(false);
    expect(compiled.content).toContain('## System Boundaries');
    expect(compiled.content).toContain('## Non-Functional Requirements');
    expect(compiled.content).toContain('## Success Criteria & Acceptance Testing');
  });

  it('accepts Part A/C/D wrapper headings by canonicalizing them before quality gate', () => {
    const raw = [
      '## Part A — System Context',
      'Core context and scope baseline for this initiative.',
      '',
      '## Part C — Technical & Design Context',
      'Technical architecture and implementation constraints for v1.',
      '',
      '## Part D — Planning & Risk',
      'Milestone planning and risk checkpoints for staged rollout.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Canonical Wrapper Handling',
      '1. Purpose',
      'Ensure wrapper-style template headings compile into canonical structure.',
      '10. Acceptance Criteria',
      '- Wrapper headings are preserved semantically without unknown-heading errors.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'en',
    });

    expect(compiled.quality.valid).toBe(true);
    expect(
      compiled.quality.issues.some(issue => issue.code === 'unknown_top_level_sections')
    ).toBe(false);
    expect(compiled.content).toContain('## System Vision');
    expect(compiled.content).toContain('## Deployment & Infrastructure');
    expect(compiled.content).toContain('## Timeline & Milestones');
  });

  it('deterministically scaffolds unstructured feature prose into full feature specs', () => {
    const raw = [
      '## System Vision',
      'Task collaboration app for distributed teams.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Dashboard',
      'Users can see all tasks, filters and team activity in one place.',
      '',
      '### F-02: Realtime Sync',
      'Changes from one user appear to others in near real time.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'en',
    });

    expect(compiled.quality.valid).toBe(true);
    expect(compiled.structure.features.length).toBe(2);
    // Purpose is extracted from rawContent prose line
    expect(compiled.structure.features[0].purpose).toBeTruthy();
    // mainFlow and acceptanceCriteria may be empty when no structured subsections
    // are present in rawContent — generic boilerplate is no longer injected
  });

  it('improve mode ignores noisy regenerated feature catalogue intro and keeps baseline-first patching', () => {
    const existing = [
      '## System Vision',
      'A compliance document workspace that enables teams to author structured reports with deterministic validation, iterative refinement, and consistent formatting rules across all submissions.',
      '',
      '## System Boundaries',
      'Web application for structured compliance report authoring and validation.',
      '',
      '## Domain Model',
      '- Report, Submission, Validation Rule, Author.',
      '',
      '## Global Business Rules',
      '- Report identifiers are stable across refinement iterations.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Existing Feature',
      '1. Purpose',
      'Create compliance reports and validate them against deterministic rules to ensure completeness before submission.',
      '10. Acceptance Criteria',
      '- Authors can create structured reports that pass all deterministic validation rules before submission.',
      '',
      '## Non-Functional Requirements',
      '- Deterministic compilation.',
      '',
      '## Error Handling & Recovery',
      '- Retry on transient failure.',
      '',
      '## Deployment & Infrastructure',
      '- Node service.',
      '',
      '## Definition of Done',
      '- Complete structure.',
      '',
      '## Out of Scope',
      '- No mobile.',
      '',
      '## Timeline & Milestones',
      '- Week 1 and week 2.',
      '',
      '## Success Criteria & Acceptance Testing',
      '- 95% valid runs.',
    ].join('\n');

    const candidate = [
      '## Functional Feature Catalogue',
      '',
      '### 7. User Stories',
      '- As a PM, I want better drafts.',
      '',
      '### F-01: Existing Feature',
      '1. Purpose',
      'Create compliance reports and validate them with improved deterministic rules and formatting checks.',
      '10. Acceptance Criteria',
      '- Authors can create structured reports that pass all deterministic validation rules before submission.',
    ].join('\n');

    const compiled = compilePrdDocument(candidate, {
      mode: 'improve',
      existingContent: existing,
      language: 'en',
    });

    expect(compiled.quality.valid).toBe(true);
    expect(compiled.content).not.toContain('### 7. User Stories');
    expect(compiled.content).toContain('### F-01: Existing Feature');
  });

  it('deterministically expands short required sections instead of only warning', () => {
    const raw = [
      '## System Vision',
      'A structured and validated PRD flow.',
      '',
      '## System Boundaries',
      'Web-only application.',
      '',
      '## Domain Model',
      '- User, PRD.',
      '',
      '## Global Business Rules',
      '- Feature IDs stay stable.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Stable IDs',
      '1. Purpose',
      'Keep feature IDs stable.',
      '10. Acceptance Criteria',
      '- IDs are not reassigned across versions.',
      '',
      '## Non-Functional Requirements',
      '- Deterministic output.',
      '',
      '## Error Handling & Recovery',
      '- Repair on invalid output.',
      '',
      '## Deployment & Infrastructure',
      '- Node backend.',
      '',
      '## Definition of Done',
      '- Canonical PRD is complete.',
      '',
      '## Out of Scope',
      '- No native apps.',
      '',
      '## Timeline & Milestones',
      '- Phase 1 and phase 2.',
      '',
      '## Success Criteria & Acceptance Testing',
      '- 95% valid runs.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'en',
    });

    expect(compiled.quality.valid).toBe(true);
    expect(
      compiled.quality.issues.some(issue => issue.code === 'too_short_globalBusinessRules')
    ).toBe(false);
    expect(String(compiled.structure.globalBusinessRules || '').trim().length).toBeGreaterThanOrEqual(30);
  });

  it('removes too_short_globalBusinessRules warning in improve mode baseline patching', () => {
    const existing = [
      '## System Vision',
      'Baseline PRD.',
      '',
      '## System Boundaries',
      'Web app.',
      '',
      '## Domain Model',
      '- User, PRD.',
      '',
      '## Global Business Rules',
      '- Feature IDs bleiben stabil.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Guided Refinement',
      '1. Purpose',
      'Improve existing PRDs.',
      '10. Acceptance Criteria',
      '- Refinement is complete.',
      '',
      '## Non-Functional Requirements',
      '- Deterministic output.',
      '',
      '## Error Handling & Recovery',
      '- Repair failed outputs.',
      '',
      '## Deployment & Infrastructure',
      '- Node + Postgres.',
      '',
      '## Definition of Done',
      '- Required sections complete.',
      '',
      '## Out of Scope',
      '- No mobile app.',
      '',
      '## Timeline & Milestones',
      '- Week 1 and week 2.',
      '',
      '## Success Criteria & Acceptance Testing',
      '- 95% valid runs.',
    ].join('\n');

    const candidate = [
      '## Functional Feature Catalogue',
      '',
      '### F-01: Guided Refinement',
      '10. Acceptance Criteria',
      '- Verbesserte Kriterien mit QA-Checks.',
    ].join('\n');

    const compiled = compilePrdDocument(candidate, {
      mode: 'improve',
      existingContent: existing,
      language: 'de',
    });

    expect(compiled.quality.valid).toBe(true);
    expect(
      compiled.quality.issues.some(issue => issue.code === 'too_short_globalBusinessRules')
    ).toBe(false);
    expect(String(compiled.structure.globalBusinessRules || '').trim().length).toBeGreaterThanOrEqual(30);
  });

  it('keeps candidate feature catalogue when improve baseline has no parseable features', () => {
    const existing = [
      '## System Vision',
      'Baseline document without parseable feature IDs.',
      '',
      '## System Boundaries',
      'Web app for authenticated teams.',
      '',
      '## Domain Model',
      '- User, PRD, Version.',
      '',
      '## Global Business Rules',
      '- Baseline rules are stable.',
      '',
      '## Functional Feature Catalogue',
      'Features are listed in prose only, without F-IDs.',
      '',
      '## Non-Functional Requirements',
      '- Deterministic output.',
      '',
      '## Error Handling & Recovery',
      '- Retry transient failures.',
      '',
      '## Deployment & Infrastructure',
      '- Node.js + PostgreSQL.',
      '',
      '## Definition of Done',
      '- Canonical structure complete.',
      '',
      '## Out of Scope',
      '- No native mobile app.',
      '',
      '## Timeline & Milestones',
      '- Phase 1 and phase 2.',
      '',
      '## Success Criteria & Acceptance Testing',
      '- 95% valid runs.',
    ].join('\n');

    const candidate = [
      '## Functional Feature Catalogue',
      '',
      '### F-01: Deterministic Refinement',
      '1. Purpose',
      'Refine existing PRDs deterministically.',
      '10. Acceptance Criteria',
      '- Refined output keeps canonical structure and complete sections.',
    ].join('\n');

    const compiled = compilePrdDocument(candidate, {
      mode: 'improve',
      existingContent: existing,
      language: 'en',
    });

    expect(compiled.quality.valid).toBe(true);
    expect(compiled.structure.features.length).toBeGreaterThan(0);
    expect(
      compiled.quality.issues.some(issue => issue.code === 'missing_feature_catalogue')
    ).toBe(false);
  });

  it('warns about structural incompleteness when catalogue heading present but no features', () => {
    const prd = [
      '## System Vision',
      'A system for collaborative planning.',
      '',
      '## Functional Feature Catalogue',
      'The following features define the system capabilities.',
      '',
      '## Non-Functional Requirements',
      '- Performance under load.',
    ].join('\n');

    const result = compilePrdDocument(prd, { mode: 'generate', language: 'en' });
    expect(
      result.quality.issues.some(i => i.code === 'structural_incompleteness')
    ).toBe(true);
  });

  it('rejects empty input with empty_input error', () => {
    const result = compilePrdDocument('', { mode: 'generate', language: 'en' });
    expect(result.quality.valid).toBe(false);
    expect(result.quality.issues.some(i => i.code === 'empty_input')).toBe(true);
    expect(result.content).toBe('');
  });

  it('rejects whitespace-only input', () => {
    const result = compilePrdDocument('   \n\n  \t  ', { mode: 'generate', language: 'en' });
    expect(result.quality.valid).toBe(false);
    expect(result.quality.issues.some(i => i.code === 'empty_input')).toBe(true);
  });

  it('accepts German PRD with English canonical headings without language mismatch', () => {
    const germanPrd = [
      '## System Vision',
      'Das System bietet eine kollaborative Plattform fuer Produktplanung mit KI-Unterstuetzung.',
      '',
      '## System Boundaries',
      'Webanwendung mit authentifizierten Benutzern und REST-API.',
      '',
      '## Domain Model',
      '- Benutzer, PRD, Feature, Version.',
      '',
      '## Global Business Rules',
      '- Feature-IDs bleiben ueber Verfeinerungslaeufe hinweg stabil.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Benutzerregistrierung',
      '1. Purpose',
      'Nutzer koennen sich mit E-Mail und Passwort registrieren.',
      '10. Acceptance Criteria',
      '- Nach Registrierung erhaelt der Nutzer eine Bestaetigungsmail.',
      '',
      '## Non-Functional Requirements',
      '- Antwortzeiten unter zwei Sekunden fuer alle API-Aufrufe.',
      '',
      '## Error Handling & Recovery',
      '- Fehlgeschlagene Registrierungen werden protokolliert und dem Nutzer angezeigt.',
      '',
      '## Deployment & Infrastructure',
      '- Node-Service mit PostgreSQL und Docker-Deployment.',
      '',
      '## Definition of Done',
      '- Alle Pflichtabschnitte und Akzeptanzkriterien sind vollstaendig.',
      '',
      '## Out of Scope',
      '- Native Mobile-Apps sind nicht Teil dieses Releases.',
      '',
      '## Timeline & Milestones',
      '- Phase 1: Kernfunktionen, Phase 2: Erweiterungen.',
      '',
      '## Success Criteria & Acceptance Testing',
      '- 95% der Laeufe erzeugen ein gueltiges Dokument ohne manuellen Eingriff.',
    ].join('\n');

    const result = compilePrdDocument(germanPrd, {
      mode: 'generate',
      language: 'de',
      strictLanguageConsistency: true,
    });

    expect(result.quality.valid).toBe(true);
    expect(
      result.quality.issues.some(i => i.code.startsWith('language_mismatch_section_'))
    ).toBe(false);
  });

  it('rejects input shorter than 20 characters', () => {
    const result = compilePrdDocument('Short text.', { mode: 'generate', language: 'en' });
    expect(result.quality.valid).toBe(false);
    expect(result.quality.issues.some(i => i.code === 'empty_input')).toBe(true);
  });
});
