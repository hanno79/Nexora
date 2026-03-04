/// <reference types="vitest" />
import { compilePrdDocument } from '../server/prdCompiler';

describe('prdTemplateIntent compiler integration', () => {
  it('generates context-specific fallback sections instead of legacy generic boilerplate', () => {
    const raw = [
      '## System Vision',
      'Ein Onboarding-Portal hilft neuen Mitarbeitenden beim strukturierten Einstieg.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Aufgabenliste anzeigen',
      '1. Purpose',
      'Neue Mitarbeitende sehen alle offenen Onboarding-Aufgaben.',
      '10. Acceptance Criteria',
      '- Aufgaben sind ohne manuelles Nachladen sichtbar.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'de',
      templateCategory: 'feature',
      contextHint: 'Employee Onboarding Portal fuer neue Teammitglieder',
    });

    expect(compiled.quality.valid).toBe(true);
    expect(compiled.content).not.toContain(
      'Scope, Laufzeitgrenzen und Integrationen sind fuer diese Version explizit definiert.'
    );
  });

  it('flags legacy generic fallback sections as quality errors in generate mode', () => {
    const raw = [
      '## System Vision',
      'Das Produkt liefert einen klaren Nutzerwert fuer die definierte Zielgruppe und das Zielergebnis.',
      '',
      '## System Boundaries',
      'Scope, Laufzeitgrenzen und Integrationen sind fuer diese Version explizit definiert.',
      '',
      '## Domain Model',
      'Kernentitaeten, Beziehungen und Randbedingungen sind deterministisch beschrieben.',
      '',
      '## Global Business Rules',
      'Globale Regeln definieren Invarianten und Randbedingungen ueber alle Feature-Workflows.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Legacy Boilerplate Detection',
      '1. Purpose',
      'Detect and reject legacy generic section content.',
      '10. Acceptance Criteria',
      '- Generic fallback sections are no longer accepted as final output.',
      '',
      '## Non-Functional Requirements',
      'Performance-, Zuverlaessigkeits-, Sicherheits- und Accessibility-Anforderungen sind explizit dokumentiert.',
      '',
      '## Error Handling & Recovery',
      'Fehlerbehandlung, Recovery-Verhalten und Fallback-Erwartungen sind dokumentiert.',
      '',
      '## Deployment & Infrastructure',
      'Laufzeitumgebung, Deployment-Ansatz und operative Abhaengigkeiten sind beschrieben.',
      '',
      '## Definition of Done',
      'Der Release ist erst abgeschlossen, wenn alle Pflichtabschnitte und Akzeptanzkriterien erfuellt sind.',
      '',
      '## Out of Scope',
      'Elemente ausserhalb dieses Releases sind explizit gelistet, um Scope Creep zu vermeiden.',
      '',
      '## Timeline & Milestones',
      'Meilensteine und Lieferphasen sind mit realistischen Checkpoints definiert.',
      '',
      '## Success Criteria & Acceptance Testing',
      'Erfolgskriterien und Abnahmeindikatoren sind messbar und testbar.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'de',
    });

    expect(compiled.quality.valid).toBe(false);
    expect(
      compiled.quality.issues.some(issue => issue.code === 'generic_section_boilerplate_systemBoundaries')
    ).toBe(true);
  });

  it('fails technical template runs when technical semantic signals are missing', () => {
    const raw = [
      '## System Vision',
      'Eine App hilft Nutzern beim Sammeln persoenlicher Gewohnheiten im Alltag.',
      '',
      '## System Boundaries',
      'Die Anwendung deckt Erstellung, Bearbeitung und Anzeige von Gewohnheiten in der UI ab.',
      '',
      '## Domain Model',
      'Benutzer speichern Gewohnheiten, Erledigungen und Notizen in Listenform.',
      '',
      '## Global Business Rules',
      'Jede Gewohnheit kann pro Tag nur einmal als erledigt markiert werden.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Gewohnheit erstellen',
      '1. Purpose',
      'Nutzer legen neue Gewohnheiten mit Titel und Ziel an.',
      '10. Acceptance Criteria',
      '- Neue Gewohnheiten erscheinen sofort in der Uebersicht.',
      '',
      '## Non-Functional Requirements',
      'Die Anwendung soll schnell reagieren und auf mobilen Geraeten gut bedienbar sein.',
      '',
      '## Error Handling & Recovery',
      'Bei Fehlern werden Hinweise angezeigt und der Nutzer kann den Vorgang wiederholen.',
      '',
      '## Deployment & Infrastructure',
      'Die Anwendung wird online bereitgestellt und ist fuer Nutzer immer erreichbar.',
      '',
      '## Definition of Done',
      'Alle beschriebenen Features funktionieren stabil fuer Endnutzer.',
      '',
      '## Out of Scope',
      'Keine Teamfunktionen oder Enterprise-Funktionen in dieser Version.',
      '',
      '## Timeline & Milestones',
      'Die Umsetzung erfolgt in zwei Iterationen mit anschliessendem Rollout.',
      '',
      '## Success Criteria & Acceptance Testing',
      'Nutzer koennen Gewohnheiten ohne Hilfe anlegen und taeglich aktualisieren.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'de',
      templateCategory: 'technical',
    });

    expect(compiled.quality.valid).toBe(false);
    expect(
      compiled.quality.issues.some(issue => issue.code === 'template_semantic_signal_mismatch_technical')
    ).toBe(true);
  });

  it('accepts technical template runs with architecture and reliability signals', () => {
    const raw = [
      '## System Vision',
      'Das technische PRD definiert die robuste API- und Datenarchitektur fuer einen PRD-Compiler-Service.',
      '',
      '## System Boundaries',
      'Scope umfasst API-Endpunkte, Hintergrundjobs, Persistenz und observability-relevante Betriebsgrenzen.',
      '',
      '## Domain Model',
      'Entitaeten: PRD, Version, Feature, Template und AuditEvent mit relationalen Schluesseln und Migrationspfad.',
      '',
      '## Global Business Rules',
      'Feature-IDs bleiben stabil; Schema-Migrationen sind rueckwaerts-kompatibel und versioniert.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: API-basierte Kompilierung',
      '1. Purpose',
      'Ein API-Endpunkt nimmt Roh-PRDs entgegen und liefert ein kanonisches Ergebnis.',
      '10. Acceptance Criteria',
      '- API validiert Eingaben und schreibt atomar in die Datenbank.',
      '',
      '## Non-Functional Requirements',
      'Performance-Ziel: P95 unter 1.5s, Security via RBAC und Audit-Logging, Reliability mit Retry und Idempotenz.',
      '',
      '## Error Handling & Recovery',
      'Fehlgeschlagene Jobs werden mit Backoff erneut verarbeitet; Monitoring meldet SLA-Verletzungen.',
      '',
      '## Deployment & Infrastructure',
      'Node-Service mit PostgreSQL, Migrationen, Queue-Worker, strukturierter Logs und Health/Readiness-Endpunkten.',
      '',
      '## Definition of Done',
      'Architektur, API-Vertraege, Migrationen, Monitoring und Security-Checks sind implementiert und getestet.',
      '',
      '## Out of Scope',
      'Kein Frontend-Redesign; nur technische Service- und Infrastrukturarbeit.',
      '',
      '## Timeline & Milestones',
      'Phase 1 Architektur-Design, Phase 2 Implementierung, Phase 3 Hardening und Rollout.',
      '',
      '## Success Criteria & Acceptance Testing',
      'Service erreicht definierte Performance-, Reliability- und Security-Kriterien im Staging und Produktionstest.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'de',
      templateCategory: 'technical',
    });

    expect(
      compiled.quality.issues.some(issue => issue.code === 'template_semantic_signal_mismatch_technical')
    ).toBe(false);
  });

  it('accepts epic template runs with phased planning and ownership semantics', () => {
    const raw = [
      '## System Vision',
      'Dieses Epic beschreibt eine mehrphasige Initiative mit klarer Sequenzierung ueber mehrere Workstreams.',
      '',
      '## System Boundaries',
      'Der aktuelle Umfang deckt nur MVP-Workstreams und deren priorisierte Abhaengigkeiten ab.',
      '',
      '## Domain Model',
      'Entitaeten: Epic, Feature, Milestone, Risk, Owner.',
      '',
      '## Global Business Rules',
      'Feature-IDs bleiben stabil und jede Abhaengigkeit besitzt einen verantwortlichen Owner.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Priorisierte Epic-Roadmap erstellen',
      '1. Purpose',
      'Planung der Sequenzierung fuer alle Kern-Features.',
      '10. Acceptance Criteria',
      '- Die Roadmap ist priorisiert und versioniert.',
      '',
      '### F-02: Meilenstein-Management',
      '1. Purpose',
      'Steuerung von Milestones inklusive Abhaengigkeiten.',
      '10. Acceptance Criteria',
      '- Milestones besitzen klare Zieltermine.',
      '',
      '### F-03: Ownership-Tracking',
      '1. Purpose',
      'Jeder Workstream hat einen verantwortlichen Owner.',
      '10. Acceptance Criteria',
      '- Ownership ist fuer alle Workstreams gepflegt.',
      '',
      '### F-04: Risiko- und Blocker-Tracking',
      '1. Purpose',
      'Abhaengigkeiten und Risiken werden frueh eskaliert.',
      '10. Acceptance Criteria',
      '- Kritische Blocker sind transparent.',
      '',
      '### F-05: Stakeholder-Statuskommunikation',
      '1. Purpose',
      'Regelmaessige Synchronisation mit Stakeholdern.',
      '10. Acceptance Criteria',
      '- Statusupdates sind pro Phase dokumentiert.',
      '',
      '## Non-Functional Requirements',
      'Planungsdaten sind auditierbar und in unter 1 Sekunde abrufbar.',
      '',
      '## Error Handling & Recovery',
      'Fehler in Statusupdates werden mit Retry und Audit-Log behandelt.',
      '',
      '## Deployment & Infrastructure',
      'Service laeuft in einer versionierten Container-Umgebung.',
      '',
      '## Definition of Done',
      'Alle Epic-Phasen, Milestones und Ownership-Daten sind vollstaendig.',
      '',
      '## Out of Scope',
      'Keine spaeteren Optimierungs-Streams in dieser Phase.',
      '',
      '## Timeline & Milestones',
      'Phase 1 Discovery, Phase 2 Build, Milestone M1 Abnahme, Milestone M2 Rollout.',
      '',
      '## Success Criteria & Acceptance Testing',
      'Die Epic-Lieferung erreicht alle definierten Milestones mit nachvollziehbarer Ownership.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'de',
      templateCategory: 'epic',
    });

    expect(
      compiled.quality.issues.some(issue => issue.code === 'template_semantic_signal_mismatch_epic')
    ).toBe(false);
  });

  it('fails epic template runs when phased planning and ownership signals are missing', () => {
    const raw = [
      '## System Vision',
      'Eine App soll einfacher zu bedienen sein.',
      '',
      '## System Boundaries',
      'Die Anwendung umfasst Registrierung, Login und Profilverwaltung.',
      '',
      '## Domain Model',
      'Entitaeten: Benutzer, Profil, Einstellungen.',
      '',
      '## Global Business Rules',
      'Nutzerdaten muessen konsistent gespeichert werden.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Registrierung',
      '1. Purpose',
      'Neuen Account anlegen.',
      '10. Acceptance Criteria',
      '- Registrierung erfolgreich.',
      '',
      '### F-02: Login',
      '1. Purpose',
      'Anmeldung durchfuehren.',
      '10. Acceptance Criteria',
      '- Login erfolgreich.',
      '',
      '### F-03: Profil bearbeiten',
      '1. Purpose',
      'Profil aktualisieren.',
      '10. Acceptance Criteria',
      '- Profil gespeichert.',
      '',
      '### F-04: Passwort aendern',
      '1. Purpose',
      'Passwort aktualisieren.',
      '10. Acceptance Criteria',
      '- Passwort geaendert.',
      '',
      '### F-05: Profilbild hochladen',
      '1. Purpose',
      'Profilbild verwalten.',
      '10. Acceptance Criteria',
      '- Profilbild sichtbar.',
      '',
      '## Non-Functional Requirements',
      'Anwendung soll schnell reagieren.',
      '',
      '## Error Handling & Recovery',
      'Fehlermeldungen werden angezeigt.',
      '',
      '## Deployment & Infrastructure',
      'Web-Anwendung in Containerumgebung.',
      '',
      '## Definition of Done',
      'Alle Features funktionieren, sind getestet und das Code-Review wurde abgeschlossen.',
      '',
      '## Out of Scope',
      'Keine mobilen Apps geplant, auch keine Desktop-Variante oder Offline-Betrieb.',
      '',
      '## Timeline & Milestones',
      'Projektstart ist fuer das Fruehjahr vorgesehen, die Entwicklung laeuft ueber den Sommer bis zum Abschluss.',
      '',
      '## Success Criteria & Acceptance Testing',
      'Nutzer verwenden die App regelmaessig und die Kernfunktionen sind ohne Anleitung nutzbar.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'de',
      templateCategory: 'epic',
    });

    expect(compiled.quality.valid).toBe(false);
    expect(
      compiled.quality.issues.some(issue => issue.code === 'template_semantic_signal_mismatch_epic')
    ).toBe(true);
  });

  it('rejects unresolved placeholder content in feature titles', () => {
    const raw = [
      '## System Vision',
      'Produkt-Launch fuer ein neues B2B-Tool mit klaren Markteinfuehrungszielen.',
      '',
      '## System Boundaries',
      'Scope umfasst Launch-Planung, Kampagnensteuerung und Stakeholder-Kommunikation.',
      '',
      '## Domain Model',
      'Entitaeten: LaunchPlan, Kampagne, Kanal, Stakeholder, KPI.',
      '',
      '## Global Business Rules',
      'Jeder Launch besitzt eine versionierte Checkliste mit verbindlichen Go/No-Go-Kriterien.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Kernfunktionalitaet ausfuehren ([Einzigartiger Wertvorschlag])',
      '1. Purpose',
      'Das Team steuert den zentralen Launch-Flow und dokumentiert Entscheidungen.',
      '10. Acceptance Criteria',
      '- Die Go-to-Market-Checkliste ist vollstaendig und nachvollziehbar.',
      '',
      '## Non-Functional Requirements',
      'KPIs sind versioniert, auditiert und in unter 1 Sekunde abrufbar.',
      '',
      '## Error Handling & Recovery',
      'Fehler in Kampagnenupdates werden mit Retry und Audit-Log behandelt.',
      '',
      '## Deployment & Infrastructure',
      'Service laeuft in Container-Umgebung mit observability und Backup-Strategie.',
      '',
      '## Definition of Done',
      'Alle Launch-Phasen sind abgedeckt und Abnahmekriterien erfuellt.',
      '',
      '## Out of Scope',
      'Kein CRM-Redesign in dieser Version.',
      '',
      '## Timeline & Milestones',
      'Phase 1 Planung, Phase 2 Kampagnenstart, Phase 3 Rollout.',
      '',
      '## Success Criteria & Acceptance Testing',
      'Adoption und Conversion-Ziele fuer den Launch werden nachweislich erreicht.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'de',
      templateCategory: 'product-launch',
    });

    expect(compiled.quality.valid).toBe(false);
    expect(
      compiled.quality.issues.some(issue => issue.code === 'placeholder_content_detected')
    ).toBe(true);
  });

  it('rejects product-launch outputs with mostly generic app feature names', () => {
    const raw = [
      '## System Vision',
      'Dieses PRD soll einen Produkt-Launch begleiten.',
      '',
      '## System Boundaries',
      'Scope umfasst die erste Version einer App.',
      '',
      '## Domain Model',
      'Entitaeten: Benutzer, Profil, Einstellung, Theme.',
      '',
      '## Global Business Rules',
      'Benutzerdaten muessen konsistent gespeichert werden.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Benutzerregistrierung',
      '1. Purpose',
      'Nutzerkonto erstellen.',
      '10. Acceptance Criteria',
      '- Registrierung erfolgreich.',
      '',
      '### F-02: Login',
      '1. Purpose',
      'Anmeldung mit E-Mail.',
      '10. Acceptance Criteria',
      '- Login funktioniert.',
      '',
      '### F-03: Profil bearbeiten',
      '1. Purpose',
      'Profil verwalten.',
      '10. Acceptance Criteria',
      '- Profil speichert Aenderungen.',
      '',
      '### F-04: Dark Mode',
      '1. Purpose',
      'Theme umschalten.',
      '10. Acceptance Criteria',
      '- Theme wird gespeichert.',
      '',
      '## Non-Functional Requirements',
      'App soll schnell reagieren.',
      '',
      '## Error Handling & Recovery',
      'Fehler werden angezeigt.',
      '',
      '## Deployment & Infrastructure',
      'App wird als Web-Anwendung deployed.',
      '',
      '## Definition of Done',
      'Features sind umgesetzt.',
      '',
      '## Out of Scope',
      'Keine Enterprise-Funktionen.',
      '',
      '## Timeline & Milestones',
      'Q1 Umsetzung, Q2 Release.',
      '',
      '## Success Criteria & Acceptance Testing',
      'Nutzer verwenden die App regelmaessig.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'de',
      templateCategory: 'product-launch',
    });

    expect(compiled.quality.valid).toBe(false);
    expect(
      compiled.quality.issues.some(issue => issue.code === 'template_semantic_feature_signal_mismatch_product-launch')
    ).toBe(true);
  });

  it('enforces product-launch feature semantics as hard errors in improve mode', () => {
    const existing = [
      '## System Vision',
      'Launch PRD baseline.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Launch Readiness Checklist',
      '1. Purpose',
      'Track launch readiness.',
      '10. Acceptance Criteria',
      '- Go/No-Go checklist is complete.',
    ].join('\n');

    const candidate = [
      '## Functional Feature Catalogue',
      '',
      '### F-01: Benutzerprofil',
      '1. Purpose',
      'Profil bearbeiten.',
      '10. Acceptance Criteria',
      '- Profil kann gespeichert werden.',
      '',
      '### F-02: Dark Mode',
      '1. Purpose',
      'Theme umschalten.',
      '10. Acceptance Criteria',
      '- Theme wird gespeichert.',
      '',
      '### F-03: Avatar Upload',
      '1. Purpose',
      'Avatar verwalten.',
      '10. Acceptance Criteria',
      '- Avatar ist sichtbar.',
      '',
      '### F-04: Chat',
      '1. Purpose',
      'Chatfunktion.',
      '10. Acceptance Criteria',
      '- Chatnachricht wird gesendet.',
    ].join('\n');

    const compiled = compilePrdDocument(candidate, {
      mode: 'improve',
      existingContent: existing,
      language: 'de',
      templateCategory: 'product-launch',
    });

    expect(compiled.quality.valid).toBe(false);
    expect(
      compiled.quality.issues.some(issue => issue.code === 'template_semantic_feature_signal_mismatch_product-launch' && issue.severity === 'error')
    ).toBe(true);
  });

  it('flags feature template scope drift when feature names are structural/meta noise', () => {
    const raw = [
      '## System Vision',
      'A task planning product for teams to execute operational workflows.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: System Vision',
      '1. Purpose',
      'Invalid structural heading as feature name.',
      '10. Acceptance Criteria',
      '- Should be rejected by scope drift checks.',
      '',
      '### F-02: Target Audience',
      '1. Purpose',
      'Invalid structural heading as feature name.',
      '10. Acceptance Criteria',
      '- Should be rejected by scope drift checks.',
      '',
      '### F-03: Review Feedback',
      '1. Purpose',
      'Meta heading leaked into feature name.',
      '10. Acceptance Criteria',
      '- Should be rejected by scope drift checks.',
      '',
      '### F-04: Iteration 3',
      '1. Purpose',
      'Iteration marker leaked into feature name.',
      '10. Acceptance Criteria',
      '- Should be rejected by scope drift checks.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'en',
      templateCategory: 'feature',
    });

    expect(compiled.quality.valid).toBe(false);
    expect(
      compiled.quality.issues.some(issue => issue.code === 'feature_scope_drift_detected')
    ).toBe(true);
  });

  it('accepts coherent feature-template feature names without scope-drift signal', () => {
    const raw = [
      '## System Vision',
      'Task coordination for distributed teams with shared operational workflows.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Task creation workflow',
      '1. Purpose',
      'Users create actionable tasks with owner and due date.',
      '10. Acceptance Criteria',
      '- A created task is visible in the team board immediately.',
      '',
      '### F-02: Task assignment workflow',
      '1. Purpose',
      'Users assign tasks to team members with clear ownership.',
      '10. Acceptance Criteria',
      '- Assignment updates are visible to all collaborators.',
      '',
      '### F-03: Task status update workflow',
      '1. Purpose',
      'Users update in-progress and done states for each task.',
      '10. Acceptance Criteria',
      '- Status changes are persisted and visible without reload.',
      '',
      '### F-04: Task completion workflow',
      '1. Purpose',
      'Users close tasks and capture completion notes.',
      '10. Acceptance Criteria',
      '- Completed tasks are moved into done state with timestamp.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'en',
      templateCategory: 'feature',
    });

    expect(
      compiled.quality.issues.some(issue => issue.code === 'feature_scope_drift_detected')
    ).toBe(false);
  });

  it('aggregates near-duplicate features conservatively without hard feature cap', () => {
    const raw = [
      '## System Vision',
      'Task operations platform with feature-level workflow automation.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Task creation workflow',
      '1. Purpose',
      'Create tasks.',
      '10. Acceptance Criteria',
      '- Task can be created.',
      '',
      '### F-02: Task list management',
      '1. Purpose',
      'Manage task lists.',
      '10. Acceptance Criteria',
      '- Lists can be managed.',
      '',
      '### F-03: Task list management workflow',
      '1. Purpose',
      'Manage task lists with deterministic behavior.',
      '10. Acceptance Criteria',
      '- List updates are persisted.',
      '',
      '### F-04: Task assignment workflow',
      '1. Purpose',
      'Assign tasks.',
      '10. Acceptance Criteria',
      '- Assignment is visible.',
      '',
      '### F-05: Task status update workflow',
      '1. Purpose',
      'Update task status.',
      '10. Acceptance Criteria',
      '- Status is synchronized.',
      '',
      '### F-06: Task completion workflow',
      '1. Purpose',
      'Complete tasks.',
      '10. Acceptance Criteria',
      '- Completion is persisted.',
      '',
      '### F-07: Task archive workflow',
      '1. Purpose',
      'Archive tasks.',
      '10. Acceptance Criteria',
      '- Archive state is visible.',
      '',
      '### F-08: Task export workflow',
      '1. Purpose',
      'Export tasks.',
      '10. Acceptance Criteria',
      '- Export file is generated.',
    ].join('\n');

    const compiled = compilePrdDocument(raw, {
      mode: 'generate',
      language: 'en',
      templateCategory: 'feature',
    });

    expect(compiled.structure.features.length).toBeGreaterThanOrEqual(7);
    expect(
      compiled.quality.issues.some(issue => issue.code === 'feature_aggregation_applied')
    ).toBe(true);
    expect(
      compiled.quality.issues.some(issue => issue.code === 'improve_new_feature_limit_applied')
    ).toBe(false);
  });
});

describe('fallback section feature references', () => {
  it('references up to 10 features in fallback sections when available', () => {
    // Build a PRD with 6 features but no Definition of Done section (triggers fallback)
    const featureNames = ['Auth Login', 'User Profile', 'Dashboard', 'Settings', 'Notifications', 'Reports'];
    const featureBlocks = featureNames.map((name, i) => {
      const id = `F-${String(i + 1).padStart(2, '0')}`;
      return [
        `### ${id}: ${name}`,
        '**1. Purpose**',
        `The ${name} feature provides core functionality.`,
        '**10. Acceptance Criteria**',
        `1. ${name} works correctly end-to-end.`,
      ].join('\n');
    });

    const raw = [
      '## System Vision',
      'A comprehensive user management platform.',
      '',
      '## Functional Feature Catalogue',
      '',
      ...featureBlocks,
      '',
      '## Non-Functional Requirements',
      'Performance: < 2s response time.',
    ].join('\n');

    const result = compilePrdDocument(raw, { mode: 'generate', language: 'en' });

    // Definition of Done should be a fallback-generated section referencing features
    const dod = result.structure.definitionOfDone || '';
    // All 6 features should be referenced (cap is 10, so all 6 fit)
    const referencedFeatures = featureNames.filter(name => dod.includes(name));
    expect(referencedFeatures.length).toBe(6);
  });
});
