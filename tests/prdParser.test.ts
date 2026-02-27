import { describe, it, expect } from 'vitest';
import {
  normalizeFeatureId,
  dedupeFeatures,
  normalizeBrokenHeadingBoundaries,
  splitIntoSections,
  parsePRDToStructure,
} from '../server/prdParser';
import { assembleStructureToMarkdown } from '../server/prdAssembler';
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

  it('handles empty markdown', () => {
    const result = parsePRDToStructure('');
    expect(result.features).toEqual([]);
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
});
