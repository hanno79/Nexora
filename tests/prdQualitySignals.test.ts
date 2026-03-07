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

// ÄNDERUNG 07.03.2026: Near-Duplicate-Regressionen für Auth-Domäne ergänzt

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
    structure.nonFunctional = repeated;
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
      {
        id: 'F-04',
        name: 'Audit Trail',
        rawContent: 'Trail audits.',
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

  it('flags short feature names when they drift to the wrong language (warning for minority)', () => {
    const structure = baseStructure();
    structure.features = [
      {
        id: 'F-01',
        name: 'Create All User Entries',
        rawContent: 'Neue Eintraege werden angelegt.',
      },
      {
        id: 'F-02',
        name: 'Eintrag bearbeiten',
        rawContent: 'Eintraege werden aktualisiert.',
      },
    ];

    const issues = collectLanguageConsistencyIssues(structure, 'de', 'feature');
    // 1/2 features mismatched (50%) → warning, not error
    const nameIssue = issues.find(i => i.code === 'language_mismatch_feature_name');
    expect(nameIssue).toBeDefined();
    expect(nameIssue!.severity).toBe('warning');
  });

  it('does not flag feature names with only 2 EN markers (below threshold)', () => {
    const structure = baseStructure();
    structure.features = [
      {
        id: 'F-01',
        name: 'User Search',
        rawContent: 'Nutzer suchen.',
      },
      {
        id: 'F-02',
        name: 'Eintrag bearbeiten',
        rawContent: 'Eintraege werden aktualisiert.',
      },
    ];

    const issues = collectLanguageConsistencyIssues(structure, 'de', 'feature');
    expect(issues.some(i => i.code === 'language_mismatch_feature_name')).toBe(false);
    expect(issues.some(i => i.code === 'language_mismatch_feature_names_majority')).toBe(false);
  });

  it('does not flag short English feature names with integration nouns as German mismatch', () => {
    const structure = baseStructure();
    structure.features = [
      {
        id: 'F-14',
        name: 'Shipment Tracking Integration',
        rawContent: 'Shipment tracking is integrated into the order detail view.',
      },
      {
        id: 'F-15',
        name: 'Inventory Management',
        rawContent: 'Inventory levels remain visible to operators.',
      },
    ];

    const issues = collectLanguageConsistencyIssues(structure, 'en', 'epic');

    expect(issues.some(i => i.code === 'language_mismatch_feature_name')).toBe(false);
    expect(issues.some(i => i.code === 'language_mismatch_feature_names_majority')).toBe(false);
  });

  it('escalates to error when majority of feature names are in wrong language', () => {
    const structure = baseStructure();
    structure.features = [
      { id: 'F-01', name: 'Create All User Records', rawContent: 'content' },
      { id: 'F-02', name: 'Delete All User Records', rawContent: 'content' },
      { id: 'F-03', name: 'View Every User Profile', rawContent: 'content' },
      { id: 'F-04', name: 'Eintrag bearbeiten', rawContent: 'content' },
    ];

    const issues = collectLanguageConsistencyIssues(structure, 'de', 'feature');
    // 3/4 features mismatched (75%) → error
    const majorityIssue = issues.find(i => i.code === 'language_mismatch_feature_names_majority');
    expect(majorityIssue).toBeDefined();
    expect(majorityIssue!.severity).toBe('error');
  });

  it('does not flag known compiler scaffold sentences as boilerplate', () => {
    const scaffoldSentence = 'System receives the "Feature X" request and validates input.';
    const structure = baseStructure();
    structure.features = Array.from({ length: 6 }, (_, i) => ({
      id: `F-0${i + 1}`,
      name: `Feature ${i + 1}`,
      rawContent: scaffoldSentence,
      mainFlow: [scaffoldSentence],
      acceptanceCriteria: [
        `"Feature ${i + 1}" is verifiable by end users directly in the UI without manual reload.`,
      ],
    }));

    const issues = collectBoilerplateRepetitionIssues(structure);
    expect(issues.some(i => i.code === 'boilerplate_repetition_detected')).toBe(false);
    expect(issues.some(i => i.code === 'boilerplate_feature_acceptance_repetition')).toBe(false);
  });

  it('does not flag German scaffold sentences with real umlauts as boilerplate', () => {
    const germanScaffold = 'Temporärer Fehler: Das System protokolliert den Fehler und bietet einen Retry-Pfad an.';
    const structure = baseStructure();
    structure.features = Array.from({ length: 9 }, (_, i) => ({
      id: `F-0${i + 1}`,
      name: `Feature ${i + 1}`,
      rawContent: 'content',
      alternateFlows: [germanScaffold],
    }));

    const issues = collectBoilerplateRepetitionIssues(structure);
    expect(issues.some(i => i.code === 'boilerplate_repetition_detected')).toBe(false);
  });

  it('does not flag sentences at exactly 4 repetitions (threshold is 5)', () => {
    const repeated = 'A custom business sentence that repeats across multiple sections in the document.';
    const structure = baseStructure();
    structure.systemVision = repeated;
    structure.systemBoundaries = repeated;
    structure.domainModel = repeated;
    structure.globalBusinessRules = repeated;

    const issues = collectBoilerplateRepetitionIssues(structure);
    expect(issues.some(i => i.code === 'boilerplate_repetition_detected')).toBe(false);
  });

  it('flags sentences repeated 7+ times as boilerplate (inverse of threshold test)', () => {
    const repeated = 'A custom business sentence that repeats far too many times across the entire document.';
    const structure = baseStructure();
    // Place the same sentence in 7 different sections → exceeds global threshold
    structure.systemVision = repeated;
    structure.systemBoundaries = repeated;
    structure.domainModel = repeated;
    structure.globalBusinessRules = repeated;
    structure.nonFunctional = repeated;
    structure.errorHandling = repeated;
    structure.deployment = repeated;

    const issues = collectBoilerplateRepetitionIssues(structure);
    expect(issues.some(i => i.code === 'boilerplate_repetition_detected')).toBe(true);
    // Verify it's an error, not just a warning
    const boilerplateIssue = issues.find(i => i.code === 'boilerplate_repetition_detected');
    expect(boilerplateIssue?.severity).toBe('error');
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

  // ÄNDERUNG 07.03.2026: Positive Regressionen für inhaltsgestützte Mid-Confidence-Aggregation ergänzt.
  it('stuft technische crud-familien mit starkem inhalts-overlap als aggregationskandidat hoch', () => {
    const structure = baseStructure();
    structure.features = [
      {
        id: 'F-01',
        name: 'Create Release Rollout Plan',
        rawContent: 'Creates a rollout plan with market gates, success metrics, and approval notes.',
        purpose: 'Create the rollout artifact for launch managers and release coordination.',
        actors: 'Launch manager',
        mainFlow: ['Define market gates', 'Attach success metrics', 'Store rollout plan'],
        acceptanceCriteria: ['The rollout plan contains market gates, success metrics, and approval notes.'],
      },
      {
        id: 'F-02',
        name: 'Update Release Rollout Plan',
        rawContent: 'Updates a rollout plan with market gates, success metrics, and approval notes.',
        purpose: 'Update the rollout artifact for launch managers and release coordination.',
        actors: 'Launch manager',
        mainFlow: ['Revise market gates', 'Adjust success metrics', 'Store rollout plan'],
        acceptanceCriteria: ['The rollout plan contains market gates, success metrics, and approval notes.'],
      },
    ];

    const analysis = findFeatureAggregationCandidates(structure.features, 'technical', 'en');

    expect(analysis.candidates).toHaveLength(1);
    expect(analysis.candidates[0].featureIds).toEqual(['F-01', 'F-02']);
    expect(analysis.nearDuplicates).toHaveLength(0);
  });

  it('stuft product-launch-mid-confidence-faelle mit starkem inhalts-overlap als aggregationskandidat hoch', () => {
    const structure = baseStructure();
    structure.features = [
      {
        id: 'F-03',
        name: 'Launch Readiness Checklist Automation for Regional Rollout Gating',
        rawContent: 'Automates rollout gating with launch readiness checks, dependency review, and approval tracking.',
        purpose: 'Provide launch teams with one readiness workflow for rollout gating and dependency review.',
        actors: 'Launch operations team',
        mainFlow: ['Run readiness checks', 'Review dependencies', 'Track rollout approvals'],
        acceptanceCriteria: ['The workflow tracks rollout approvals and readiness dependencies in one place.'],
      },
      {
        id: 'F-04',
        name: 'Launch Readiness Checklist Automation for International Rollout Gating',
        rawContent: 'Automates rollout gating with launch readiness checks, dependency review, and approval tracking.',
        purpose: 'Provide launch teams with one readiness workflow for rollout gating and dependency review.',
        actors: 'Launch operations team',
        mainFlow: ['Run readiness checks', 'Review dependencies', 'Track rollout approvals'],
        acceptanceCriteria: ['The workflow tracks rollout approvals and readiness dependencies in one place.'],
      },
    ];

    const analysis = findFeatureAggregationCandidates(structure.features, 'product-launch', 'en');

    expect(analysis.candidates).toHaveLength(1);
    expect(analysis.candidates[0].featureIds).toEqual(['F-03', 'F-04']);
    expect(analysis.nearDuplicates).toHaveLength(0);
  });

  it('meldet Login und Passwort-Reset nicht als Near-Duplicate nur wegen generischer Auth-Begriffe', () => {
    const structure = baseStructure();
    structure.features = [
      {
        id: 'F-01',
        name: 'Email and Password Login',
        rawContent: 'Users log in with email and password.',
      },
      {
        id: 'F-02',
        name: 'Password Reset via Email Link',
        rawContent: 'Users reset passwords through an email link.',
      },
    ];

    const analysis = findFeatureAggregationCandidates(structure.features, 'feature', 'en');

    expect(analysis.candidates).toHaveLength(0);
    expect(analysis.nearDuplicates).toHaveLength(0);
  });

  it('meldet Request und Confirmation trotz Prefix "Feature Name:" nicht als Near-Duplicate', () => {
    const structure = baseStructure();
    structure.features = [
      {
        id: 'F-02',
        name: 'Feature Name: Password Reset Request',
        rawContent: 'Users request a password reset email.',
      },
      {
        id: 'F-03',
        name: 'Feature Name: Password Reset Confirmation',
        rawContent: 'Users confirm a password reset with a token and new password.',
      },
    ];

    const analysis = findFeatureAggregationCandidates(structure.features, 'feature', 'en');

    expect(analysis.candidates).toHaveLength(0);
    expect(analysis.nearDuplicates).toHaveLength(0);
  });

  it('meldet unterschiedliche checkout-teilschritte nicht als Near-Duplicate', () => {
    const structure = baseStructure();
    structure.features = [
      {
        id: 'F-03',
        name: 'Multi-step Checkout - Shipping Address Entry',
        rawContent: 'Customers enter and validate their shipping address during checkout.',
      },
      {
        id: 'F-04',
        name: 'Multi-step Checkout - Payment Entry with Stripe Integration',
        rawContent: 'Customers enter payment details and complete Stripe-backed payment authorization.',
      },
    ];

    const analysis = findFeatureAggregationCandidates(structure.features, 'epic', 'en');

    expect(analysis.candidates).toHaveLength(0);
    expect(analysis.nearDuplicates).toHaveLength(0);
  });

  it('meldet unterschiedliche cart-item-crud-aktionen nicht als Near-Duplicate', () => {
    const structure = baseStructure();
    structure.features = [
      {
        id: 'F-06',
        name: 'Cart Item Addition',
        rawContent: 'Customers add an item to the shopping cart.',
      },
      {
        id: 'F-07',
        name: 'Cart Item Quantity Modification',
        rawContent: 'Customers increase or decrease quantities for an existing cart item.',
      },
      {
        id: 'F-08',
        name: 'Cart Item Removal',
        rawContent: 'Customers remove an item from the shopping cart.',
      },
    ];

    const analysis = findFeatureAggregationCandidates(structure.features, 'epic', 'en');

    expect(analysis.candidates).toHaveLength(0);
    expect(analysis.nearDuplicates).toHaveLength(0);
  });

  it('meldet epic-hauptfeatures mit klaren teilfaehigkeiten nicht als Near-Duplicate', () => {
    const structure = baseStructure();
    structure.features = [
      {
        id: 'F-05',
        name: 'Real-time Order Tracking with Status Updates',
        rawContent: 'Customers track order progress and receive status updates.',
      },
      {
        id: 'F-13',
        name: 'Real-Time Order Tracking',
        rawContent: 'Customers view the current fulfillment status for an order.',
      },
      {
        id: 'F-06',
        name: 'Warehouse Inventory Management with Low-stock Alerts',
        rawContent: 'Operators manage inventory and receive low-stock alerts.',
      },
      {
        id: 'F-16',
        name: 'Low-Stock Alert Generation',
        rawContent: 'The system generates low-stock alerts for warehouse teams.',
      },
    ];

    const analysis = findFeatureAggregationCandidates(structure.features, 'epic', 'en');

    expect(analysis.candidates).toHaveLength(0);
    expect(analysis.nearDuplicates).toHaveLength(0);
  });

  it('erkennt weiterhin fachlich ähnliche Shared-Core-Features als Near-Duplicate', () => {
    const structure = baseStructure();
    structure.features = [
      {
        id: 'F-01',
        name: 'Random Location Loader',
        rawContent: 'Loads a random location into the editor.',
      },
      {
        id: 'F-02',
        name: 'Random Location API Service',
        rawContent: 'Provides an API service for random location loading.',
      },
    ];

    const analysis = findFeatureAggregationCandidates(structure.features, 'feature', 'en');

    expect(analysis.candidates).toHaveLength(0);
    expect(analysis.nearDuplicates).toHaveLength(1);
    expect(analysis.nearDuplicates[0].featureIds).toEqual(['F-01', 'F-02']);
  });
});
