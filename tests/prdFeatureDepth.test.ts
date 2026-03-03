import { describe, it, expect } from 'vitest';
import { extractFieldHintsFromRaw, ensurePrdFeatureDepth } from '../server/prdCompiler';
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

  it('falls back to template when rawContent has no extractable hints', () => {
    const structure = makeStructure([{
      id: 'F-01',
      name: 'Test Feature',
      rawContent: 'F-01: Test Feature',  // Too short for meaningful extraction
    }]);

    const result = ensurePrdFeatureDepth(structure, 'en');
    const feature = result.structure.features[0];

    // Should have template-generated content (non-empty)
    expect(feature.mainFlow).toBeDefined();
    expect(feature.mainFlow!.length).toBeGreaterThan(0);
    expect(feature.purpose).toBeDefined();
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
