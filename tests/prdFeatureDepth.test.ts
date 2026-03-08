/// <reference types="vitest" />
import { extractFieldHintsFromRaw, ensurePrdFeatureDepth, validatePrdStructure } from '../server/prdCompiler';
import type { PRDStructure } from '../server/prdParser';

describe('extractFieldHintsFromRaw', () => {
  it('extracts numbered mainFlow steps from rawContent', () => {
    const raw = `### F-02: Leaderboard Database Schema

**1. Purpose**
Erstelle das Datenbankschema fuer das Leaderboard mit Spieler-Scores.

**5. Main Flow**
1. Erstelle eine SQLite-Datenbank im Projektverzeichnis.
2. Definiere die Tabelle "scores" mit Spalten id, name, score, created_at.
3. Fuege einen Index auf die score-Spalte hinzu.
4. Erstelle eine Seed-Datei mit Beispiel-Eintraegen.`;

    const hints = extractFieldHintsFromRaw(raw);

    expect(hints.mainFlowHint).toBeDefined();
    expect(hints.mainFlowHint!.length).toBe(4);
    expect(hints.mainFlowHint![0]).toMatch(/SQLite/);
    expect(hints.mainFlowHint![1]).toMatch(/scores/);
  });

  it('does not treat numbered feature field labels as mainFlow steps', () => {
    const raw = `### F-11: Game Session End Recording

1. Purpose: Persistiert das Ergebnis einer beendeten Spiel-Session.
2. Actors: Frontend-Engine, Session-Service.
3. Trigger: Spiel-Engine sendet POST /api/sessions/{sessionId}/end.
4. Preconditions: Session ist aktiv.
5. Main Flow:
6. Alternate Flows:
7. Postconditions: Session-Datensatz ist final.
8. Data Impact: Update game_sessions.
9. UI Impact: End-Screen zeigt Score und XP.
10. Acceptance Criteria:`;

    const hints = extractFieldHintsFromRaw(raw);

    expect(hints.mainFlowHint).toBeUndefined();
  });

  it('extracts purpose from first substantive line', () => {
    const raw = `### F-03: Get Leaderboard API

Dieser Endpoint gibt die Top-10 Spieler mit hoechsten Scores zurueck.

1. Backend empfaengt GET /api/leaderboard Request.
2. Datenbank-Query sortiert nach Score absteigend, Limit 10.`;

    const hints = extractFieldHintsFromRaw(raw);

    expect(hints.purposeHint).toBeDefined();
    expect(hints.purposeHint).toMatch(/Top-10/);
  });

  it('extracts actors including "Spieler" pattern', () => {
    const raw = `Der Spieler gibt seinen Namen ein und das Backend validiert die Eingabe.`;
    const hints = extractFieldHintsFromRaw(raw);

    expect(hints.actorHint).toBeDefined();
    expect(hints.actorHint).toMatch(/User/);
  });

  it('extracts preconditions from labeled section', () => {
    const raw = `### F-05: Name Validation

**1. Purpose**
Validiert Spielernamen fuer das Leaderboard.

**4. Preconditions**
Der /api/score Endpoint muss erreichbar sein. Der JSON-Body muss ein name-Feld enthalten.

**5. Main Flow**
1. Empfange POST Request.`;

    const hints = extractFieldHintsFromRaw(raw);

    expect(hints.preconditionsHint).toBeDefined();
    expect(hints.preconditionsHint).toMatch(/Endpoint/i);
  });

  it('returns empty for short/missing rawContent', () => {
    expect(extractFieldHintsFromRaw('')).toEqual({});
    expect(extractFieldHintsFromRaw('too short')).toEqual({});
  });

  it('extracts dataImpact when database-related content is present', () => {
    const raw = `### F-02: Database Schema

**8. Data Impact**
Die scores-Tabelle wird initial erstellt und bei jedem Spielende um einen Eintrag erweitert.`;

    const hints = extractFieldHintsFromRaw(raw);

    expect(hints.dataImpactHint).toBeDefined();
    expect(hints.dataImpactHint).toMatch(/scores/);
  });

  it('extracts uiImpact when display-related content is present', () => {
    const raw = `### F-10: Leaderboard Display

**9. UI Impact**
Die Leaderboard-Komponente zeigt eine sortierte Liste der Top-10 Spieler mit Name und Score.`;

    const hints = extractFieldHintsFromRaw(raw);

    expect(hints.uiImpactHint).toBeDefined();
    expect(hints.uiImpactHint).toMatch(/Leaderboard/);
  });
});

describe('ensurePrdFeatureDepth', () => {
  function makeStructure(features: Partial<PRDStructure['features'][0]>[]): PRDStructure {
    return {
      systemVision: 'Test vision',
      systemBoundaries: 'Test boundaries',
      domainModel: 'Test model',
      globalBusinessRules: 'Test rules',
      features: features.map((f, i) => ({
        id: f.id || `F-${String(i + 1).padStart(2, '0')}`,
        name: f.name || `Feature ${i + 1}`,
        rawContent: f.rawContent || '',
        ...f,
      })) as any,
      nonFunctional: 'Test NFRs',
      errorHandling: 'Test error handling',
      deployment: 'Test deployment',
      definitionOfDone: 'Test DoD',
      outOfScope: 'Test out of scope',
      successCriteria: 'Test success',
      timelineMilestones: 'Test timeline',
      otherSections: {},
    };
  }

  it('prefers rawContent mainFlow steps over generic template', () => {
    const structure = makeStructure([{
      id: 'F-01',
      name: 'Database Setup',
      rawContent: `### F-01: Database Setup

**1. Purpose**
Initialisiere die SQLite-Datenbank.

**5. Main Flow**
1. Erstelle Datenbankdatei im Projektverzeichnis.
2. Fuehre Migrationsscript aus.
3. Validiere Schema-Erstellung.`,
    }]);

    const result = ensurePrdFeatureDepth(structure, 'de');
    const feature = result.structure.features[0];

    // mainFlow should be from rawContent, not generic template
    expect(feature.mainFlow).toBeDefined();
    expect(feature.mainFlow!.length).toBe(3);
    expect(feature.mainFlow![0]).toMatch(/Datenbankdatei/);
    // Should NOT be the generic template text
    expect(feature.mainFlow![0]).not.toMatch(/System nimmt die Anfrage/);
  });

  it('provides minimal name-derived scaffolds when rawContent has no extractable hints', () => {
    const structure = makeStructure([{
      id: 'F-01',
      name: 'Test Feature',
      rawContent: 'F-01: Test Feature',  // Too short for meaningful extraction
    }]);

    const result = ensurePrdFeatureDepth(structure, 'en');
    const feature = result.structure.features[0];

    // Critical fields get minimal name-derived scaffolds as safety net
    expect(feature.purpose).toBe('Test Feature provides the described functionality.');
    expect(feature.mainFlow).toEqual([
      'User initiates Test Feature.',
      'System executes Test Feature.',
      'Result is displayed.',
    ]);
    expect(feature.acceptanceCriteria).toEqual([
      'Test Feature completes successfully with valid input.',
      'Invalid input or execution failures in Test Feature produce clear feedback without leaving inconsistent state.',
    ]);
  });

  it('uses parsed subsection fields and falls back cleanly when recursive outline blocks provide no real mainFlow', () => {
    const structure = makeStructure([{
      id: 'F-11',
      name: 'Game Session End Recording',
      rawContent: `### F-11: Game Session End Recording

1. Purpose: Persistiert das Ergebnis einer beendeten Spiel-Session und löst nachgelagerte Prozesse aus.
2. Actors: Frontend-Engine, Session-Service, XP-Service.
3. Trigger: Spiel-Engine sendet POST /api/sessions/{sessionId}/end mit Score.
4. Preconditions: Session ist aktiv, Score ist berechnet.
5. Main Flow:
6. Alternate Flows:
7. Postconditions: Session-Datensatz ist final und XP ist aktualisiert.
8. Data Impact: Update game_sessions, Update users.
9. UI Impact: End-Screen zeigt Score, XP-Gewinn und Rang.
10. Acceptance Criteria:`,
    }]);

    const result = ensurePrdFeatureDepth(structure, 'de');
    const feature = result.structure.features[0];

    expect(feature.purpose).toContain('Persistiert das Ergebnis');
    expect(feature.actors).toBe('Frontend-Engine, Session-Service, XP-Service.');
    expect(feature.trigger).toContain('POST /api/sessions');
    expect(feature.preconditions).toContain('Session ist aktiv');
    expect(feature.postconditions).toContain('Session-Datensatz ist final');
    expect(feature.dataImpact).toContain('game_sessions');
    expect(feature.uiImpact).toContain('End-Screen zeigt Score');
    expect(feature.mainFlow).toEqual([
      'Nutzer initiiert Game Session End Recording.',
      'System führt Game Session End Recording aus.',
      'Ergebnis wird angezeigt.',
    ]);
    expect(feature.acceptanceCriteria).toEqual([
      'Game Session End Recording kann mit gültigen Eingaben erfolgreich ausgeführt werden.',
      'Ungültige Eingaben oder Ausführungsfehler bei Game Session End Recording erzeugen verständliches Feedback ohne inkonsistenten Zustand.',
    ]);
  });

  it('does not overwrite existing feature field values', () => {
    const structure = makeStructure([{
      id: 'F-01',
      name: 'Auth',
      purpose: 'Authenticate users via OAuth2.',
      mainFlow: ['User clicks login', 'System redirects to OAuth provider'],
      rawContent: '### F-01: Auth\n\nSome raw content about authentication.',
    }]);

    const result = ensurePrdFeatureDepth(structure, 'en');
    const feature = result.structure.features[0];

    // Existing values should be preserved
    expect(feature.purpose).toBe('Authenticate users via OAuth2.');
    expect(feature.mainFlow).toEqual(['User clicks login', 'System redirects to OAuth provider']);
  });

  it('extracts preconditions from rawContent instead of using generic template', () => {
    const structure = makeStructure([{
      id: 'F-01',
      name: 'Score Submit',
      rawContent: `### F-01: Score Submit

**1. Purpose**
Spieler kann seinen Score einreichen.

**4. Preconditions**
Der Spieler hat mindestens eine Runde gespielt und einen gueltigen Score erzielt.

**5. Main Flow**
1. Spieler klickt auf Score speichern.
2. System validiert den Score-Wert.`,
    }]);

    const result = ensurePrdFeatureDepth(structure, 'de');
    const feature = result.structure.features[0];

    expect(feature.preconditions).toMatch(/Runde gespielt/);
    // Should NOT be generic template
    expect(feature.preconditions).not.toMatch(/benoetigten Eingaben/i);
  });
});

describe('validatePrdStructure feature completeness signals', () => {
  function makeValidStructure(features: Partial<PRDStructure['features'][0]>[]): PRDStructure {
    return {
      systemVision: 'A comprehensive project management tool for agile teams with sprint tracking and reporting.',
      systemBoundaries: 'Web application deployed on Vercel with PostgreSQL backend and WebSocket real-time updates.',
      domainModel: 'Core entities: Project, Task, User, Sprint with defined relationships and lifecycle states.',
      globalBusinessRules: 'Each Task must have exactly one assignee. Sprint duration fixed at 2 weeks with no overlap.',
      features: features.map((f, i) => ({
        id: f.id || `F-${String(i + 1).padStart(2, '0')}`,
        name: f.name || `Feature ${i + 1}`,
        rawContent: f.rawContent || `### F-${String(i + 1).padStart(2, '0')}: Feature ${i + 1}\n\nDetailed description of feature ${i + 1} with multiple lines.\n\n1. Step one of the feature flow.\n2. Step two continues the workflow.`,
        ...f,
      })) as any,
      nonFunctional: 'Page load time under 2 seconds for all routes. API response p95 under 200ms on standard hardware.',
      errorHandling: 'All API errors return structured JSON with error code, message and timestamp for debugging.',
      deployment: 'Next.js on Vercel with PostgreSQL on Supabase and Redis for session management and caching.',
      definitionOfDone: 'All acceptance criteria pass, code review approved by 2 members, unit test coverage above 80%.',
      outOfScope: 'Mobile native apps and offline mode are not included in this version of the product delivery.',
      successCriteria: 'User adoption: 100 active teams within 3 months with average session duration over 15 minutes.',
      timelineMilestones: 'Phase 1 (Week 1-4): Core task management. Phase 2 (Week 5-8): Sprint planning and analytics.',
      otherSections: {},
    };
  }

  it('reports feature_specs_incomplete for features with 1-4 filled fields', () => {
    const structure = makeValidStructure([
      {
        id: 'F-01', name: 'Well Specified',
        purpose: 'Manage user tasks.',
        actors: 'End user, admin',
        trigger: 'User creates a task',
        preconditions: 'User is logged in',
        mainFlow: ['Create task', 'Assign to user', 'Track progress'],
        acceptanceCriteria: ['Task can be created', 'Task appears in list'],
      },
      {
        id: 'F-02', name: 'Sparse Feature',
        purpose: 'Some purpose.',
        actors: 'End user',
        // Only 2 fields filled — should be flagged as incomplete
      },
    ]);

    const content = `## System Vision\n${structure.systemVision}\n## Features\n### F-01: Well Specified\n### F-02: Sparse Feature`;
    const quality = validatePrdStructure(structure, content);

    const incomplete = quality.issues.filter(i => i.code === 'feature_specs_incomplete');
    expect(incomplete.length).toBe(1);
    expect(incomplete[0].message).toContain('F-02');
    expect(incomplete[0].message).toContain('2/10');
    expect(incomplete[0].severity).toBe('warning');
  });

  it('does not report incomplete for features with 5+ filled fields', () => {
    const structure = makeValidStructure([
      {
        id: 'F-01', name: 'Adequate Feature',
        purpose: 'Manage tasks.',
        actors: 'End user',
        trigger: 'Click create',
        preconditions: 'Logged in',
        mainFlow: ['Step 1', 'Step 2'],
        // 5 fields filled — should NOT be flagged
      },
    ]);

    const content = `## System Vision\n${structure.systemVision}`;
    const quality = validatePrdStructure(structure, content);

    const incomplete = quality.issues.filter(i => i.code === 'feature_specs_incomplete');
    expect(incomplete).toHaveLength(0);
  });

  it('reports feature_content_shallow for features with name-echo boilerplate', () => {
    // All 4 features have fields filled but content is trivially thin / name-echo
    const structure = makeValidStructure([
      {
        id: 'F-01', name: 'Split-View Map Rendering Engine',
        purpose: 'Bereitstellung des geteilten Kartendarstellungs-Engines.',
        actors: 'Spieler',
        trigger: 'Spielstart',
        preconditions: 'Keine.',
        mainFlow: ['Anzeige der geteilten Karte.'],
        alternateFlows: ['Keine.'],
        postconditions: 'Geteilte Karte ist angezeigt.',
        dataImpact: 'Keine.',
        uiImpact: 'Geteilte Karte ist sichtbar.',
        acceptanceCriteria: ['Geteilte Karte ist korrekt angezeigt.'],
      },
      {
        id: 'F-02', name: 'Scoring Algorithm Implementation',
        purpose: 'Implementierung des Punktesystems.',
        actors: 'Spieler',
        trigger: 'Spielstart',
        preconditions: 'Keine.',
        mainFlow: ['Berechnung von Punkten.'],
        alternateFlows: ['Keine.'],
        postconditions: 'Punkte sind berechnet.',
        dataImpact: 'Punkte gespeichert.',
        uiImpact: 'Keine.',
        acceptanceCriteria: ['Punkte sind korrekt berechnet.'],
      },
      {
        id: 'F-03', name: 'Game Summary Dashboard',
        purpose: 'Bereitstellung des Spielzusammenfassungsdashboards.',
        actors: 'Spieler',
        trigger: 'Spielende.',
        preconditions: 'Keine.',
        mainFlow: ['Anzeige des Dashboards.'],
        alternateFlows: ['Keine.'],
        postconditions: 'Dashboard ist angezeigt.',
        dataImpact: 'Keine.',
        uiImpact: 'Dashboard ist sichtbar.',
        acceptanceCriteria: ['Dashboard ist korrekt angezeigt.'],
      },
      {
        id: 'F-04', name: 'Leaderboard Retrieval API',
        purpose: 'Bereitstellung des API-Endpunkts fuer die Leaderboard-Abfrage.',
        actors: 'Spieler',
        trigger: 'Spielstart',
        preconditions: 'Keine.',
        mainFlow: ['Abfrage des Leaderboards.'],
        alternateFlows: ['Keine.'],
        postconditions: 'Leaderboard ist abgefragt.',
        dataImpact: 'Keine.',
        uiImpact: 'Keine.',
        acceptanceCriteria: ['Leaderboard ist korrekt abgefragt.'],
      },
    ]);

    const content = `## System Vision\n${structure.systemVision}`;
    const quality = validatePrdStructure(structure, content);

    const shallow = quality.issues.filter(i => i.code === 'feature_content_shallow');
    expect(shallow.length).toBeGreaterThan(0);
    expect(shallow[0].message).toContain('shallow');
  });

  it('does NOT report shallow for well-specified features', () => {
    const structure = makeValidStructure([
      {
        id: 'F-01', name: 'User Authentication',
        purpose: 'Authenticate users via OAuth2 for secure access to the application platform.',
        actors: 'End user, OAuth2 provider (Google, GitHub)',
        trigger: 'User clicks "Sign In" button on the landing page.',
        preconditions: 'OAuth2 provider is reachable and configured in environment.',
        mainFlow: [
          'User clicks Sign In button on landing page',
          'System redirects to OAuth provider authorization page',
          'Provider returns auth token after user consent',
          'System creates session and redirects to dashboard',
        ],
        alternateFlows: ['Invalid token: system shows error and redirects to login'],
        postconditions: 'User has active session with valid auth token stored.',
        dataImpact: 'Creates User entity and Session record in database.',
        uiImpact: 'Dashboard component renders after successful authentication.',
        acceptanceCriteria: [
          'User can sign in via Google OAuth within 3 seconds',
          'Invalid tokens are rejected with 401 Unauthorized',
          'Session persists across page reloads for 24 hours',
        ],
      },
    ]);

    const content = `## System Vision\n${structure.systemVision}`;
    const quality = validatePrdStructure(structure, content);

    const shallow = quality.issues.filter(i => i.code === 'feature_content_shallow');
    expect(shallow).toHaveLength(0);
  });
});
