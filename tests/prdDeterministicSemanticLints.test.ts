import { describe, it, expect } from 'vitest';
import { compilePrdDocument } from '../server/prdCompiler';

function buildPrd(params?: {
  systemVision?: string;
  domainModel?: string;
  globalBusinessRules?: string;
  nonFunctional?: string;
  outOfScope?: string;
  featureName?: string;
  featurePurpose?: string;
  featureDataImpact?: string;
}): string {
  const featureName = params?.featureName || 'Provider Configuration';
  const featurePurpose = params?.featurePurpose || 'Allow administrators to configure provider order and persist validated widget settings.';
  const featureDataImpact = params?.featureDataImpact || 'Updates WidgetSettings.selectedModelId and WidgetSettings.providerOrderArray after validation succeeds.';

  return [
    '## System Vision',
    params?.systemVision || 'A reusable LLM widget lets teams configure provider fallback order with deterministic validation and release gating.',
    '',
    '## System Boundaries',
    'The system includes a React widget, a backend configuration API, and persistent tier settings stored in PostgreSQL.',
    '',
    '## Domain Model',
    params?.domainModel || '- WidgetSettings (userId, defaultTier, providerOrderArray, selectedModelId)\n- TierConfiguration (tier, providerId, orderIndex)',
    '',
    '## Global Business Rules',
    params?.globalBusinessRules || '- Only authenticated administrators may update widget settings.\n- Every tier configuration preserves a deterministic provider order.',
    '',
    '## Functional Feature Catalogue',
    '',
    `### F-01: ${featureName}`,
    '1. Purpose',
    featurePurpose,
    '2. Actors',
    'Administrator, backend configuration service.',
    '3. Trigger',
    'An administrator saves updated provider settings in the widget.',
    '4. Preconditions',
    'The user is authenticated and the selected tier exists.',
    '5. Main Flow',
    '1. The administrator edits provider order in the widget UI.',
    '2. The backend validates the payload against the configured tier rules.',
    '3. The backend persists the updated configuration and returns the saved state.',
    '6. Alternate Flows',
    '1. Invalid provider order returns a validation error and no partial write occurs.',
    '7. Postconditions',
    'The saved widget configuration can be loaded on the next request without additional repair.',
    '8. Data Impact',
    featureDataImpact,
    '9. UI Impact',
    'The widget shows a success toast after save and keeps invalid fields highlighted until corrected.',
    '10. Acceptance Criteria',
    '- [ ] Valid provider order changes persist after a page refresh.',
    '- [ ] Validation errors leave the previous configuration unchanged.',
    '',
    '## Non-Functional Requirements',
    params?.nonFunctional || '- API responses complete within 300 ms at p95 latency.\n- Audit logs are written for every configuration mutation.',
    '',
    '## Error Handling & Recovery',
    '- Validation failures return actionable field-level messages and preserve the previous configuration.',
    '',
    '## Deployment & Infrastructure',
    '- A Node.js API runs behind an authenticated edge gateway with PostgreSQL persistence.',
    '',
    '## Definition of Done',
    '- The widget ships when validation, tests, and reviewer checks all pass.',
    '',
    '## Out of Scope',
    params?.outOfScope || '- No native mobile application in this release.',
    '',
    '## Timeline & Milestones',
    '- Phase 1 delivers widget configuration, Phase 2 delivers rollout hardening.',
    '',
    '## Success Criteria & Acceptance Testing',
    '- Teams can save and reload provider order without manual correction.',
  ].join('\n');
}

describe('deterministic semantic compiler lints', () => {
  it('flags field references that contradict the Domain Model schema', () => {
    const compiled = compilePrdDocument(buildPrd({
      featureDataImpact: 'Updates WidgetSettings.selectedModelIds and WidgetSettings.providerOrderArray after the administrator saves model order.',
    }), {
      mode: 'generate',
      language: 'en',
    });

    expect(compiled.quality.issues.some(issue => issue.code === 'schema_field_reference_mismatch')).toBe(true);
    expect(compiled.quality.valid).toBe(false);
  });

  it('does not flag equivalent field identifiers that only differ in formatting', () => {
    const compiled = compilePrdDocument(buildPrd({
      featureDataImpact: 'Updates WidgetSettings.selected_model_id and WidgetSettings.provider_order_array after the administrator saves model order.',
    }), {
      mode: 'generate',
      language: 'en',
    });

    expect(compiled.quality.issues.some(issue => issue.code.startsWith('schema_field_'))).toBe(false);
  });

  it('flags numeric business-rule constraints that are contradicted elsewhere', () => {
    const compiled = compilePrdDocument(buildPrd({
      globalBusinessRules: '- API timeout must stay under 1 s for every request.\n- At most 3 switches per request are allowed.',
      nonFunctional: '- API timeout must be 2 s for the primary runtime path.\n- Rendering stays below 300 ms at p95 latency.',
    }), {
      mode: 'generate',
      language: 'en',
    });

    expect(compiled.quality.issues.some(issue => issue.code === 'business_rule_constraint_conflict')).toBe(true);
    expect(compiled.quality.valid).toBe(false);
  });

  it('flags out-of-scope items that are reintroduced as deliverables', () => {
    const compiled = compilePrdDocument(buildPrd({
      featureName: 'Native Mobile Application Shell',
      featurePurpose: 'Deliver the first native mobile application shell for provider configuration on iOS and Android.',
      outOfScope: '- No native mobile application in this release because launch scope is limited to the embedded web widget only.',
    }), {
      mode: 'generate',
      language: 'en',
    });

    expect(compiled.quality.issues.some(issue => issue.code === 'out_of_scope_reintroduced')).toBe(true);
    expect(compiled.quality.valid).toBe(false);
  });

  it('flags business-rule properties that are missing from the Domain Model', () => {
    const compiled = compilePrdDocument(buildPrd({
      domainModel: '- GameSession (sessionId, activePowerUpId, score)\n- PowerUp (powerUpId, label, effectType)',
      globalBusinessRules: '- Only one active power-up may be enabled per session and cooldown must be tracked before another use.',
      featureName: 'Power-Up Session Control',
      featurePurpose: 'Control power-up usage in the session loop.',
      featureDataImpact: 'Updates GameSession.activePowerUpId and score when a power-up is used.',
    }), {
      mode: 'improve',
      language: 'en',
    });

    expect(compiled.quality.issues.some(issue => issue.code === 'rule_schema_property_coverage_missing')).toBe(true);
    expect(compiled.quality.valid).toBe(false);
  });

  it('flags feature core semantic gaps when core mechanics are not reflected in lifecycle fields', () => {
    const compiled = compilePrdDocument(buildPrd({
      systemVision: 'A web-based Tetris experience combines power-ups with roguelite meta progression and persistent XP-based level growth.',
      domainModel: '- PlayerProfile (playerId, xp, level)\n- GameSession (sessionId, activePowerUpId, score)\n- PowerUp (powerUpId, label, effectType, cooldown)',
      globalBusinessRules: '- Power-up usage requires a cooldown after activation.\n- Players level up only when XP reaches the threshold for the next level.',
      featureName: 'Core Tetris Session',
      featurePurpose: 'Deliver classic Tetris gameplay with power-ups and roguelite meta progression.',
      featureDataImpact: 'Updates GameSession.score only after each piece lock.',
    }), {
      mode: 'improve',
      language: 'en',
    });

    expect(compiled.quality.issues.some(issue => issue.code === 'feature_core_semantic_gap')).toBe(true);
    expect(compiled.quality.valid).toBe(false);
  });

  it('flags future-oriented leakage in Out of Scope language', () => {
    const compiled = compilePrdDocument(buildPrd({
      outOfScope: '- VR integration may become part of a later roadmap phase, but it is not in this release.',
    }), {
      mode: 'improve',
      language: 'en',
    });

    expect(compiled.quality.issues.some(issue => issue.code === 'out_of_scope_future_leakage')).toBe(true);
    expect(compiled.quality.valid).toBe(false);
  });
});
