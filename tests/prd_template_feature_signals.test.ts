/*
Author: rahn
Datum: 07.03.2026
Version: 1.0
Beschreibung: Regressionstest fuer erweiterte Feature-Template-Signale
*/

/// <reference types="vitest" />
import { compilePrdDocument } from '../server/prdCompiler';

describe('feature template signal regression', () => {
  it('akzeptiert reale account- und session-bezogene feature-namen ohne signal-mismatch', () => {
    // ÄNDERUNG 07.03.2026: Reale Auth-/Account-Feature-Namen dürfen das Feature-Template nicht blockieren.
    const raw = [
      '## System Vision',
      'An identity and account security workspace helps tenant admins and users manage access workflows safely.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Revoke Active Sessions',
      '1. Purpose',
      'Tenant admins revoke active sessions for compromised accounts.',
      '10. Acceptance Criteria',
      '- Active sessions are revoked across all devices.',
      '',
      '### F-02: Retrieve Audit Events',
      '1. Purpose',
      'Admins retrieve recent security-relevant audit events.',
      '10. Acceptance Criteria',
      '- Audit events are visible with actor, timestamp, and action.',
      '',
      '### F-03: Configure Session Lifetime per Tenant',
      '1. Purpose',
      'Tenant admins configure idle and absolute session limits.',
      '10. Acceptance Criteria',
      '- Updated limits apply to new sessions.',
      '',
      '### F-04: Change User Password',
      '1. Purpose',
      'Users change their account password securely.',
      '10. Acceptance Criteria',
      '- Password changes invalidate existing login secrets as required.',
      '',
      '## Success Criteria & Acceptance Testing',
      'Users and tenant admins can complete access-management workflows with auditable results.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'en',
      templateCategory: 'feature',
    });

    expect(
      compiled.quality.issues.some(issue => issue.code === 'template_semantic_feature_signal_mismatch_feature')
    ).toBe(false);
  });

  it('akzeptiert reale technische gateway- und plattform-bezogene feature-namen ohne technical-signal-mismatch', () => {
    // ÄNDERUNG 07.03.2026: Technische Smoke-Runs erzeugen oft konkrete Plattform-
    // und Architektur-Features statt nur API-/Schema-Begriffen.
    const raw = [
      '## System Vision',
      'A technical PRD defines a resilient API gateway platform for secure traffic routing and service operations.',
      '',
      '## Domain Model',
      'Entities include RouteRule, ApiKey, CacheEntry, RetryPolicy and DeploymentTarget.',
      '',
      '## Non-Functional Requirements',
      'Security, observability, reliability and deployment hardening are explicit requirements.',
      '',
      '## Deployment & Operations',
      'The service is deployed in redundant environments with automated failover and monitoring.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Dynamic Request Routing',
      '1. Purpose',
      'Routes requests by path and header rules.',
      '10. Acceptance Criteria',
      '- Routing decisions are deterministic and traceable.',
      '',
      '### F-02: Sliding-Window Rate Limiting',
      '1. Purpose',
      'Protects services with per-key throttling.',
      '10. Acceptance Criteria',
      '- Exceeded limits return a consistent response.',
      '',
      '### F-03: JWT Key Rotation',
      '1. Purpose',
      'Rotates signing keys without downtime.',
      '10. Acceptance Criteria',
      '- Old keys remain valid during the transition window.',
      '',
      '### F-04: Response Caching with TTL',
      '1. Purpose',
      'Caches safe responses to reduce backend load.',
      '10. Acceptance Criteria',
      '- Expired entries are evicted automatically.',
      '',
      '### F-05: Circuit Breaker Failover',
      '1. Purpose',
      'Protects callers when downstream services degrade.',
      '10. Acceptance Criteria',
      '- Open circuits trigger retry and fallback behavior.',
      '',
      '### F-06: Prometheus Metrics Dashboard',
      '1. Purpose',
      'Exposes metrics for monitoring and alerting.',
      '10. Acceptance Criteria',
      '- Key latency and error metrics are visible in dashboards.',
      '',
      '## Success Criteria & Acceptance Testing',
      'The platform meets security, performance, reliability and observability targets in staging.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'en',
      templateCategory: 'technical',
    });

    expect(
      compiled.quality.issues.some(issue => issue.code === 'template_semantic_feature_signal_mismatch_technical')
    ).toBe(false);
  });

  it('akzeptiert product-launch-inhalte trotz neutralerer feature-titel ohne signal-mismatch', () => {
    // ÄNDERUNG 07.03.2026: Product-Launch-Runs dürfen nicht nur wegen neutralerer
    // Feature-Namen scheitern, wenn Purpose/Flows/Akzeptanz klar launch-spezifisch sind.
    const raw = [
      '## System Vision',
      'A launch PRD coordinates go-to-market execution, launch readiness, and measurable adoption outcomes.',
      '',
      '## System Boundaries',
      'Scope covers rollout preparation, stakeholder alignment, enablement assets, activation analytics, and launch-day coordination.',
      '',
      '## Domain Model',
      'Entities include LaunchWave, StakeholderGroup, ChannelPack, ActivationMetric, and ApprovalGate.',
      '',
      '## Global Business Rules',
      'Every launch wave requires stakeholder sign-off, channel readiness, and adoption tracking before rollout approval.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Asset Hub',
      '1. Purpose',
      'Centralizes launch messaging, rollout assets, and stakeholder approval tasks for the first market wave.',
      '10. Acceptance Criteria',
      '- Channel enablement material is complete before launch readiness review.',
      '',
      '### F-02: Field Workspace',
      '1. Purpose',
      'Coordinates partner enablement, beta communication, and regional distribution handoffs before go-live.',
      '10. Acceptance Criteria',
      '- Regional stakeholders confirm rollout readiness and communication timing.',
      '',
      '### F-03: Insight Review',
      '1. Purpose',
      'Tracks activation, adoption, and conversion signals during the first 30 days after release.',
      '10. Acceptance Criteria',
      '- Adoption and conversion metrics are visible for every rollout channel.',
      '',
      '### F-04: Decision Board',
      '1. Purpose',
      'Collects go/no-go evidence, launch blockers, and stakeholder sign-off before the rollout date.',
      '10. Acceptance Criteria',
      '- Open readiness blockers prevent final launch approval until resolved.',
      '',
      '## Non-Functional Requirements',
      'Launch dashboards update hourly and stakeholder evidence remains audit-ready.',
      '',
      '## Error Handling & Recovery',
      'Blocked rollout waves trigger escalation, corrective communication, and rollback planning.',
      '',
      '## Deployment & Infrastructure',
      'Launch operations run with scheduled release windows, analytics ingestion, and notification automation.',
      '',
      '## Definition of Done',
      'Launch readiness, stakeholder approvals, and adoption dashboards are complete and reviewed.',
      '',
      '## Out of Scope',
      'Post-launch expansion work and unrelated product redesigns are excluded from this release wave.',
      '',
      '## Timeline & Milestones',
      'Phase 1 asset preparation, Phase 2 enablement, Phase 3 rollout, Phase 4 launch monitoring and adoption review.',
      '',
      '## Success Criteria & Acceptance Testing',
      'Launch success is measured by activation, adoption, stakeholder sign-off, and stable rollout execution.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'en',
      templateCategory: 'product-launch',
    });

    expect(
      compiled.quality.issues.some(issue => issue.code === 'template_semantic_feature_signal_mismatch_product-launch')
    ).toBe(false);
  });
});