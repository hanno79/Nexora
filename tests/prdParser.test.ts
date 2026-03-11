import { describe, it, expect } from 'vitest';
import {
  normalizeFeatureId,
  dedupeFeatures,
  normalizeBrokenHeadingBoundaries,
  splitIntoSections,
  parsePRDToStructure,
} from '../server/prdParser';
import { assembleStructureToMarkdown } from '../server/prdAssembler';
import { compilePrdDocument } from '../server/prdCompiler';
import type { FeatureSpec } from '../server/prdStructure';

describe('normalizeFeatureId', () => {
  it('normalizes "F-1" to "F-01"', () => {
    expect(normalizeFeatureId('F-1')).toBe('F-01');
  });

  it('normalizes "f-12" to "F-12"', () => {
    expect(normalizeFeatureId('f-12')).toBe('F-12');
  });

  it('normalizes "F-02: Something" to "F-02"', () => {
    expect(normalizeFeatureId('F-02: Something')).toBe('F-02');
  });

  it('normalizes "F-001" to canonical "F-01"', () => {
    expect(normalizeFeatureId('F-001')).toBe('F-01');
  });

  it('normalizes compact feature IDs to canonical "F-01"', () => {
    expect(normalizeFeatureId('F001')).toBe('F-01');
    expect(normalizeFeatureId('F01')).toBe('F-01');
  });

  it('returns empty string for invalid input', () => {
    expect(normalizeFeatureId('')).toBe('');
    expect(normalizeFeatureId('invalid')).toBe('');
    expect(normalizeFeatureId('Feature 1')).toBe('');
  });

  it('handles null/undefined gracefully', () => {
    expect(normalizeFeatureId(null as any)).toBe('');
    expect(normalizeFeatureId(undefined as any)).toBe('');
  });

  it('pads single digit IDs', () => {
    expect(normalizeFeatureId('F-3')).toBe('F-03');
    expect(normalizeFeatureId('F-9')).toBe('F-09');
  });

  it('keeps multi-digit IDs unchanged', () => {
    expect(normalizeFeatureId('F-10')).toBe('F-10');
    expect(normalizeFeatureId('F-123')).toBe('F-123');
  });
});

describe('dedupeFeatures', () => {
  function feat(id: string, rawContent: string): FeatureSpec {
    return { id, name: `Feature ${id}`, rawContent };
  }

  it('removes duplicate IDs keeping richer content', () => {
    const features = [
      feat('F-1', 'short'),
      feat('F-1', 'much longer content here'),
    ];
    const result = dedupeFeatures(features);
    expect(result).toHaveLength(1);
    expect(result[0].rawContent).toBe('much longer content here');
  });

  it('skips features with invalid IDs', () => {
    const features = [
      feat('F-1', 'valid'),
      feat('invalid', 'skip me'),
    ];
    const result = dedupeFeatures(features);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('F-01');
  });

  it('sorts features by ID', () => {
    const features = [
      feat('F-3', 'third'),
      feat('F-1', 'first'),
      feat('F-2', 'second'),
    ];
    const result = dedupeFeatures(features);
    expect(result.map(f => f.id)).toEqual(['F-01', 'F-02', 'F-03']);
  });

  it('deduplicates equivalent IDs with different zero padding', () => {
    const features = [
      feat('F-01', 'short content'),
      feat('F-001', 'richer canonical content'),
    ];
    const result = dedupeFeatures(features);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('F-01');
    expect(result[0].rawContent).toBe('richer canonical content');
  });

  it('returns empty array for empty input', () => {
    expect(dedupeFeatures([])).toEqual([]);
  });
});

describe('normalizeBrokenHeadingBoundaries', () => {
  it('splits inline headings onto new lines', () => {
    const input = 'Some text here ## Section Title';
    const result = normalizeBrokenHeadingBoundaries(input);
    expect(result).toContain('\n\n## Section Title');
  });

  it('leaves proper headings unchanged', () => {
    const input = 'Some text\n\n## Section Title\n\nContent';
    const result = normalizeBrokenHeadingBoundaries(input);
    expect(result).toBe(input);
  });
});

describe('splitIntoSections', () => {
  it('splits markdown into sections by headings', () => {
    const markdown = '## Vision\nContent A\n\n## Scope\nContent B';
    const sections = splitIntoSections(markdown);
    expect(sections.length).toBeGreaterThanOrEqual(2);
    expect(sections.some(s => s.heading.toLowerCase().includes('vision'))).toBe(true);
    expect(sections.some(s => s.heading.toLowerCase().includes('scope'))).toBe(true);
  });

  it('handles single-section document', () => {
    const markdown = '## Only Section\nSome content here';
    const sections = splitIntoSections(markdown);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toContain('Only Section');
  });

  it('returns minimal result for empty input', () => {
    const sections = splitIntoSections('');
    // Empty input may produce a single empty section
    expect(sections.length).toBeLessThanOrEqual(1);
  });
});

describe('parsePRDToStructure', () => {
  it('parses a minimal PRD with sections', () => {
    const markdown = [
      '## System Vision',
      'Build an amazing product.',
      '',
      '## System Boundaries',
      'Web application only.',
      '',
      '## Feature Catalogue',
      '',
      '### F-01: Login',
      'Allow users to log in.',
      '',
      '### F-02: Dashboard',
      'Show user overview.',
    ].join('\n');

    const result = parsePRDToStructure(markdown);
    expect(result.systemVision).toContain('amazing product');
    expect(result.systemBoundaries).toContain('Web application');
    expect(result.features.length).toBeGreaterThanOrEqual(1);
  });

  it('entfernt das Prefix "Feature Name:" auch im Heading-Format', () => {
    const markdown = [
      '## Feature Catalogue',
      '',
      '### F-02: Feature Name: Password Reset Request',
      '1. Purpose',
      'Users can request a password reset email.',
    ].join('\n');

    const result = parsePRDToStructure(markdown);

    expect(result.features).toHaveLength(1);
    expect(result.features[0].name).toBe('Password Reset Request');
  });

  it('parses compact feature IDs in headings and body lines and normalizes them to canonical IDs', () => {
    const markdown = [
      '## Functional Feature Catalogue',
      '',
      '### F001 – Turbo Drop',
      '',
      'Feature ID: F001',
      'Feature Name: Turbo Drop',
      '',
      '1. Purpose',
      'Accelerates falling tetrominoes for a short burst.',
      '10. Acceptance Criteria',
      '- Speed is doubled for 10 seconds.',
    ].join('\n');

    const result = parsePRDToStructure(markdown);

    expect(result.features).toHaveLength(1);
    expect(result.features[0].id).toBe('F-01');
    expect(result.features[0].name).toBe('Turbo Drop');
  });

  it('handles empty markdown', () => {
    const result = parsePRDToStructure('');
    expect(result.features).toEqual([]);
  });

  it('parses and reassembles parent task metadata on feature blocks', () => {
    const markdown = [
      '## Functional Feature Catalogue',
      '',
      '### F-01: Aufgabe erstellen',
      '',
      'Feature ID: F-01',
      'Parent Task: Aufgabenverwaltung',
      'Parent Task Description: Erfasst, aendert und verfolgt Aufgaben im Board.',
      '',
      '1. Purpose',
      'Erstellt eine neue Aufgabe im aktuellen Board.',
      '10. Acceptance Criteria',
      '- Eine Aufgabe wird sichtbar angelegt.',
    ].join('\n');

    const parsed = parsePRDToStructure(markdown);
    expect(parsed.features).toHaveLength(1);
    expect(parsed.features[0].parentTaskName).toBe('Aufgabenverwaltung');
    expect(parsed.features[0].parentTaskDescription).toContain('verfolgt Aufgaben');

    const assembled = assembleStructureToMarkdown(parsed);
    expect(assembled).toContain('Parent Task: Aufgabenverwaltung');
    expect(assembled).toContain('Parent Task Description: Erfasst, aendert und verfolgt Aufgaben im Board.');
  });

  it('keeps planning sections separate and preserves Out of Scope', () => {
    const markdown = [
      '## System Boundaries',
      'Core web app scope only.',
      '',
      '## Out of Scope',
      '- Native mobile apps are excluded.',
      '',
      '## Timeline & Milestones',
      '- Phase 1 in 2 weeks.',
      '',
      '## Success Criteria & Acceptance Testing',
      '- Users can complete onboarding in under 3 minutes.',
    ].join('\n');

    const result = parsePRDToStructure(markdown);
    expect(result.systemBoundaries).toContain('Core web app scope only');
    expect(result.outOfScope).toContain('mobile apps are excluded');
    expect(result.timelineMilestones).toContain('Phase 1');
    expect(result.successCriteria).toContain('onboarding');
  });

  it('assembles parsed planning sections with canonical headings', () => {
    const markdown = [
      '## Out of Scope',
      '- No enterprise SSO in v1.',
      '',
      '## Timeline & Milestones',
      '- Week 1 discovery, week 2 delivery.',
      '',
      '## Success Criteria',
      '- 90% task completion rate in user test.',
    ].join('\n');

    const parsed = parsePRDToStructure(markdown);
    const assembled = assembleStructureToMarkdown(parsed);

    expect(assembled).toContain('## Out of Scope');
    expect(assembled).toContain('## Timeline & Milestones');
    expect(assembled).toContain('## Success Criteria & Acceptance Testing');
    expect(assembled).toContain('No enterprise SSO in v1');
  });

  it('maps template alias headings into canonical sections', () => {
    const markdown = [
      '## Problem Statement',
      'Current planning is fragmented across tools and hard to track.',
      '',
      '## Goals & Success Metrics',
      '- Reduce PRD iteration cycles by 30%.',
      '',
      '## Target Audience & User Personas',
      '- Product managers and engineering leads.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Unified Compiler',
      '1. Purpose',
      'Compile drafts into canonical PRDs.',
      '10. Acceptance Criteria',
      '- Output remains deterministic across reruns.',
    ].join('\n');

    const result = parsePRDToStructure(markdown);
    expect(result.systemVision).toContain('fragmented across tools');
    expect(result.successCriteria).toContain('Reduce PRD iteration cycles');
    expect(result.systemBoundaries).toContain('Product managers and engineering leads');
    expect(result.features.length).toBe(1);
  });

  it('maps guided legacy headings (target users and UI guidelines) to canonical sections', () => {
    const markdown = [
      '## 4. Ziele & Success Metrics',
      '- Reduce completion time by 30%.',
      '',
      '## 5. Target Users',
      '- Operations managers in SMB teams.',
      '',
      '## 9. User Interface Guidelines',
      '- Keep flows keyboard-accessible and consistent.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Guided Compatibility',
      '1. Purpose',
      'Preserve guided outputs under canonical compiler gates.',
      '10. Acceptance Criteria',
      '- Legacy headings are normalized without failing quality gates.',
    ].join('\n');

    const result = parsePRDToStructure(markdown);
    expect(result.successCriteria).toContain('Reduce completion time by 30%');
    expect(result.systemBoundaries).toContain('Operations managers in SMB teams');
    expect(result.nonFunctional).toContain('keyboard-accessible');
    expect(result.features.length).toBe(1);
  });

  it('maps technical requirements and dependencies/risk aliases to canonical sections', () => {
    const markdown = [
      '## Technical Requirements',
      '- Node.js backend with PostgreSQL and Clerk authentication.',
      '',
      '## Dependencies & Risks',
      '- Dependency on external auth provider; mitigate with graceful fallback UX.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Deterministic Compiler',
      '1. Purpose',
      'Compile generated drafts into canonical PRD structure.',
      '10. Acceptance Criteria',
      '- Unknown legacy headings are canonicalized before quality gates.',
    ].join('\n');

    const result = parsePRDToStructure(markdown);
    expect(result.deployment).toContain('Node.js backend with PostgreSQL');
    expect(result.errorHandling).toContain('Dependency on external auth provider');
    expect(result.features.length).toBe(1);
  });

  it('maps Part A/C/D wrapper headings to canonical sections', () => {
    const markdown = [
      '## Part A — System Context',
      'Context and purpose for the initiative.',
      '',
      '## Part C — Technical & Design Context',
      'Architecture overview and implementation constraints.',
      '',
      '## Part D — Planning & Risk',
      'Milestones, sequencing, and rollout checkpoints.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Wrapper Compatibility',
      '1. Purpose',
      'Support wrapper headings under strict canonical compiler mode.',
      '10. Acceptance Criteria',
      '- Part wrapper headings do not trigger unknown-heading quality errors.',
    ].join('\n');

    const result = parsePRDToStructure(markdown);
    expect(result.systemVision).toContain('Context and purpose');
    expect(result.deployment).toContain('Architecture overview');
    expect(result.timelineMilestones).toContain('Milestones, sequencing');
    expect(Object.keys(result.otherSections)).not.toEqual(
      expect.arrayContaining([
        'Part A — System Context',
        'Part C — Technical & Design Context',
        'Part D — Planning & Risk',
      ])
    );
    expect(result.features.length).toBe(1);
  });

  it('treats user stories as feature catalogue intro context', () => {
    const markdown = [
      '## User Stories',
      '- As a PM I want to refine an existing PRD so that missing parts are completed.',
      '- As an engineer I want deterministic output so that regressions are reduced.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: PRD Refinement',
      '1. Purpose',
      'Improve existing PRDs without losing structure.',
      '10. Acceptance Criteria',
      '- Missing sections are restored and complete.',
    ].join('\n');

    const result = parsePRDToStructure(markdown);
    expect(result.featureCatalogueIntro).toContain('As a PM');
    expect(result.features.length).toBe(1);
  });

  it('parses german feature subsection labels for structured completeness', () => {
    const markdown = [
      '## Functional Feature Catalogue',
      '',
      '### F-01: Echtzeit-Updates',
      '1. Zweck',
      'Statusaenderungen sollen ohne manuelles Neuladen sichtbar werden.',
      '2. Akteure',
      '- Teammitglied',
      '3. Ausloeser',
      'Der Nutzer aendert den Aufgabenstatus in der UI.',
      '4. Voraussetzungen',
      '- Benutzer ist angemeldet.',
      '5. Hauptablauf',
      '1. Nutzer oeffnet die Aufgabe.',
      '2. Nutzer waehlt einen neuen Status.',
      '3. System speichert die Aenderung.',
      '6. Alternative Ablaeufe',
      '1. API nicht erreichbar -> Fehlermeldung und Retry.',
      '7. Nachbedingungen',
      'Der neue Status ist in allen aktiven Sitzungen sichtbar.',
      '8. Datenauswirkungen',
      'Task-Status wird in der Datenbank aktualisiert.',
      '9. UI-Auswirkungen',
      'Die Karte wechselt Spalte in der Kanban-Ansicht.',
      '10. Akzeptanzkriterien',
      '- Statusaenderung wird innerhalb von 1 Sekunde synchronisiert.',
      '- Fehlerfaelle sind fuer den Nutzer sichtbar.',
    ].join('\n');

    const result = parsePRDToStructure(markdown);
    expect(result.features).toHaveLength(1);
    const feature = result.features[0];
    expect(feature.purpose).toContain('Statusaenderungen');
    expect(feature.actors).toContain('Teammitglied');
    expect(feature.trigger).toContain('Aufgabenstatus');
    expect(feature.preconditions).toContain('angemeldet');
    expect(feature.mainFlow?.length).toBeGreaterThan(0);
    expect(feature.alternateFlows?.length).toBeGreaterThan(0);
    expect(feature.postconditions).toContain('sichtbar');
    expect(feature.dataImpact).toContain('Datenbank');
    expect(feature.uiImpact).toContain('Kanban');
    expect(feature.acceptanceCriteria?.length).toBeGreaterThan(0);
  });

  it('keeps parser stability after compiler aggregation and canonicalization', () => {
    const markdown = [
      '## System Vision',
      'Task operations platform for collaborative planning.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Task list management',
      '1. Purpose',
      'Manage task lists in team boards.',
      '10. Acceptance Criteria',
      '- Lists can be managed deterministically.',
      '',
      '### F-02: Task list management workflow',
      '1. Purpose',
      'Manage task lists with deterministic behavior.',
      '10. Acceptance Criteria',
      '- List updates are persisted.',
      '',
      '### F-03: Task assignment workflow',
      '1. Purpose',
      'Assign tasks.',
      '10. Acceptance Criteria',
      '- Assignment is visible.',
    ].join('\n');

    const compiled = compilePrdDocument(markdown, {
      mode: 'generate',
      language: 'en',
      templateCategory: 'feature',
    });
    const reparsed = parsePRDToStructure(compiled.content);

    expect(reparsed.features.length).toBeLessThanOrEqual(3);
    expect(new Set(reparsed.features.map(feature => feature.id)).size).toBe(reparsed.features.length);
  });

  it('compiles compact feature IDs into canonical headings and avoids feature-catalogue parse failures', () => {
    const markdown = [
      '## System Vision',
      'A neon Tetris experience with deterministic feature specs.',
      '',
      '## System Boundaries',
      'Browser-only release with authenticated profiles.',
      '',
      '## Domain Model',
      '- PlayerProfile (playerId, xp, level)\n- GameSession (sessionId, activePowerUpId, score)\n- PowerUp (powerUpId, cooldown, effectType)',
      '',
      '## Global Business Rules',
      '- Only one active power-up may be enabled per session and cooldown must be tracked before another use.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F001 – Turbo Drop',
      '',
      'Feature ID: F001',
      'Feature Name: Turbo Drop',
      '',
      '1. Purpose',
      'Accelerates falling tetrominoes for a short burst.',
      '2. Actors',
      'Player.',
      '3. Trigger',
      'The player activates the turbo drop icon.',
      '4. Preconditions',
      'A power-up charge is available and cooldown has elapsed.',
      '5. Main Flow',
      '1. The player activates Turbo Drop.',
      '2. The session doubles tetromino fall speed for 10 seconds.',
      '6. Alternate Flows',
      '1. Cooldown is still active and the action is rejected.',
      '7. Postconditions',
      'The board speed returns to normal after the timer ends.',
      '8. Data Impact',
      'Updates GameSession.activePowerUpId and PowerUp.cooldown after activation.',
      '9. UI Impact',
      'Shows an active timer badge and highlighted icon.',
      '10. Acceptance Criteria',
      '- Fall speed doubles for exactly 10 seconds.',
      '',
      '## Non-Functional Requirements',
      '- Rendering remains below 16 ms per frame.',
      '',
      '## Error Handling & Recovery',
      '- Invalid activation attempts show a visible cooldown error state.',
      '',
      '## Deployment & Infrastructure',
      '- Node.js API with PostgreSQL and websocket gameplay sync.',
      '',
      '## Definition of Done',
      '- Compiler output uses canonical headings and stable feature IDs.',
      '',
      '## Out of Scope',
      '- Multiplayer ranked tournaments are not part of this release.',
      '',
      '## Timeline & Milestones',
      '- Phase 1 implements the core loop and power-up handling.',
      '',
      '## Success Criteria & Acceptance Testing',
      '- Turbo Drop remains deterministic and passes compiler validation.',
    ].join('\n');

    const compiled = compilePrdDocument(markdown, {
      mode: 'generate',
      language: 'en',
      templateCategory: 'feature',
    });

    expect(compiled.quality.issues.some(issue => issue.code === 'missing_feature_catalogue')).toBe(false);
    expect(compiled.quality.issues.some(issue => issue.code === 'feature_catalogue_format_mismatch')).toBe(false);
    expect(compiled.structure.features).toHaveLength(1);
    expect(compiled.structure.features[0].id).toBe('F-01');
    expect(compiled.content).toContain('### F-01: Turbo Drop');
    expect(compiled.content).toContain('Feature ID: F-01');
  });
});
