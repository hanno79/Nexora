/**
 * Author: rahn
 * Datum: 09.03.2026
 * Version: 1.0
 * Beschreibung: Gezielte Tests fuer substanzbasierten Feature-Merge
 */

import { describe, expect, it } from 'vitest';
import type { PRDStructure } from '../server/prdStructure';
import { mergeExpansionIntoStructure } from '../server/prdStructureMerger';

function makeBaseStructure(): PRDStructure {
  return {
    features: [],
    otherSections: {},
  };
}

// ÄNDERUNG 09.03.2026: Regressionsschutz gegen generischen deterministic fallback
// im Feature-Merge.
describe('mergeExpansionIntoStructure', () => {
  it('bewahrt substanziellen bestehenden Inhalt gegen laengeren deterministischen Fallback', () => {
    const base = makeBaseStructure();
    base.features.push({
      id: 'F-01',
      name: 'Benutzeranmeldung',
      rawContent: 'Bestehender detailreicher Inhalt',
      purpose: 'Benutzer melden sich mit E-Mail und Passwort sicher an, um geschuetzte Bereiche ihres Kontos zu nutzen.',
      mainFlow: [
        'Benutzer oeffnet die Login-Seite und gibt gueltige Zugangsdaten ein.',
        'System prueft Kennwort und Kontostatus gegen den Authentifizierungsdienst.',
        'System erstellt eine Session und leitet den Benutzer in das Dashboard weiter.',
      ],
      acceptanceCriteria: [
        'Gueltige Zugangsdaten fuehren zu einer aktiven Session und einer Weiterleitung in das Dashboard.',
        'Ungueltige Zugangsdaten zeigen eine klare Fehlermeldung ohne eine Session zu erstellen.',
      ],
    });

    const merged = mergeExpansionIntoStructure(base, [{
      featureId: 'F-01',
      featureName: 'Benutzeranmeldung',
      valid: true,
      compiled: false,
      retried: false,
      model: 'mock:model:deterministic-fallback',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      content: [
        'Feature ID: F-01',
        'Feature Name: Benutzeranmeldung',
        '',
        '1. Purpose',
        'Benutzeranmeldung wird als deterministische, testbare Funktion mit klaren Grenzen umgesetzt.',
        '',
        '2. Actors',
        '- Primaer: Endnutzer',
        '- Sekundaer: Systemservice zur Verarbeitung der Anfrage',
        '',
        '3. Trigger',
        'Der Benutzer startet die zugehoerige Aktion ueber die UI oder einen API-Endpunkt.',
        '',
        '5. Main Flow',
        '1. Das System empfaengt und validiert die Anfrage fuer Benutzeranmeldung.',
        '2. Das System fuehrt die Kernlogik deterministisch aus und aktualisiert den Zustand.',
        '3. Das System liefert eine Erfolgsmeldung und aktualisiert die relevante UI-Ansicht.',
        '',
        '10. Acceptance Criteria',
        '- Das Feature kann Ende-zu-Ende ohne mehrdeutiges Verhalten ausgefuehrt werden.',
        '- Validierungs- und Fehlerpfade sind explizit und testbar umgesetzt.',
        '- Der resultierende Zustand ist konsistent und in UI/API-Antworten sichtbar.',
      ].join('\n'),
    }]);

    const feature = merged.features[0];
    expect(feature.purpose).toContain('E-Mail und Passwort sicher an');
    expect(feature.mainFlow?.[0]).toContain('Login-Seite');
    expect(feature.acceptanceCriteria?.[0]).toContain('aktiven Session');
    expect(feature.rawContent).toBe('Bestehender detailreicher Inhalt');
  });

  it('bevorzugt substanzielleren Expanded-Inhalt auch dann, wenn der bestehende Text laenger ist', () => {
    const base = makeBaseStructure();
    base.features.push({
      id: 'F-02',
      name: 'Passwort Reset',
      rawContent: 'Passwort Reset Passwort Reset Passwort Reset Passwort Reset Passwort Reset Passwort Reset',
      purpose: 'Passwort Reset Passwort Reset Passwort Reset',
    });

    const merged = mergeExpansionIntoStructure(base, [{
      featureId: 'F-02',
      featureName: 'Passwort Reset',
      valid: true,
      compiled: false,
      retried: false,
      model: 'mock:model',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      content: [
        'Feature ID: F-02',
        'Feature Name: Passwort Reset',
        '',
        '1. Purpose',
        'Benutzer koennen ihr Passwort ueber einen verifizierten Einmal-Link sicher neu setzen, ohne den Support zu kontaktieren.',
        '',
        '5. Main Flow',
        '1. Benutzer fordert ueber die Login-Seite einen Reset-Link an.',
        '2. System erstellt ein zeitlich begrenztes Token und versendet eine E-Mail.',
        '3. Benutzer setzt ueber den Link ein neues Passwort und bestaetigt die Aenderung.',
        '',
        '10. Acceptance Criteria',
        '- Reset-Link ist nur fuer den angeforderten Benutzer und nur innerhalb des Gueltigkeitsfensters nutzbar.',
        '- Nach erfolgreichem Reset kann sich der Benutzer mit dem neuen Passwort anmelden.',
      ].join('\n'),
    }]);

    const feature = merged.features[0];
    expect(feature.purpose).toContain('verifizierten Einmal-Link');
    expect(feature.mainFlow).toHaveLength(3);
    expect(feature.rawContent).toContain('Reset-Link');
  });

  it('uebernimmt neue substanzielle Felder, ohne gute bestehende Felder durch generischen Text zu ersetzen', () => {
    const base = makeBaseStructure();
    base.features.push({
      id: 'F-03',
      name: 'Rechnung herunterladen',
      rawContent: 'Bestehende Featurebeschreibung',
      purpose: 'Benutzer koennen abgeschlossene Rechnungen im Kundenkonto als PDF herunterladen.',
      mainFlow: [
        'Benutzer oeffnet den Bereich Rechnungen im Kundenkonto.',
        'System listet verfuegbare Rechnungen mit Zeitraum und Betrag auf.',
        'Benutzer startet den Download einer konkreten Rechnung.',
      ],
    });

    const merged = mergeExpansionIntoStructure(base, [{
      featureId: 'F-03',
      featureName: 'Rechnung herunterladen',
      valid: true,
      compiled: false,
      retried: false,
      model: 'mock:model',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      content: [
        'Feature ID: F-03',
        'Feature Name: Rechnung herunterladen',
        '',
        '1. Purpose',
        'Rechnung herunterladen wird als deterministische, testbare Funktion mit klaren Grenzen umgesetzt.',
        '',
        '8. Data Impact',
        'System liest die freigegebene Rechnungsdatei und protokolliert den Download revisionssicher fuer Support und Compliance.',
        '',
        '10. Acceptance Criteria',
        '- Nur Rechnungen des angemeldeten Kunden sind downloadbar.',
        '- Jeder Download wird mit Zeitstempel und Benutzerkennung protokolliert.',
      ].join('\n'),
    }]);

    const feature = merged.features[0];
    expect(feature.purpose).toContain('abgeschlossene Rechnungen');
    expect(feature.dataImpact).toContain('revisionssicher');
    expect(feature.acceptanceCriteria).toHaveLength(2);
    expect(feature.mainFlow?.[0]).toContain('Bereich Rechnungen');
  });

  it('uebernimmt Parent-Task-Metadaten aus dem expandierten Subtask', () => {
    const base = makeBaseStructure();

    const merged = mergeExpansionIntoStructure(base, [{
      featureId: 'F-04',
      featureName: 'Aufgabe bearbeiten',
      parentTaskName: 'Aufgabenverwaltung',
      parentTaskDescription: 'Erfasst, pflegt und verfolgt Aufgaben ueber ihren Lebenszyklus.',
      valid: true,
      compiled: false,
      retried: false,
      model: 'mock:model',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      content: [
        'Feature ID: F-04',
        'Feature Name: Aufgabe bearbeiten',
        '',
        '1. Purpose',
        'Benutzer koennen Titel und Beschreibung einer bestehenden Aufgabe aktualisieren.',
        '5. Main Flow',
        '1. Benutzer oeffnet eine Aufgabe.',
        '2. Benutzer aendert Titel oder Beschreibung.',
        '3. System speichert die Aenderung.',
        '10. Acceptance Criteria',
        '- Aktualisierte Inhalte sind direkt sichtbar.',
        '- Ungueltige Eingaben werden abgewiesen.',
      ].join('\n'),
    }]);

    expect(merged.features).toHaveLength(1);
    expect(merged.features[0].parentTaskName).toBe('Aufgabenverwaltung');
    expect(merged.features[0].parentTaskDescription).toContain('Lebenszyklus');
  });
});