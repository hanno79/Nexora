/**
 * Author: rahn
 * Datum: 07.03.2026
 * Version: 1.0
 * Beschreibung: Gezielte Tests für semantische Feature-Prüfung im PRD Content Reviewer
 */

// ÄNDERUNG 07.03.2026: Regressionstests für semantisch falsch gemappte Features ergänzt
// Prüft Placeholder-Erkennung und forciertes Überschreiben falscher Feature-Inhalte
// ÄNDERUNG 07.03.2026: Reale Session-/MFA-/Audit-Fehlfamilien und Login-Falschpositiv abgesichert
// ÄNDERUNG 07.03.2026: Generische MFA-Bezeichnungen mit Enrollment-Flow gegen Falschpositiv abgesichert

/// <reference types="vitest" />
import { describe, expect, it, vi } from 'vitest';
import { assembleStructureToMarkdown } from '../server/prdAssembler';
import {
  analyzeContentQuality,
  applyTargetedContentRefinement,
  reviewAndRefineContent,
} from '../server/prdContentReviewer';
import type { PRDStructure } from '../server/prdStructure';

function makeStructure(featureOverrides: PRDStructure['features']): PRDStructure {
  return {
    features: featureOverrides,
    otherSections: {},
    systemVision: 'Die Plattform sichert Benutzeridentitäten mit Login, Passwort-Reset, MFA und Audit-Logging.',
    systemBoundaries: 'Web-Anwendung mit API und PostgreSQL.',
    domainModel: 'Entitäten: User, Session, PasswordResetToken, MFAFactor, AuditLogEntry.',
    globalBusinessRules: 'Jeder Zugriff wird protokolliert und sicher validiert.',
    nonFunctional: 'Antwortzeiten unter 2 Sekunden.',
    errorHandling: 'Fehler werden strukturiert geloggt.',
    deployment: 'Containerisierte Bereitstellung.',
    definitionOfDone: 'Akzeptanzkriterien müssen erfüllt sein.',
    outOfScope: 'Keine Social-Login-Provider in v1.',
    timelineMilestones: 'Phase 1 Login, Phase 2 MFA, Phase 3 Audit.',
    successCriteria: 'Login-Quote und Audit-Abdeckung sind messbar.',
  };
}

describe('prdContentReviewer Semantik', () => {
  it('erkennt semantisch falsch gemappte Features', () => {
    const structure = makeStructure([
      {
        id: 'F-01',
        name: 'EmailPasswordLogin',
        rawContent: 'Registrierungsfluss mit Verifizierungs-E-Mail.',
        purpose: 'Legt ein neues Benutzerkonto an und versendet eine Verifizierungs-E-Mail.',
        actors: 'Nicht authentifizierter Benutzer, E-Mail-Dienst',
        trigger: 'POST /register mit E-Mail und Passwort',
        preconditions: 'E-Mail ist noch nicht registriert und der Mailversand ist verfügbar.',
        mainFlow: ['Benutzer sendet Registrierungsdaten', 'System legt Benutzerkonto an', 'System versendet Verifizierungs-E-Mail'],
        alternateFlows: ['E-Mail bereits vergeben'],
        postconditions: 'Benutzerkonto ist unbestätigt angelegt.',
        dataImpact: 'Users-Tabelle erhält neuen Datensatz mit verification_status.',
        uiImpact: 'Registrierungsformular zeigt Bestätigung zum Mailversand.',
        acceptanceCriteria: ['Registrierung erzeugt neues Konto', 'Verifizierungs-Link ist 24 Stunden gültig'],
      },
    ]);

    const result = analyzeContentQuality(structure, { templateCategory: 'feature' });
    const mismatch = result.issues.find(issue => issue.code === 'feature_semantic_mismatch');

    expect(mismatch).toBeDefined();
    expect(mismatch?.sectionKey).toBe('feature:F-01');
    expect(mismatch?.message).toMatch(/Rewrite:/);
  });

  it('erkennt Placeholder in Feature-Feldern', () => {
    const structure = makeStructure([
      {
        id: 'F-12',
        name: 'AdminAuditLogRetrieval',
        rawContent: 'Abruf von Audit-Logs.',
        purpose: 'Administratoren können Audit-Logs gefiltert abrufen.',
        dataImpact: '(STRUCTURE PLACEHOLDER – TO BE FILLED BY SECTION REPAIR)',
      },
    ]);

    const result = analyzeContentQuality(structure, { templateCategory: 'feature' });
    const placeholder = result.issues.find(issue => issue.code === 'feature_placeholder_content');

    expect(placeholder).toBeDefined();
    expect(placeholder?.message).toContain('dataImpact');
  });

  it('erkennt Session-Feature mit MFA-Enrollment-Inhalt als semantischen Mismatch', () => {
    const structure = makeStructure([
      {
        id: 'F-06',
        name: 'SessionManagement',
        rawContent: 'MFA-Enrollment mit TOTP-Secret, QR-Code und Recovery-Codes.',
        purpose: 'Generiert ein TOTP-Secret und Recovery-Codes für die MFA-Einrichtung.',
        actors: 'Endbenutzer, Authentifizierungsdienst',
        trigger: 'Benutzer startet MFA-Setup in den Kontoeinstellungen.',
        preconditions: 'Benutzer ist authentifiziert und noch nicht für MFA eingeschrieben.',
        mainFlow: ['System erzeugt TOTP-Secret', 'System zeigt QR-Code', 'System speichert Recovery-Codes'],
        postconditions: 'MFA ist aktiviert und Recovery-Codes sind gespeichert.',
        dataImpact: 'MFA-Datensatz wird mit Secret und Recovery-Codes persistiert.',
        uiImpact: 'UI zeigt QR-Code und Recovery-Codes an.',
        acceptanceCriteria: ['QR-Code wird angezeigt', 'Recovery-Codes werden erzeugt'],
      },
    ]);

    const result = analyzeContentQuality(structure, { templateCategory: 'feature' });
    const mismatch = result.issues.find(issue => issue.code === 'feature_semantic_mismatch');

    expect(mismatch?.sectionKey).toBe('feature:F-06');
    expect(mismatch?.message).toContain('MFA enrollment');
  });

  it('erkennt Audit-Feature mit MFA-Verifikations-Inhalt als semantischen Mismatch', () => {
    const structure = makeStructure([
      {
        id: 'F-07',
        name: 'AdminAuditLog',
        rawContent: 'TOTP-Verifikation mit Vergleich des eingegebenen Codes gegen das aktuelle Zeitfenster.',
        purpose: 'Prüft einen vom Benutzer eingegebenen TOTP-Code und gibt bei Erfolg eine Sitzung frei.',
        actors: 'Endbenutzer, Authentifizierungsdienst, Authenticator-App',
        trigger: 'Benutzer sendet einen Verifizierungscode nach dem Login.',
        preconditions: 'TOTP-Secret ist hinterlegt und das Zeitfenster ist gültig.',
        mainFlow: ['System liest das TOTP-Secret', 'System vergleicht den submitted code timingsicher', 'System erteilt die Sitzung'],
        postconditions: 'Verifikationsversuch ist abgeschlossen und die Sitzung ist authentifiziert.',
        dataImpact: 'Audit-Log erhält MFA_VERIFICATION-Eintrag mit Ergebnis.',
        uiImpact: 'Login-Maske zeigt Eingabefeld für Verifizierungscode.',
        acceptanceCriteria: ['Gültiger Code wird akzeptiert', 'Ungültiger Code wird abgewiesen'],
      },
    ]);

    const result = analyzeContentQuality(structure, { templateCategory: 'feature' });
    const mismatch = result.issues.find(issue => issue.code === 'feature_semantic_mismatch');

    expect(mismatch?.sectionKey).toBe('feature:F-07');
    expect(mismatch?.message).toContain('MFA verification');
  });

  it('erkennt Passwordless-Magic-Link-Feature mit Session-Ablauf-Inhalt als semantischen Mismatch', () => {
    const structure = makeStructure([
      {
        id: 'F-09',
        name: 'PasswordlessMagicLinks',
        rawContent: 'Verwaltet Session-Ablauf, TTL und Expiration-Status.',
        purpose: 'Überwacht aktive Sessions und markiert sie nach Ablauf als expired.',
        actors: 'Benutzer, Authentifizierungsserver, Session Store',
        trigger: 'Ablaufprüfung oder Session-Erneuerung wird ausgeführt.',
        preconditions: 'Session identifier und expires_at liegen im Session Store vor.',
        mainFlow: ['System lädt Session', 'System prüft expires_at', 'System markiert Session als expired'],
        postconditions: 'Session ist abgelaufen oder verlängert.',
        dataImpact: 'Session-Datensatz wird aktualisiert und im active sessions index entfernt.',
        uiImpact: 'UI zeigt Session expired und leitet zum Login um.',
        acceptanceCriteria: ['Abgelaufene Sessions werden entfernt', 'Audit-Ereignis wird protokolliert'],
      },
    ]);

    const result = analyzeContentQuality(structure, { templateCategory: 'feature' });
    const mismatch = result.issues.find(issue => issue.code === 'feature_semantic_mismatch');

    expect(mismatch?.sectionKey).toBe('feature:F-09');
    expect(mismatch?.message).toContain('session management');
  });

  it('meldet Authentication Event Logging nicht fälschlich als Login-Mismatch', () => {
    const structure = makeStructure([
      {
        id: 'F-11',
        name: 'AuthenticationEventLogging',
        rawContent: 'Schreibt Audit-Ereignisse unveränderlich in das Protokoll.',
        purpose: 'Erfasst Authentifizierungsereignisse für Audit und Monitoring.',
        actors: 'Authentifizierungsdienst, Administrator',
        trigger: 'Ein Login-, MFA- oder Reset-Ereignis tritt auf.',
        preconditions: 'Audit-Store ist schreibbar und Zeitquelle ist synchronisiert.',
        mainFlow: ['System sammelt Ereignisdaten', 'System schreibt Audit-Log', 'System bestätigt die Protokollierung'],
        postconditions: 'Unveränderlicher Audit-Eintrag ist gespeichert.',
        dataImpact: 'Audit-Store erhält neue Einträge und Indizes für Filter.',
        uiImpact: 'Audit-Ansicht kann Ereignisse filtern und exportieren.',
        acceptanceCriteria: ['Pflichtfelder sind vorhanden', 'Logs bleiben unveränderlich'],
      },
    ]);

    const result = analyzeContentQuality(structure, { templateCategory: 'feature' });
    const mismatch = result.issues.find(issue => issue.code === 'feature_semantic_mismatch');

    expect(mismatch).toBeUndefined();
  });

  it('meldet generisches TOTP-MFA-Feature mit Enrollment-Flow nicht fälschlich als Verifikations-Mismatch', () => {
    const structure = makeStructure([
      {
        id: 'F-03',
        name: 'Multi-Factor Authentication using TOTP',
        rawContent: 'Aktiviert MFA per TOTP mit QR-Code, Secret und abschließender Code-Prüfung.',
        purpose: 'Benutzer aktivieren TOTP-basiertes MFA und verifizieren die Einrichtung mit einem gültigen Code.',
        actors: 'Endbenutzer, Authentifizierungsdienst, Authenticator-App',
        trigger: 'Benutzer startet MFA in der Kontoverwaltung.',
        preconditions: 'Benutzer ist angemeldet und besitzt noch kein eingerichtetes TOTP-Merkmal.',
        mainFlow: ['System erzeugt TOTP-Secret', 'System zeigt QR-Code', 'Benutzer scannt QR-Code', 'System prüft den eingegebenen TOTP-Code und aktiviert MFA'],
        postconditions: 'MFA ist aktiviert und zukünftige Logins verlangen einen TOTP-Code.',
        dataImpact: 'Benutzerprofil speichert TOTP-Secret und MFA-Status.',
        uiImpact: 'Kontoverwaltung zeigt QR-Code, Eingabefeld und Erfolgsmeldung.',
        acceptanceCriteria: ['Gültiger TOTP-Code aktiviert MFA', 'Ungültiger Code zeigt verständliche Fehlermeldung'],
      },
    ]);

    const result = analyzeContentQuality(structure, { templateCategory: 'feature' });
    const mismatch = result.issues.find(issue => issue.code === 'feature_semantic_mismatch');

    expect(mismatch).toBeUndefined();
  });

  it('überschreibt gezielt semantisch falsche Feature-Felder bei der Verfeinerung', async () => {
    const structure = makeStructure([
      {
        id: 'F-01',
        name: 'EmailPasswordLogin',
        rawContent: 'Registrierungsfluss mit Verifizierungs-E-Mail.',
        purpose: 'Legt ein neues Benutzerkonto an und versendet eine Verifizierungs-E-Mail.',
        trigger: 'POST /register mit E-Mail und Passwort',
        mainFlow: ['Benutzer sendet Registrierungsdaten', 'System legt Benutzerkonto an', 'System versendet Verifizierungs-E-Mail'],
        acceptanceCriteria: ['Registrierung erzeugt neues Konto'],
      },
    ]);

    const reviewer = vi.fn(async () => ({
      content: `=== F-01: EmailPasswordLogin ===
**purpose**: Authentifiziert bestehende Benutzer mit E-Mail und Passwort und startet eine gültige Sitzung.
**actors**: Endbenutzer, Authentifizierungsdienst
**trigger**: POST /login mit E-Mail und Passwort
**preconditions**: Benutzerkonto ist verifiziert und aktiv.
**mainFlow**:
1. Benutzer sendet gültige Zugangsdaten.
2. System prüft E-Mail und Passwort.
3. System erstellt eine Session und setzt ein sicheres Cookie.
**alternateFlows**:
1. Ungültige Zugangsdaten führen zu HTTP 401.
**postconditions**: Eine aktive Sitzung ist erstellt.
**dataImpact**: Sessions werden erstellt und Login-Events geloggt.
**uiImpact**: Login-Formular zeigt Erfolg oder Fehlermeldung.
**acceptanceCriteria**:
- [ ] Gültige Zugangsdaten führen zu einer aktiven Sitzung.
- [ ] Ungültige Zugangsdaten liefern eine verständliche Fehlermeldung.`,
      model: 'mock/refine',
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));

    const result = await reviewAndRefineContent({
      content: assembleStructureToMarkdown(structure),
      structure,
      language: 'de',
      templateCategory: 'feature',
      reviewer,
    });

    const feature = result.structure.features[0];
    expect(reviewer).toHaveBeenCalledTimes(1);
    expect(result.refined).toBe(true);
    expect(result.enrichedFeatureCount).toBeGreaterThan(0);
    expect(feature.purpose).toMatch(/Authentifiziert bestehende Benutzer/);
    expect(feature.trigger).toContain('/login');
    expect(feature.acceptanceCriteria).toHaveLength(2);
  });

  it('wendet bei Feature-Repair nur explizit freigegebene Zielfelder an', async () => {
    const structure = makeStructure([
      {
        id: 'F-01',
        name: 'EmailPasswordLogin',
        rawContent: 'Login mit E-Mail und Passwort.',
        purpose: 'Authentifiziert bestehende Benutzer mit E-Mail und Passwort.',
        acceptanceCriteria: ['Veraltetes Kriterium bleibt nicht bestehen.'],
      },
    ]);

    const originalPurpose = structure.features[0].purpose;
    const reviewer = vi.fn(async (prompt: string) => {
      expect(prompt).toContain('Target fields: acceptanceCriteria');
      return {
        content: `=== F-01: EmailPasswordLogin ===
**purpose**: Unerlaubte Aenderung an einem nicht freigegebenen Feld.
**acceptanceCriteria**:
- [ ] Gueltige Zugangsdaten erzeugen eine aktive Sitzung.
- [ ] Ungueltige Zugangsdaten liefern HTTP 401 mit Fehlermeldung.`,
        model: 'mock/refine',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
    });

    const result = await applyTargetedContentRefinement({
      content: assembleStructureToMarkdown(structure),
      structure,
      issues: [{
        code: 'feature_semantic_mismatch',
        sectionKey: 'feature:F-01',
        message: 'Acceptance criteria no longer match the login flow. Rewrite: acceptanceCriteria',
        severity: 'error',
        suggestedAction: 'rewrite',
        targetFields: ['acceptanceCriteria'],
      }],
      language: 'de',
      reviewer,
    });

    expect(reviewer).toHaveBeenCalledTimes(1);
    expect(result.refined).toBe(true);
    expect(result.enrichedFeatureCount).toBe(1);
    expect(result.structure.features[0].purpose).toBe(originalPurpose);
    expect(result.structure.features[0].acceptanceCriteria).toEqual([
      'Gueltige Zugangsdaten erzeugen eine aktive Sitzung.',
      'Ungueltige Zugangsdaten liefern HTTP 401 mit Fehlermeldung.',
    ]);
  });

  it('lehnt Section-Rewrites ab, wenn dabei strukturierte Features mitveraendert werden', async () => {
    const structure = makeStructure([
      {
        id: 'F-01',
        name: 'EmailPasswordLogin',
        rawContent: 'Login mit E-Mail und Passwort.',
        purpose: 'Authentifiziert bestehende Benutzer.',
        acceptanceCriteria: ['Login funktioniert.'],
      },
    ]);

    const reviewer = vi.fn(async () => ({
      content: assembleStructureToMarkdown({
        ...structure,
        definitionOfDone: 'Release nur nach dokumentiertem Login-Test, QA-Freigabe und Monitoring-Check.',
        features: [
          {
            ...structure.features[0],
            purpose: 'Unerlaubte Aenderung am Feature waehrend eines Section-Rewrites.',
          },
        ],
      }),
      model: 'mock/reviewer',
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));

    const result = await applyTargetedContentRefinement({
      content: assembleStructureToMarkdown(structure),
      structure,
      issues: [{
        code: 'definition_fix',
        sectionKey: 'definitionOfDone',
        message: 'Definition of Done needs a concrete checklist.',
        severity: 'error',
        suggestedAction: 'rewrite',
      }],
      language: 'de',
      reviewer,
    });

    expect(reviewer).toHaveBeenCalledTimes(1);
    expect(result.refined).toBe(false);
    expect(result.structure.definitionOfDone).toBe(structure.definitionOfDone);
    expect(result.structure.features[0].purpose).toBe(structure.features[0].purpose);
  });

  it('lehnt Section-Rewrites ab, wenn Raw-Only-Features veraendert werden', async () => {
    const structure = makeStructure([
      {
        id: 'F-05',
        name: 'ProviderListManagement',
        rawContent: [
          '**1. Purpose**',
          '',
          'Liefert eine sortierte Liste verfuegbarer Provider fuer das Widget.',
          '',
          '**10. Acceptance Criteria**',
          '',
          '- Provider-Liste wird im Widget dargestellt.',
        ].join('\n'),
      },
    ]);

    const reviewer = vi.fn(async () => ({
      content: assembleStructureToMarkdown({
        ...structure,
        definitionOfDone: 'Release nur nach dokumentierter API-Pruefung und Smoke-Test.',
        features: [
          {
            ...structure.features[0],
            rawContent: 'Unerlaubte Aenderung am Raw-Only-Feature waehrend eines Section-Rewrites.',
          },
        ],
      }),
      model: 'mock/reviewer',
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));

    const result = await applyTargetedContentRefinement({
      content: assembleStructureToMarkdown(structure),
      structure,
      issues: [{
        code: 'definition_fix',
        sectionKey: 'definitionOfDone',
        message: 'Definition of Done needs a concrete checklist.',
        severity: 'error',
        suggestedAction: 'rewrite',
      }],
      language: 'de',
      reviewer,
    });

    expect(reviewer).toHaveBeenCalledTimes(1);
    expect(result.refined).toBe(false);
    expect(result.structure.definitionOfDone).toBe(structure.definitionOfDone);
    expect(result.structure.features[0].rawContent).toBe(structure.features[0].rawContent);
  });

  it('lehnt targeted refinement ab, wenn unmarkierte Sektionen veraendert werden', async () => {
    const structure = makeStructure([
      {
        id: 'F-01',
        name: 'EmailPasswordLogin',
        rawContent: 'Login mit E-Mail und Passwort.',
        purpose: 'Authentifiziert Benutzer.',
      },
    ]);

    const originalBoundaries = structure.systemBoundaries;
    const reviewer = vi.fn(async () => ({
      content: [
        '## System Vision',
        'Die Plattform sichert Benutzeridentitaeten mit Login, Passwort-Reset, MFA und Audit-Logging.',
        '',
        '## System Boundaries',
        'Unerlaubte Aenderung ausserhalb des freigegebenen Scopes.',
        '',
        '## Domain Model',
        'Entitaeten: User, Session, PasswordResetToken, MFAFactor, AuditLogEntry.',
        '',
        '## Global Business Rules',
        'Jeder Zugriff wird protokolliert und sicher validiert.',
        '',
        '## Functional Feature Catalogue',
        '',
        '### F-01: EmailPasswordLogin',
        '1. Purpose',
        'Authentifiziert Benutzer.',
        '10. Acceptance Criteria',
        '- Login funktioniert.',
        '',
        '## Non-Functional Requirements',
        'Antwortzeiten unter 2 Sekunden.',
        '',
        '## Error Handling & Recovery',
        'Fehler werden strukturiert geloggt.',
        '',
        '## Deployment & Infrastructure',
        'Containerisierte Bereitstellung.',
        '',
        '## Definition of Done',
        '- Release-Checkliste ist abgearbeitet.',
        '',
        '## Out of Scope',
        'Keine Social-Login-Provider in v1.',
        '',
        '## Timeline & Milestones',
        'Phase 1 Login, Phase 2 MFA, Phase 3 Audit.',
        '',
        '## Success Criteria & Acceptance Testing',
        'Login-Quote und Audit-Abdeckung sind messbar.',
      ].join('\n'),
      model: 'mock/reviewer',
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));

    const result = await applyTargetedContentRefinement({
      content: assembleStructureToMarkdown(structure),
      structure,
      issues: [{
        code: 'definition_fix',
        sectionKey: 'definitionOfDone',
        message: 'Definition of Done needs a concrete checklist.',
        severity: 'error',
        suggestedAction: 'rewrite',
      }],
      language: 'de',
      reviewer,
    });

    expect(result.refined).toBe(false);
    expect(result.structure.systemBoundaries).toBe(originalBoundaries);
  });
});
