import { describe, it, expect, vi } from 'vitest';
import { expandFeature, parseFeatureList } from '../server/services/llm/expandFeature';

function usage(total: number) {
  return {
    prompt_tokens: Math.floor(total / 2),
    completion_tokens: total - Math.floor(total / 2),
    total_tokens: total,
  };
}

describe('expandFeature language handling', () => {
  it('canonicalizes feature IDs when parsing feature lists', () => {
    const parsed = parseFeatureList([
      'Main Task: Aufgabenverwaltung',
      'Task Summary: Verwaltet einzelne Aufgaben und ihren Status.',
      '',
      'F-001: Aufgabe erstellen',
      'Short description: canonical id check',
      '',
      'F-02: Aufgabe bearbeiten',
      'Short description: login flow',
    ].join('\n'));

    expect(parsed.map(feature => feature.featureId)).toEqual(['F-01', 'F-02']);
    expect(parsed[0].parentTaskName).toBe('Aufgabenverwaltung');
    expect(parsed[0].parentTaskDescription).toContain('Status');
  });

  it('uses german deterministic fallback when expansion repeatedly fails validation', async () => {
    const client = {
      callWithFallback: vi.fn(async () => ({
        content: [
          'Feature ID: F-01',
          'Feature Name: Test Feature',
          '1. Purpose',
          'Unvollstaendiger Inhalt',
        ].join('\n'),
        model: 'mock/model',
        usage: usage(12),
      })),
    } as any;

    const result = await expandFeature(
      'erstelle bitte eine todo app',
      'Deutsche Vision',
      'F-01',
      'Test Feature',
      'Kurzbeschreibung',
      client,
      'de'
    );

    expect(result.model.endsWith(':deterministic-fallback')).toBe(true);
    expect(result.content).toContain('wird als deterministische, testbare Funktion');
    expect(result.content).toContain('Primaer: Endnutzer');
  });

  it('applies local structure repair before deterministic fallback', async () => {
    const almostValidFeature = [
      'Feature ID: F-01',
      'Feature Name: Test Feature',
      '',
      '1. Purpose',
      'Klarer Zweck.',
      '2. Actors',
      '- Nutzer',
      '3. Trigger',
      'Aktion wird gestartet.',
      '4. Preconditions',
      '- Anwendung aktiv.',
      '5. Main Flow',
      '1. Schritt eins.',
      '2. Schritt zwei.',
      '3. Schritt drei.',
      '6. Alternate Flows',
      '- Fehlerfall wird abgefangen.',
      '7. Postconditions',
      'Zustand ist konsistent.',
      '8. Data Impact',
      'Daten aktualisiert.',
      '9. UI Impact',
      'UI aktualisiert.',
      // 10. Acceptance Criteria intentionally missing
    ].join('\n');

    const client = {
      callWithFallback: vi.fn(async () => ({
        content: almostValidFeature,
        model: 'mock/model',
        usage: usage(18),
      })),
    } as any;

    const result = await expandFeature(
      'erstelle bitte eine todo app',
      'Deutsche Vision',
      'F-01',
      'Test Feature',
      'Kurzbeschreibung',
      client,
      'de'
    );

    expect(result.model.endsWith(':local-structure-repair')).toBe(true);
    expect(result.model.endsWith(':deterministic-fallback')).toBe(false);
    expect(result.content).toContain('10. Acceptance Criteria');
  });

  it('injects german language instruction into expansion prompts', async () => {
    const validFeature = [
      'Feature ID: F-01',
      'Feature Name: Test Feature',
      '',
      '1. Purpose',
      'Deutschsprachige Beschreibung.',
      '2. Actors',
      '- Nutzer',
      '3. Trigger',
      'Benutzer startet Aktion.',
      '4. Preconditions',
      '- Anwendung aktiv.',
      '5. Main Flow',
      '1. Schritt eins.',
      '2. Schritt zwei.',
      '6. Alternate Flows',
      '- Fehlerfall wird behandelt.',
      '7. Postconditions',
      'Zustand ist konsistent.',
      '8. Data Impact',
      'Daten werden aktualisiert.',
      '9. UI Impact',
      'UI zeigt neues Ergebnis.',
      '10. Acceptance Criteria',
      '- Kriterium ist testbar.',
    ].join('\n');

    const client = {
      callWithFallback: vi.fn(async () => ({
        content: validFeature,
        model: 'mock/model',
        usage: usage(42),
      })),
    } as any;

    await expandFeature(
      'erstelle bitte eine todo app',
      'Deutsche Vision',
      'F-01',
      'Test Feature',
      'Kurzbeschreibung',
      client,
      'de'
    );

    const firstCall = client.callWithFallback.mock.calls[0];
    const systemPrompt = String(firstCall[1] || '');
    const userPrompt = String(firstCall[2] || '');

    expect(systemPrompt).toContain('Write all descriptive body text in German');
    expect(userPrompt).toContain('write all section body text in German');
  });
});
