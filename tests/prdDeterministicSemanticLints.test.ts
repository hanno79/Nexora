import { describe, it, expect } from 'vitest';
import { compilePrdDocument } from '../server/prdCompiler';
import {
  collectTimelineConsistencyDiagnostics,
  rewriteTimelineMilestonesFromFeatureMap,
} from '../server/prdDeterministicSemanticLints';

function buildPrd(params?: {
  systemVision?: string;
  domainModel?: string;
  globalBusinessRules?: string;
  nonFunctional?: string;
  definitionOfDone?: string;
  outOfScope?: string;
  timelineMilestones?: string;
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
    params?.definitionOfDone || '- The widget ships when validation, tests, and reviewer checks all pass.',
    '',
    '## Out of Scope',
    params?.outOfScope || '- No native mobile application in this release.',
    '',
    '## Timeline & Milestones',
    params?.timelineMilestones || '- Phase 1 delivers widget configuration, Phase 2 delivers rollout hardening.',
    '',
    '## Success Criteria & Acceptance Testing',
    '- Teams can save and reload provider order without manual correction.',
  ].join('\n');
}

function buildVisionPriorityPrd(params: {
  systemVision: string;
  featureBlocks: string[];
  outOfScope?: string;
  timelineMilestones?: string;
  successCriteria?: string;
}): string {
  return [
    '## System Vision',
    params.systemVision,
    '',
    '## System Boundaries',
    'The product runs as a web application with authenticated users and persistent cloud storage.',
    '',
    '## Domain Model',
    '- Workspace (workspaceId, name)\n- User (userId, email)\n- DomainRecord (recordId, title, status)',
    '',
    '## Global Business Rules',
    '- The product must keep user-visible core workflows deterministic and testable across sessions.',
    '',
    '## Functional Feature Catalogue',
    '',
    ...params.featureBlocks,
    '',
    '## Non-Functional Requirements',
    '- User-facing actions complete within 300 ms at p95 latency.',
    '',
    '## Error Handling & Recovery',
    '- Recoverable failures show actionable error states without losing user progress.',
    '',
    '## Deployment & Infrastructure',
    '- The service runs in a containerized Node environment with managed persistence.',
    '',
    '## Definition of Done',
    '- Core user workflows are implemented, tested, and reviewable from the PRD alone.',
    '',
    '## Out of Scope',
    params.outOfScope || '- Native mobile applications are excluded from this release.',
    '',
    '## Timeline & Milestones',
    params.timelineMilestones || '- Phase 1 delivers core features. Phase 2 adds support workflows.',
    '',
    '## Success Criteria & Acceptance Testing',
    params.successCriteria || '- Primary user workflows are testable and complete in the leading feature set.',
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

  it('does not treat storage table names as schema field identifier mismatches', () => {
    const compiled = compilePrdDocument([
      '## System Vision',
      'A browser-based Tetris webapp stores personal bests and session scores for returning players.',
      '',
      '## System Boundaries',
      'The system includes a React frontend, a Node.js backend API, and PostgreSQL persistence.',
      '',
      '## Domain Model',
      '- PlayerProfile (playerId, playerScore, bestScore)',
      '- GameSession (sessionId, playerId, score)',
      '',
      '## Global Business Rules',
      '- Personal best lookups may read historical score storage but must not mutate saved scores.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Double Points Bonus',
      '1. Purpose',
      'Double the score earned during a short bonus window.',
      '2. Actors',
      'Player, scoring service.',
      '3. Trigger',
      'The player activates the bonus in the HUD.',
      '4. Preconditions',
      'The player is in an active session.',
      '5. Main Flow',
      '1. The player activates the bonus.',
      '2. The scoring service applies the multiplier to the current session.',
      '6. Alternate Flows',
      '1. If no session is active, the bonus activation is rejected.',
      '7. Postconditions',
      'The current session score reflects the temporary multiplier.',
      '8. Data Impact',
      'Updates PlayerProfile.playerScore and GameSession.score after each cleared line.',
      '9. UI Impact',
      'The HUD shows a temporary double-points state.',
      '10. Acceptance Criteria',
      '- [ ] The displayed session score matches the stored player score contribution.',
      '',
      '### F-02: Personal Best Widget',
      '1. Purpose',
      'Show the signed-in player personal best score.',
      '2. Actors',
      'Player, frontend widget, backend score API.',
      '3. Trigger',
      'The player opens the dashboard.',
      '4. Preconditions',
      'The player is authenticated.',
      '5. Main Flow',
      '1. The backend runs a SQL query against table `player_scores` to load the highest saved score.',
      '2. The widget renders the returned best score.',
      '6. Alternate Flows',
      '1. If no score exists, the widget renders zero.',
      '7. Postconditions',
      'The widget shows the latest best score without modifying score storage.',
      '8. Data Impact',
      'Read-only access on `player_scores` for lookup and cache refresh.',
      '9. UI Impact',
      'The dashboard renders the personal best panel.',
      '10. Acceptance Criteria',
      '- [ ] The widget renders the highest stored score for the player.',
      '',
      '## Non-Functional Requirements',
      '- Personal best queries complete within 300 ms at p95 latency.',
      '',
      '## Error Handling & Recovery',
      '- Score lookup failures show a retry option without modifying persisted data.',
      '',
      '## Deployment & Infrastructure',
      '- The Node.js API runs behind an authenticated edge gateway with PostgreSQL persistence.',
      '',
      '## Definition of Done',
      '- The score widget ships with automated tests and verified persistence behaviour.',
      '',
      '## Out of Scope',
      '- Native mobile applications are not part of this release.',
      '',
      '## Timeline & Milestones',
      '- Phase 1 delivers scoring, Phase 2 delivers dashboard refinements.',
      '',
      '## Success Criteria & Acceptance Testing',
      '- Players can see their best score without storage regressions.',
    ].join('\n'), {
      mode: 'improve',
      language: 'en',
    });

    expect(compiled.quality.issues.some(issue => issue.code === 'schema_field_identifier_mismatch')).toBe(false);
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

  it('flags out-of-scope contradictions when system vision reintroduces multiplayer', () => {
    const compiled = compilePrdDocument(buildPrd({
      systemVision: 'A browser-based Tetris webapp combines classic gameplay with real-time multiplayer and power-ups.',
      outOfScope: '- Multiplayer mode is not part of this release and remains explicitly excluded.',
      featureName: 'Singleplayer Core Loop',
      featurePurpose: 'Deliver the deterministic singleplayer gameplay loop only.',
      featureDataImpact: 'Updates GameSession.score and PlayerProfile.xp after each finished singleplayer run.',
    }), {
      mode: 'improve',
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
    // Severity ist 'warning' — quality bleibt valid
    expect(compiled.quality.issues.find(issue => issue.code === 'rule_schema_property_coverage_missing')?.severity).toBe('warning');
    expect(compiled.quality.valid).toBe(true);
  });

  // ÄNDERUNG 10.03.2026: Auth-Regeln mit Verben wie `used` oder `retry`
  // duerfen keine falsch-positiven Schema-Property-Lints ausloesen.
  it('flaggt keine nackten Verb-Tokens wie use oder retry als fehlende Domain-Properties im Auth-Regeltext', () => {
    const compiled = compilePrdDocument(buildPrd({
      systemVision: 'An authentication service lets users sign in securely, recover access, and complete MFA verification with audit logging.',
      domainModel: '- User (userId, email, passwordHash)\n- Session (sessionId, userId, expiresAt)\n- PasswordResetToken (tokenId, userId, expiresAt, consumedAt)\n- AuditLogEntry (entryId, actorUserId, eventType, createdAt)',
      globalBusinessRules: '- Password reset tokens may be used only once and expire after 15 minutes.\n- Email delivery failures trigger a retry with exponential backoff up to three attempts.\n- MFA verification failures are written to the audit log.',
      featureName: 'Password Recovery and MFA Verification',
      featurePurpose: 'Allow users to recover account access and complete protected sign-in verification.',
      featureDataImpact: 'Creates PasswordResetToken.consumedAt records, updates Session.expiresAt, and writes AuditLogEntry.eventType entries.',
    }), {
      mode: 'generate',
      language: 'en',
    });

    const ruleSchemaIssues = compiled.quality.issues.filter(issue => issue.code === 'rule_schema_property_coverage_missing');
    expect(ruleSchemaIssues).toEqual([]);
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

  it('flags degenerate section content when list bullets wrap markdown headings with non-dash markers', () => {
    const compiled = compilePrdDocument(buildPrd({
      nonFunctional: '* ### Latency Budget\n* ### Throughput Requirements\n* ### Availability Targets',
    }), {
      mode: 'generate',
      language: 'en',
    });

    expect(compiled.quality.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'section_content_degenerate',
        evidencePath: 'nonFunctional',
      }),
    ]));
    expect(compiled.quality.valid).toBe(false);
  });

  it('flags self-referential placeholders for every configured degenerate section key', () => {
    const compiled = compilePrdDocument(buildPrd({
      timelineMilestones: 'The Timeline & Milestones section is deferred to a later release cycle.',
    }), {
      mode: 'generate',
      language: 'en',
    });

    expect(compiled.quality.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'section_content_degenerate',
        evidencePath: 'timelineMilestones',
      }),
    ]));
    expect(compiled.quality.valid).toBe(false);
  });

  it('flags contradictory deployment/runtime models across boundaries and deployment', () => {
    const compiled = compilePrdDocument(buildPrd({
      systemVision: 'A browser-based Tetris platform with deterministic session storage and power-up progression.',
      domainModel: '- PlayerProfile (playerId, xp, level)\n- GameSession (sessionId, activePowerUpId, score, cooldown)\n- PowerUp (powerUpId, cooldown, effectType)',
      globalBusinessRules: '- Only one active power-up may be enabled per session and cooldown must be tracked before another use.',
      outOfScope: '- Multiplayer mode is not included in this release.',
    }).replace(
      'The system includes a React widget, a backend configuration API, and persistent tier settings stored in PostgreSQL.',
      'The system runs as a SaaS web app on AWS ECS/Fargate with container-based services and PostgreSQL persistence.'
    ).replace(
      '- A Node.js API runs behind an authenticated edge gateway with PostgreSQL persistence.',
      '- The runtime is deployed as AWS Lambda functions behind API Gateway with PostgreSQL persistence.'
    ), {
      mode: 'generate',
      language: 'en',
    });

    expect(compiled.quality.issues.some(issue => issue.code === 'deployment_runtime_contradiction')).toBe(true);
    expect(compiled.quality.valid).toBe(false);
  });

  it('flags when leading features overweight support capabilities ahead of primary vision value', () => {
    const compiled = compilePrdDocument(buildVisionPriorityPrd({
      systemVision: 'A browser-based Tetris webapp focuses on core gameplay, power-ups, and long-term roguelite progression for replayability.',
      featureBlocks: [
        [
          '### F-01: OAuth User Registration',
          'Feature ID: F-01',
          '1. Purpose',
          'Allow users to register with OAuth providers.',
          '2. Actors',
          'User.',
          '3. Trigger',
          'The user opens the registration form.',
          '4. Preconditions',
          'OAuth providers are configured.',
          '5. Main Flow',
          '1. The user selects Google sign-in.',
          '2. The app creates the account.',
          '6. Alternate Flows',
          '1. Provider login fails and an error is shown.',
          '7. Postconditions',
          'The user account exists and can access settings.',
          '8. Data Impact',
          'Creates a user profile and auth record.',
          '9. UI Impact',
          'Shows a registration form and success state.',
          '10. Acceptance Criteria',
          '- [ ] OAuth registration works.',
        ].join('\n'),
        [
          '### F-02: User Profile Page',
          'Feature ID: F-02',
          '1. Purpose',
          'Show user profile preferences and saved account settings.',
          '2. Actors',
          'User.',
          '3. Trigger',
          'The user opens the profile page.',
          '4. Preconditions',
          'The user is authenticated.',
          '5. Main Flow',
          '1. The profile page loads.',
          '2. Saved settings are displayed.',
          '6. Alternate Flows',
          '1. Missing data shows an empty-state banner.',
          '7. Postconditions',
          'The user can review saved preferences.',
          '8. Data Impact',
          'Reads and updates profile settings.',
          '9. UI Impact',
          'Renders profile cards and settings controls.',
          '10. Acceptance Criteria',
          '- [ ] Users can view their profile.',
        ].join('\n'),
        [
          '### F-03: Power-Up Session Loop',
          'Feature ID: F-03',
          '1. Purpose',
          'Deliver the core Tetris gameplay loop with power-ups and persistent progression rewards.',
          '2. Actors',
          'Player.',
          '3. Trigger',
          'The player starts a run.',
          '4. Preconditions',
          'A session is active and power-up inventory is available.',
          '5. Main Flow',
          '1. The player clears lines and activates power-ups.',
          '2. The session awards score and progression progress.',
          '6. Alternate Flows',
          '1. Missing power-ups show a disabled state.',
          '7. Postconditions',
          'The run updates score, progression, and session outcome.',
          '8. Data Impact',
          'Updates score, power-up inventory, and progression state.',
          '9. UI Impact',
          'Shows the active board, power-up HUD, and reward feedback.',
          '10. Acceptance Criteria',
          '- [ ] Players can complete a run with power-ups and progression updates.',
        ].join('\n'),
      ],
    }), {
      mode: 'generate',
      language: 'en',
      contextHint: 'Build a Tetris webapp focused on power-ups and meta progression.',
    });

    expect(compiled.quality.issues.some(issue => issue.code === 'support_features_overweight')).toBe(true);
    expect(compiled.quality.supportFeatureIds).toEqual(expect.arrayContaining(['F-01', 'F-02']));
    expect(compiled.quality.coreFeatureIds).toEqual(expect.arrayContaining(['F-03']));
  });

  it('filters noisy capability anchors and keeps meaningful vision signals', () => {
    const compiled = compilePrdDocument(buildVisionPriorityPrd({
      systemVision: 'Eine klassische Tetris-Webapp kann Spieler langfristig binden und kombiniert Power-Ups mit Roguelite Meta Progression.',
      featureBlocks: [
        [
          '### F-01: Core Tetris Gameplay',
          'Feature ID: F-01',
          '1. Purpose',
          'Allow players to play a classic Tetris run with score progression.',
          '2. Actors',
          'Player.',
          '3. Trigger',
          'The player starts a run.',
          '4. Preconditions',
          'A run can be started.',
          '5. Main Flow',
          '1. The player clears lines and increases score.',
          '2. The run state updates after each move.',
          '6. Alternate Flows',
          '1. The player may pause and resume the run.',
          '7. Postconditions',
          'A completed run updates score and progression state.',
          '8. Data Impact',
          'Updates the active run, score, and progression state.',
          '9. UI Impact',
          'Shows the board, score, and progression HUD.',
          '10. Acceptance Criteria',
          '- [ ] Players can complete a classic run.',
        ].join('\n'),
      ],
    }), {
      mode: 'generate',
      language: 'de',
      contextHint: 'Eine klassische Tetris-Webapp mit Power-Ups und Rogue Lite Meta Progression.',
    });

    expect(compiled.quality.primaryCapabilityAnchors).toEqual(expect.arrayContaining(['tetris', 'power']));
    expect(compiled.quality.primaryCapabilityAnchors).not.toEqual(expect.arrayContaining(['eine', 'kann', 'tetri', 'lite']));
  });

  it('does not flag vision coverage for a todo app whose leading features match the primary user value', () => {
    const compiled = compilePrdDocument(buildVisionPriorityPrd({
      systemVision: 'A collaborative to-do application helps users capture, organize, prioritize, and complete work without friction.',
      featureBlocks: [
        [
          '### F-01: Task Capture',
          'Feature ID: F-01',
          '1. Purpose',
          'Allow users to create tasks quickly with titles, due dates, and notes.',
          '2. Actors',
          'User.',
          '3. Trigger',
          'The user clicks the add-task button.',
          '4. Preconditions',
          'The workspace is open.',
          '5. Main Flow',
          '1. The user enters task details.',
          '2. The task is saved and shown in the list.',
          '6. Alternate Flows',
          '1. Invalid input shows validation feedback.',
          '7. Postconditions',
          'A new task exists in the active list.',
          '8. Data Impact',
          'Creates a task record with title, due date, and status.',
          '9. UI Impact',
          'Updates the task list and confirmation state.',
          '10. Acceptance Criteria',
          '- [ ] Users can create tasks with required fields.',
        ].join('\n'),
        [
          '### F-02: Task Prioritization',
          'Feature ID: F-02',
          '1. Purpose',
          'Let users sort and prioritize tasks by urgency and importance.',
          '2. Actors',
          'User.',
          '3. Trigger',
          'The user edits a task priority.',
          '4. Preconditions',
          'At least one task exists.',
          '5. Main Flow',
          '1. The user chooses a priority.',
          '2. The list reorders by priority rules.',
          '6. Alternate Flows',
          '1. Missing priority falls back to default.',
          '7. Postconditions',
          'Tasks remain ordered by priority.',
          '8. Data Impact',
          'Updates the task priority field.',
          '9. UI Impact',
          'Shows priority badges and reordered tasks.',
          '10. Acceptance Criteria',
          '- [ ] Users can reprioritize tasks.',
        ].join('\n'),
        [
          '### F-03: Task Completion',
          'Feature ID: F-03',
          '1. Purpose',
          'Allow users to mark work complete and review completed tasks.',
          '2. Actors',
          'User.',
          '3. Trigger',
          'The user marks a task complete.',
          '4. Preconditions',
          'A task exists in the active list.',
          '5. Main Flow',
          '1. The user completes the task.',
          '2. The task moves to the completed view.',
          '6. Alternate Flows',
          '1. Undo restores the task to active.',
          '7. Postconditions',
          'The task status is complete and history is retained.',
          '8. Data Impact',
          'Updates task status and completion timestamp.',
          '9. UI Impact',
          'Moves the task into the completed section.',
          '10. Acceptance Criteria',
          '- [ ] Users can complete and reopen tasks.',
        ].join('\n'),
      ],
    }), {
      mode: 'generate',
      language: 'en',
      contextHint: 'Create a todo app focused on capturing, organizing, and completing tasks.',
    });

    expect(compiled.quality.issues.some(issue => issue.code === 'vision_capability_coverage_missing')).toBe(false);
    expect(compiled.quality.issues.some(issue => issue.code === 'support_features_overweight')).toBe(false);
    expect(compiled.quality.coreFeatureIds).toEqual(expect.arrayContaining(['F-01', 'F-03']));
  });

  // ÄNDERUNG 10.03.2026: Auth-zentrierte Kernfaehigkeiten duerfen nicht wegen
  // Login-/Auth-Signalen pauschal als Support klassifiziert werden.
  it('stuft auth-zentrierte Kernfeatures trotz Support-Begriffen als Core ein, wenn die Vision stark genug passt', () => {
    const compiled = compilePrdDocument(buildVisionPriorityPrd({
      systemVision: 'An authentication product lets users sign in with email and password, recover account access through reset links, and protect access with TOTP multi-factor verification.',
      featureBlocks: [
        [
          '### F-01: Email and Password Login',
          'Feature ID: F-01',
          '1. Purpose',
          'Allow users to sign in with email and password and gain secure account access.',
          '2. Actors',
          'User.',
          '3. Trigger',
          'The user submits the login form.',
          '4. Preconditions',
          'A registered account exists and the email address is confirmed.',
          '5. Main Flow',
          '1. The user enters email and password.',
          '2. The system validates the credentials and creates an authenticated session for account access.',
          '6. Alternate Flows',
          '1. Invalid credentials show an access error without creating a session.',
          '7. Postconditions',
          'The user has secure account access through an active session.',
          '8. Data Impact',
          'Creates a session record and stores the successful login timestamp.',
          '9. UI Impact',
          'Shows the login form, inline errors, and signed-in state.',
          '10. Acceptance Criteria',
          '- [ ] Users can sign in with valid email and password credentials.',
        ].join('\n'),
        [
          '### F-02: Password Reset via Email Link',
          'Feature ID: F-02',
          '1. Purpose',
          'Allow users to recover account access through a password reset email link.',
          '2. Actors',
          'User.',
          '3. Trigger',
          'The user requests a password reset.',
          '4. Preconditions',
          'The user knows the account email address.',
          '5. Main Flow',
          '1. The system sends a password reset link to the user email address.',
          '2. The user opens the link and saves a new password to restore account access.',
          '6. Alternate Flows',
          '1. Expired links require a new reset request.',
          '7. Postconditions',
          'The user regains account access with the updated password.',
          '8. Data Impact',
          'Stores a reset token, invalidates the previous token, and updates the saved password hash.',
          '9. UI Impact',
          'Shows the reset request form, email confirmation state, and new-password form.',
          '10. Acceptance Criteria',
          '- [ ] Users can recover access through a valid reset link.',
        ].join('\n'),
        [
          '### F-03: TOTP MFA Verification',
          'Feature ID: F-03',
          '1. Purpose',
          'Protect secure account access with TOTP multi-factor verification during sign-in.',
          '2. Actors',
          'User.',
          '3. Trigger',
          'The user enrolls MFA or signs in from a new device.',
          '4. Preconditions',
          'The account password is valid and the user can access the verification screen.',
          '5. Main Flow',
          '1. The system issues a TOTP enrollment secret and shows the verification setup.',
          '2. The user enters a valid verification code to complete protected account access.',
          '6. Alternate Flows',
          '1. Invalid verification codes are rejected and access remains blocked.',
          '7. Postconditions',
          'The account keeps secure access rules with verified multi-factor protection.',
          '8. Data Impact',
          'Stores the MFA enrollment state and last successful verification timestamp.',
          '9. UI Impact',
          'Shows the MFA setup screen, code entry form, and verification success state.',
          '10. Acceptance Criteria',
          '- [ ] Users can complete TOTP verification before protected access is granted.',
        ].join('\n'),
      ],
    }), {
      mode: 'generate',
      language: 'en',
      contextHint: 'Build an authentication system focused on email login, password reset, and TOTP multi-factor verification.',
    });

    expect(compiled.quality.issues.some(issue => issue.code === 'vision_capability_coverage_missing')).toBe(false);
    expect(compiled.quality.issues.some(issue => issue.code === 'support_features_overweight')).toBe(false);
    expect(compiled.quality.coreFeatureIds).toEqual(expect.arrayContaining(['F-01', 'F-02', 'F-03']));
  });

  it('flaggt keine feature core semantic gaps, wenn globale Auth-Anker nur bereichsweit geteilt sind', () => {
    const compiled = compilePrdDocument(buildVisionPriorityPrd({
      systemVision: 'An authentication product lets users sign in with email and password, recover account access through reset links, and protect access with TOTP multi-factor verification.',
      featureBlocks: [
        [
          '### F-01: Email and Password Login',
          'Feature ID: F-01',
          '1. Purpose',
          'Authenticate users with email and password, create a secure session, and enable follow-up recovery or MFA workflows after sign-in.',
          '2. Actors',
          'User.',
          '3. Trigger',
          'The user submits the login form with email and password.',
          '4. Preconditions',
          'A registered account exists and the password is valid.',
          '5. Main Flow',
          '1. The system validates the email and password.',
          '2. The system creates an authenticated session for the user.',
          '6. Alternate Flows',
          '1. Invalid credentials return an access error without creating a session.',
          '7. Postconditions',
          'The user has secure access through an active session.',
          '8. Data Impact',
          'Creates a session record and stores the successful login timestamp.',
          '9. UI Impact',
          'Shows the login form and signed-in state.',
          '10. Acceptance Criteria',
          '- [ ] Users can sign in with valid credentials.',
        ].join('\n'),
        [
          '### F-02: Password Reset via Email Link',
          'Feature ID: F-02',
          '1. Purpose',
          'Allow users to recover account access through a password reset email link.',
          '2. Actors',
          'User.',
          '3. Trigger',
          'The user requests a password reset.',
          '4. Preconditions',
          'The user knows the account email address.',
          '5. Main Flow',
          '1. The system sends a password reset link to the user email address.',
          '2. The user saves a new password to restore account access.',
          '6. Alternate Flows',
          '1. Expired links require a new reset request.',
          '7. Postconditions',
          'The user regains account access with the updated password.',
          '8. Data Impact',
          'Stores a reset token and updates the saved password hash.',
          '9. UI Impact',
          'Shows the reset request form and new-password form.',
          '10. Acceptance Criteria',
          '- [ ] Users can recover access through a valid reset link.',
        ].join('\n'),
        [
          '### F-03: TOTP MFA Verification',
          'Feature ID: F-03',
          '1. Purpose',
          'Protect secure account access with TOTP multi-factor verification during sign-in.',
          '2. Actors',
          'User.',
          '3. Trigger',
          'The user signs in from a new device and must complete MFA verification.',
          '4. Preconditions',
          'The account password is valid and the MFA setup exists.',
          '5. Main Flow',
          '1. The system prompts for a TOTP verification code.',
          '2. The user enters a valid code and receives protected account access.',
          '6. Alternate Flows',
          '1. Invalid codes are rejected and access remains blocked.',
          '7. Postconditions',
          'The account keeps verified multi-factor protection.',
          '8. Data Impact',
          'Stores the last successful MFA verification timestamp.',
          '9. UI Impact',
          'Shows the MFA verification screen and success state.',
          '10. Acceptance Criteria',
          '- [ ] Users can complete TOTP verification before protected access is granted.',
        ].join('\n'),
      ],
    }), {
      mode: 'generate',
      language: 'en',
      contextHint: 'Build an authentication system focused on email login, password reset, and TOTP multi-factor verification.',
    });

    expect(compiled.quality.issues.some(issue => issue.code === 'feature_core_semantic_gap')).toBe(false);
  });

  it('flags timeline feature reference mismatches against the canonical feature catalogue', () => {
    const compiled = compilePrdDocument([
      '## System Vision',
      'A browser-based Tetris webapp focuses on core gameplay, power-ups, and roguelite progression.',
      '',
      '## System Boundaries',
      'The system runs as a web application with persistent cloud storage.',
      '',
      '## Domain Model',
      '- PlayerProfile (playerId, xp, level)\n- GameSession (sessionId, score)',
      '',
      '## Global Business Rules',
      '- Feature IDs remain stable and milestones must reference the same capabilities as the feature catalogue.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Player Profile',
      'Feature ID: F-01',
      '1. Purpose',
      'Allow the player to manage saved profile preferences and view progression.',
      '2. Actors',
      'Player.',
      '3. Trigger',
      'The player opens the profile page.',
      '4. Preconditions',
      'The player is authenticated.',
      '5. Main Flow',
      '1. The player opens profile settings.',
      '2. The system loads saved profile state.',
      '6. Alternate Flows',
      '1. Missing profile data renders a placeholder state.',
      '7. Postconditions',
      'Profile settings remain available across sessions.',
      '8. Data Impact',
      'Reads and updates PlayerProfile preferences.',
      '9. UI Impact',
      'Shows profile settings and saved progression summaries.',
      '10. Acceptance Criteria',
      '- [ ] Players can update saved profile preferences.',
      '',
      '### F-02: Core Tetris Gameplay',
      'Feature ID: F-02',
      '1. Purpose',
      'Deliver the primary Tetris gameplay loop with score progression.',
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
      '1. A failed session returns the player to the start menu.',
      '7. Postconditions',
      'The run score is stored for later comparison.',
      '8. Data Impact',
      'Updates GameSession.score.',
      '9. UI Impact',
      'Shows the board, score HUD, and pause controls.',
      '10. Acceptance Criteria',
      '- [ ] Players can complete a Tetris run.',
      '',
      '## Non-Functional Requirements',
      '- Core game actions remain responsive.',
      '',
      '## Error Handling & Recovery',
      '- Recoverable failures do not lose player progress.',
      '',
      '## Deployment & Infrastructure',
      '- The service runs in a containerized web environment.',
      '',
      '## Definition of Done',
      '- Core feature references stay consistent across sections.',
      '',
      '## Out of Scope',
      '- Native mobile applications are excluded.',
      '',
      '## Timeline & Milestones',
      '- Phase 1 delivers F-01 Core Tetris Gameplay with score progression and run state updates.',
      '- Phase 2 delivers F-02 Player Profile preferences, saved progression summaries and profile settings.',
      '',
      '## Success Criteria & Acceptance Testing',
      '- Milestones match the implemented feature catalogue.',
    ].join('\n'), {
      mode: 'generate',
      language: 'en',
    });

    expect(compiled.quality.issues.some(issue => issue.code === 'timeline_feature_reference_mismatch')).toBe(true);
    expect(compiled.quality.timelineMismatchedFeatureIds).toEqual(expect.arrayContaining(['F-01', 'F-02']));
  });

  it('flaggt keine timeline mismatch issues fuer Sammelzeilen mit mehreren korrekt benannten Referenzen', () => {
    const compiled = compilePrdDocument(buildVisionPriorityPrd({
      systemVision: 'An authentication product lets users sign in with email and password, recover account access through reset links, and protect access with TOTP multi-factor verification.',
      featureBlocks: [
        [
          '### F-01: Email and Password Login',
          'Feature ID: F-01',
          '1. Purpose',
          'Allow users to sign in with email and password and gain secure account access.',
          '2. Actors',
          'User.',
          '3. Trigger',
          'The user submits the login form.',
          '4. Preconditions',
          'A registered account exists and the email address is confirmed.',
          '5. Main Flow',
          '1. The user enters email and password.',
          '2. The system validates the credentials and creates an authenticated session.',
          '6. Alternate Flows',
          '1. Invalid credentials show an access error without creating a session.',
          '7. Postconditions',
          'The user has secure account access through an active session.',
          '8. Data Impact',
          'Creates a session record and stores the successful login timestamp.',
          '9. UI Impact',
          'Shows the login form and signed-in state.',
          '10. Acceptance Criteria',
          '- [ ] Users can sign in with valid email and password credentials.',
        ].join('\n'),
        [
          '### F-02: Password Reset via Email Link',
          'Feature ID: F-02',
          '1. Purpose',
          'Allow users to recover account access through a password reset email link.',
          '2. Actors',
          'User.',
          '3. Trigger',
          'The user requests a password reset.',
          '4. Preconditions',
          'The user knows the account email address.',
          '5. Main Flow',
          '1. The system sends a password reset link to the user email address.',
          '2. The user opens the link and saves a new password.',
          '6. Alternate Flows',
          '1. Expired links require a new reset request.',
          '7. Postconditions',
          'The user regains account access with the updated password.',
          '8. Data Impact',
          'Stores a reset token and updates the saved password hash.',
          '9. UI Impact',
          'Shows the reset request form and new-password form.',
          '10. Acceptance Criteria',
          '- [ ] Users can recover access through a valid reset link.',
        ].join('\n'),
        [
          '### F-03: TOTP MFA Verification',
          'Feature ID: F-03',
          '1. Purpose',
          'Protect secure account access with TOTP multi-factor verification during sign-in.',
          '2. Actors',
          'User.',
          '3. Trigger',
          'The user signs in from a new device.',
          '4. Preconditions',
          'The account password is valid and the user can access the verification screen.',
          '5. Main Flow',
          '1. The system issues a TOTP challenge.',
          '2. The user enters a valid verification code to complete protected account access.',
          '6. Alternate Flows',
          '1. Invalid verification codes are rejected and access remains blocked.',
          '7. Postconditions',
          'The account keeps secure access rules with verified multi-factor protection.',
          '8. Data Impact',
          'Stores the last successful verification timestamp.',
          '9. UI Impact',
          'Shows the MFA setup screen and code entry form.',
          '10. Acceptance Criteria',
          '- [ ] Users can complete TOTP verification before protected access is granted.',
        ].join('\n'),
      ],
      timelineMilestones: '- Phase 2 (Core Features): Implementation of F-01 Email and Password Login, F-02 Password Reset via Email Link, F-03 TOTP MFA Verification.',
    }), {
      mode: 'generate',
      language: 'en',
      contextHint: 'Build an authentication system focused on email login, password reset, and TOTP multi-factor verification.',
    });

    const diagnostics = collectTimelineConsistencyDiagnostics(compiled.structure);

    expect(compiled.quality.issues.some(issue => issue.code === 'timeline_feature_reference_mismatch')).toBe(false);
    expect(diagnostics.timelineMismatchedFeatureIds).toEqual([]);
  });

  it('rewrites mismatched timeline references from the canonical feature map without renumbering features', () => {
    const compiled = compilePrdDocument([
      '## System Vision',
      'A browser-based Tetris webapp focuses on core gameplay and progression.',
      '',
      '## System Boundaries',
      'The system runs as a web application with persistent storage.',
      '',
      '## Domain Model',
      '- PlayerProfile (playerId, xp, level)\n- GameSession (sessionId, score)',
      '',
      '## Global Business Rules',
      '- Feature IDs remain stable across planning sections.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Player Profile',
      'Feature ID: F-01',
      '1. Purpose',
      'Allow players to update profile preferences.',
      '2. Actors',
      'Player.',
      '3. Trigger',
      'The player opens the profile page.',
      '4. Preconditions',
      'The player is authenticated.',
      '5. Main Flow',
      '1. The player edits profile details.',
      '2. The system persists the update.',
      '6. Alternate Flows',
      '1. Validation errors are shown inline.',
      '7. Postconditions',
      'Profile details remain saved.',
      '8. Data Impact',
      'Updates PlayerProfile preferences.',
      '9. UI Impact',
      'Shows profile settings.',
      '10. Acceptance Criteria',
      '- [ ] Players can update profile details.',
      '',
      '### F-02: Core Tetris Gameplay',
      'Feature ID: F-02',
      '1. Purpose',
      'Deliver the primary Tetris gameplay loop.',
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
      '1. The player may pause and resume the run.',
      '7. Postconditions',
      'Run score is stored for later comparison.',
      '8. Data Impact',
      'Updates GameSession.score.',
      '9. UI Impact',
      'Shows the board and score HUD.',
      '10. Acceptance Criteria',
      '- [ ] Players can complete a run.',
      '',
      '## Non-Functional Requirements',
      '- Core gameplay remains responsive.',
      '',
      '## Error Handling & Recovery',
      '- Recoverable failures do not lose player progress.',
      '',
      '## Deployment & Infrastructure',
      '- The service runs in a containerized web environment.',
      '',
      '## Definition of Done',
      '- Core feature references stay consistent across sections.',
      '',
      '## Out of Scope',
      '- Native mobile applications are excluded.',
      '',
      '## Timeline & Milestones',
      '- Phase 1 delivers F-01 Core Tetris Gameplay with score progression and run state updates.',
      '- Phase 2 delivers F-02 Player Profile preferences, saved progression summaries and profile settings.',
      '',
      '## Success Criteria & Acceptance Testing',
      '- Milestones match the implemented feature catalogue.',
    ].join('\n'), {
      mode: 'generate',
      language: 'en',
    });

    const diagnostics = collectTimelineConsistencyDiagnostics(compiled.structure);
    const rewrite = rewriteTimelineMilestonesFromFeatureMap(compiled.structure, 'en');

    expect(diagnostics.timelineMismatchedFeatureIds).toEqual(expect.arrayContaining(['F-01', 'F-02']));
    expect(rewrite.changed).toBe(true);
    expect(rewrite.content).toContain('Phase 1 delivers F-01 Player Profile');
    expect(rewrite.content).toContain('Phase 2 delivers F-02 Core Tetris Gameplay');
    expect(rewrite.content).not.toContain('F-01 Core Tetris Gameplay');
    expect(rewrite.appliedLines).toBe(2);
  });

  it('rewrites timeline table cells from the canonical feature map without keeping stale feature prose', () => {
    const compiled = compilePrdDocument([
      '## System Vision',
      'A browser-based Tetris webapp focuses on core gameplay and progression.',
      '',
      '## System Boundaries',
      'The system runs as a web application with persistent storage.',
      '',
      '## Domain Model',
      '- PlayerProfile (playerId, xp, level)',
      '- GameSession (sessionId, score)',
      '',
      '## Global Business Rules',
      '- Feature IDs remain stable across planning sections.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Player Profile',
      'Feature ID: F-01',
      '1. Purpose',
      'Allow players to update profile preferences.',
      '2. Actors',
      'Player.',
      '3. Trigger',
      'The player opens the profile page.',
      '4. Preconditions',
      'The player is authenticated.',
      '5. Main Flow',
      '1. The player edits profile details.',
      '2. The system persists the update.',
      '6. Alternate Flows',
      '1. Validation errors are shown inline.',
      '7. Postconditions',
      'Profile details remain saved.',
      '8. Data Impact',
      'Updates PlayerProfile preferences.',
      '9. UI Impact',
      'Shows profile settings.',
      '10. Acceptance Criteria',
      '- [ ] Players can update profile details.',
      '',
      '### F-02: Core Tetris Gameplay',
      'Feature ID: F-02',
      '1. Purpose',
      'Deliver the primary Tetris gameplay loop.',
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
      '1. The player may pause and resume the run.',
      '7. Postconditions',
      'Run score is stored for later comparison.',
      '8. Data Impact',
      'Updates GameSession.score.',
      '9. UI Impact',
      'Shows the board and score HUD.',
      '10. Acceptance Criteria',
      '- [ ] Players can complete a run.',
      '',
      '## Non-Functional Requirements',
      '- Core gameplay remains responsive.',
      '',
      '## Error Handling & Recovery',
      '- Recoverable failures do not lose player progress.',
      '',
      '## Deployment & Infrastructure',
      '- The service runs in a containerized web environment.',
      '',
      '## Definition of Done',
      '- Core feature references stay consistent across sections.',
      '',
      '## Out of Scope',
      '- Native mobile applications are excluded.',
      '',
      '## Timeline & Milestones',
      '| Phase | Scope |',
      '| --- | --- |',
      '| 1 | F-01 Core Tetris Gameplay with score progression and run state updates |',
      '| 2 | F-02 Player Profile preferences saved progression summaries and profile settings |',
      '',
      '## Success Criteria & Acceptance Testing',
      '- Milestones match the implemented feature catalogue.',
    ].join('\n'), {
      mode: 'generate',
      language: 'en',
    });

    const rewrite = rewriteTimelineMilestonesFromFeatureMap(compiled.structure, 'en');

    expect(rewrite.changed).toBe(true);
    expect(rewrite.content).toContain('| 1 | F-01 Player Profile |');
    expect(rewrite.content).toContain('| 2 | F-02 Core Tetris Gameplay |');
    expect(rewrite.content).not.toContain('F-01 Core Tetris Gameplay');
    expect(rewrite.appliedLines).toBe(2);
  });
});
