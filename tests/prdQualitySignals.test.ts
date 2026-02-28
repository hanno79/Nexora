import { describe, expect, it } from 'vitest';
import type { PRDStructure } from '../server/prdStructure';
import {
  applyConservativeFeatureAggregation,
  collectBoilerplateRepetitionIssues,
  collectLanguageConsistencyIssues,
  collectMetaLeakIssues,
  findFeatureAggregationCandidates,
  sanitizeMetaLeaksInStructure,
} from '../server/prdQualitySignals';

function baseStructure(): PRDStructure {
  return {
    systemVision: 'A deterministic PRD compiler for collaborative product planning.',
    systemBoundaries: 'Web app and API scope with authenticated users and stable versioning.',
    domainModel: 'Entities include PRD, Version, Feature, and ReviewEvent.',
    globalBusinessRules: 'Feature IDs stay stable across refinement runs.',
    features: [],
    nonFunctional: 'The system shall provide deterministic output with explicit quality gates.',
    errorHandling: 'Transient errors are retried and logged with traceability.',
    deployment: 'Node service with PostgreSQL and containerized deployment.',
    definitionOfDone: 'All required sections and acceptance criteria are complete.',
    outOfScope: 'Native mobile applications are not part of this release.',
    timelineMilestones: 'Phase 1 compile pipeline, phase 2 repair hardening.',
    successCriteria: 'Ninety five percent of runs complete without manual repair.',
    otherSections: {},
  };
}

describe('prdQualitySignals', () => {
  it('detects repeated boilerplate across sections and feature acceptance criteria', () => {
    const repeated = 'The system shall provide deterministic output with explicit quality gates for every release candidate.';
    const structure = baseStructure();
    structure.systemVision = repeated;
    structure.systemBoundaries = repeated;
    structure.domainModel = repeated;
    structure.globalBusinessRules = repeated;
    structure.features = [
      {
        id: 'F-01',
        name: 'Deterministic Compile',
        rawContent: 'Compile deterministically.',
        acceptanceCriteria: [repeated],
      },
      {
        id: 'F-02',
        name: 'Quality Gate Enforcement',
        rawContent: 'Enforce gates.',
        acceptanceCriteria: [repeated],
      },
      {
        id: 'F-03',
        name: 'Repair Retry',
        rawContent: 'Retry repairs.',
        acceptanceCriteria: [repeated],
      },
    ];

    const issues = collectBoilerplateRepetitionIssues(structure);
    expect(issues.some(issue => issue.code === 'boilerplate_repetition_detected')).toBe(true);
    expect(issues.some(issue => issue.code === 'boilerplate_feature_acceptance_repetition')).toBe(true);
  });

  it('sanitizes and flags meta/prompt leaks', () => {
    const structure = baseStructure();
    structure.systemVision = [
      'Iteration 3',
      '- Questions Identified: Which scope is missing?',
      'ORIGINAL PRD',
      'Real system vision content.',
    ].join('\n');

    const sanitized = sanitizeMetaLeaksInStructure(structure);
    expect(sanitized.removedSegments).toBeGreaterThan(0);
    expect(sanitized.structure.systemVision).toContain('Real system vision content');

    const issues = collectMetaLeakIssues(sanitized.structure);
    expect(issues).toHaveLength(0);
  });

  it('enforces strict language consistency while allowing technical terms', () => {
    const structure = baseStructure();
    structure.systemVision = 'Das System bietet API, OAuth, RBAC und Docker fuer sichere Integrationen.';
    structure.systemBoundaries = 'The system supports user onboarding and checkout workflows.';
    structure.features = [
      {
        id: 'F-01',
        name: 'Benutzerregistrierung',
        rawContent: 'Registrierung mit API Integration',
        purpose: 'Nutzer koennen sich mit E-Mail registrieren.',
      },
    ];

    const issues = collectLanguageConsistencyIssues(structure, 'de', 'feature');
    expect(issues.some(issue => issue.code === 'language_mismatch_section_systemBoundaries')).toBe(true);
    expect(issues.some(issue => issue.code === 'language_mismatch_section_systemVision')).toBe(false);
  });

  it('flags short feature names when they drift to the wrong language', () => {
    const structure = baseStructure();
    structure.features = [
      {
        id: 'F-01',
        name: 'Add Entry',
        rawContent: 'Neue Eintraege werden angelegt.',
      },
      {
        id: 'F-02',
        name: 'Eintrag bearbeiten',
        rawContent: 'Eintraege werden aktualisiert.',
      },
    ];

    const issues = collectLanguageConsistencyIssues(structure, 'de', 'feature');
    expect(issues.some(issue => issue.code === 'language_mismatch_feature_name')).toBe(true);
  });

  it('finds and applies conservative feature aggregation candidates', () => {
    const structure = baseStructure();
    structure.features = [
      {
        id: 'F-01',
        name: 'Create Customer Record',
        rawContent: 'Create customer data record.',
      },
      {
        id: 'F-02',
        name: 'Create Customer Records',
        rawContent: 'Create customer records with validation.',
      },
      {
        id: 'F-03',
        name: 'Export Audit Report',
        rawContent: 'Export audit report as CSV.',
      },
    ];

    const analysis = findFeatureAggregationCandidates(structure.features, 'feature', 'en');
    expect(analysis.candidates.length).toBeGreaterThanOrEqual(1);

    const applied = applyConservativeFeatureAggregation(structure, analysis.candidates, 'en');
    expect(applied.aggregatedFeatureCount).toBeGreaterThanOrEqual(1);
    expect(applied.structure.features.length).toBeLessThan(structure.features.length);
  });
});
