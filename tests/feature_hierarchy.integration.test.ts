/*
Author: rahn
Datum: 10.03.2026
Version: 1.0
Beschreibung: Methodenuebergreifende Integrations-Tests fuer Main-Task-/Subtask-Metadaten in den Simple-, Guided- und Iterative-Pfaden.
*/

// ÄNDERUNG 10.03.2026: Kleine Integrationsabsicherung fuer Parent-Task-Metadaten ueber alle drei Generierungsmethoden ergaenzt.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testState, mockFinalizeWithCompilerGates } = vi.hoisted(() => ({
  testState: { mockClient: null as any },
  mockFinalizeWithCompilerGates: vi.fn(),
}));

vi.mock('../server/openrouter', async () => {
  const actual = await vi.importActual<typeof import('../server/openrouter')>('../server/openrouter');
  return {
    ...actual,
    createClientWithUserPreferences: vi.fn(async () => ({
      client: testState.mockClient,
      contentLanguage: 'de',
    })),
  };
});

vi.mock('../server/prdCompilerFinalizer', async () => {
  const actual = await vi.importActual<typeof import('../server/prdCompilerFinalizer')>('../server/prdCompilerFinalizer');
  return {
    ...actual,
    finalizeWithCompilerGates: mockFinalizeWithCompilerGates,
  };
});

import { DualAiService } from '../server/dualAiService';
import { generateWithCompilerGates } from '../server/guidedCompilerGates';
import { assembleStructureToMarkdown } from '../server/prdAssembler';
import { parsePRDToStructure } from '../server/prdParser';
import type { PRDStructure } from '../server/prdStructure';
import { createMockOpenRouterClient } from './helpers/mockOpenRouter';

function buildUsage(total: number) {
  return {
    prompt_tokens: Math.max(1, Math.floor(total / 3)),
    completion_tokens: Math.max(1, total - Math.max(1, Math.floor(total / 3))),
    total_tokens: total,
  };
}

function createTestClient(defaultContent: string = 'Verbesserter PRD-Entwurf.') {
  const client = createMockOpenRouterClient({
    defaultContent,
    model: 'mock/test-model:free',
  }) as any;
  client.setPreferredModel('generator', 'mock/generator:free');
  client.setPreferredModel('reviewer', 'mock/reviewer:free');
  client.setPreferredModel('verifier', 'mock/verifier:free');
  client.setDefaultExecutionContext = vi.fn((context: any) => {
    client.__defaultExecutionContext = context;
  });
  client.__defaultExecutionContext = undefined;
  return client;
}

function buildFeatureHierarchyStructure(): PRDStructure {
  return {
    systemVision: 'Das System ermoeglicht kollaborative Aufgabenplanung mit stabiler PRD-Qualitaet.',
    featureCatalogueIntro: 'Die Features werden als Haupttask mit klaren Subtasks beschrieben.',
    features: [
      {
        id: 'F-01',
        name: 'Aufgabe erstellen',
        rawContent: 'Wird aus den strukturierten Feldern assembliert.',
        parentTaskName: 'Aufgabenverwaltung',
        parentTaskDescription: 'Erfasst, aendert und verfolgt Aufgaben im Board.',
        purpose: 'Erstellt eine neue Aufgabe im aktuellen Board.',
        actors: '- Teammitglied',
        trigger: 'Der Nutzer startet die Anlage einer neuen Aufgabe.',
        preconditions: '- Ein Board ist geoeffnet.',
        mainFlow: [
          'Der Nutzer oeffnet das Formular fuer eine neue Aufgabe.',
          'Das System speichert Titel, Beschreibung und Status.',
        ],
        alternateFlows: ['Bei Validierungsfehlern bleibt das Formular offen und zeigt Hinweise an.'],
        postconditions: 'Die neue Aufgabe ist im Board sichtbar.',
        dataImpact: 'Eine neue Aufgaben-Entitaet wird gespeichert.',
        uiImpact: 'Die UI zeigt die neu angelegte Aufgabe direkt im Board.',
        acceptanceCriteria: [
          'Eine Aufgabe wird nach dem Speichern sofort angezeigt.',
          'Pflichtfelder werden vor dem Speichern validiert.',
        ],
      },
      {
        id: 'F-02',
        name: 'Aufgabe aktualisieren',
        rawContent: 'Wird aus den strukturierten Feldern assembliert.',
        parentTaskName: 'Aufgabenverwaltung',
        parentTaskDescription: 'Erfasst, aendert und verfolgt Aufgaben im Board.',
        purpose: 'Aktualisiert Status und Inhalte einer bestehenden Aufgabe.',
        actors: '- Teammitglied',
        trigger: 'Der Nutzer bearbeitet eine bestehende Aufgabe.',
        preconditions: '- Die Aufgabe existiert bereits im Board.',
        mainFlow: [
          'Der Nutzer oeffnet die Aufgabe im Bearbeitungsmodus.',
          'Das System uebernimmt die geaenderten Werte nach dem Speichern.',
        ],
        alternateFlows: ['Bei Konflikten wird ein Hinweis angezeigt und kein stiller Fallback verwendet.'],
        postconditions: 'Die aktualisierte Aufgabe ist mit dem neuen Status sichtbar.',
        dataImpact: 'Vorhandene Aufgabenwerte werden versioniert aktualisiert.',
        uiImpact: 'Geaenderte Inhalte erscheinen ohne Neuaufbau des Boards.',
        acceptanceCriteria: [
          'Statusaenderungen sind direkt im Board sichtbar.',
          'Fehler beim Speichern werden deutlich gemeldet.',
        ],
      },
    ],
    otherSections: {},
  };
}

function buildFinalizerResult(structure: PRDStructure) {
  return {
    content: assembleStructureToMarkdown(structure),
    structure,
    quality: {
      valid: true,
      issues: [],
      featureCount: structure.features.length,
      truncatedLikely: false,
      missingSections: [],
    },
    qualityScore: 100,
    repairAttempts: [],
    reviewerAttempts: [],
    semanticVerification: {
      verdict: 'pass',
      blockingIssues: [],
      model: 'mock/verifier:free',
      usage: buildUsage(20),
      sameFamilyFallback: false,
      blockedFamilies: [],
    },
    semanticVerificationHistory: [
      {
        verdict: 'pass',
        blockingIssues: [],
        model: 'mock/verifier:free',
        usage: buildUsage(20),
        sameFamilyFallback: false,
        blockedFamilies: [],
      },
    ],
    semanticRepairApplied: false,
  };
}

function buildDegradedStructure(baseline: PRDStructure): PRDStructure {
  return {
    ...baseline,
    features: baseline.features.map((feature) => ({
      id: feature.id,
      name: feature.name,
      rawContent: ['1. Purpose', feature.purpose || 'Kurzbeschreibung fehlt.'].join('\n'),
      purpose: feature.purpose,
    })),
    otherSections: { ...baseline.otherSections },
  };
}

function expectParentTaskMetadata(structure: PRDStructure | undefined) {
  expect(structure?.features).toHaveLength(2);
  for (const feature of structure?.features || []) {
    expect(feature.parentTaskName).toBe('Aufgabenverwaltung');
    expect(feature.parentTaskDescription).toBe('Erfasst, aendert und verfolgt Aufgaben im Board.');
  }
}

function expectParentTaskMarkdown(markdown: string) {
  expect(markdown).toContain('Parent Task: Aufgabenverwaltung');
  expect(markdown).toContain('Parent Task Description: Erfasst, aendert und verfolgt Aufgaben im Board.');
}

describe('Feature-Hierarchie Integration', () => {
  beforeEach(() => {
    testState.mockClient = createTestClient();
    mockFinalizeWithCompilerGates.mockReset();
  });

  it('stellt Parent-Task-Metadaten im Simple-Pfad nach Compiler-Degradation wieder her', async () => {
    const existingContent = assembleStructureToMarkdown(buildFeatureHierarchyStructure());
    const baseline = parsePRDToStructure(existingContent);
    mockFinalizeWithCompilerGates.mockResolvedValue(buildFinalizerResult(buildDegradedStructure(baseline)));

    const service = new DualAiService();
    const result = await service.generatePRD({
      userInput: 'Bitte die bestehende Aufgabenverwaltung stabil erweitern.',
      existingContent,
      mode: 'improve',
    });

    expectParentTaskMetadata(result.structuredContent);
    expectParentTaskMarkdown(result.finalContent);
  });

  it('stellt Parent-Task-Metadaten im Guided-Pfad nach Compiler-Degradation wieder her', async () => {
    const existingContent = assembleStructureToMarkdown(buildFeatureHierarchyStructure());
    const baseline = parsePRDToStructure(existingContent);
    mockFinalizeWithCompilerGates.mockResolvedValue(buildFinalizerResult(buildDegradedStructure(baseline)));

    const result = await generateWithCompilerGates({
      client: testState.mockClient,
      systemPrompt: 'Fuehre eine konservative Guided-PRD-Verbesserung durch.',
      userPrompt: 'Verbessere die Aufgabenverwaltung ohne Hierarchieverlust.',
      mode: 'improve',
      existingContent,
    });

    expectParentTaskMetadata(result.enrichedStructure);
    expectParentTaskMarkdown(result.content);
  });

  it('haelt Parent-Task-Metadaten im Iterative-Pfad bis zur finalen Struktur stabil', async () => {
    const existingContent = assembleStructureToMarkdown(buildFeatureHierarchyStructure());
    const baseline = parsePRDToStructure(existingContent);
    mockFinalizeWithCompilerGates.mockResolvedValue(buildFinalizerResult(baseline));

    const service = new DualAiService();
    vi.spyOn(service as any, 'runIterationGeneratorPhase').mockResolvedValue({
      content: existingContent,
      usage: buildUsage(40),
      model: 'mock/generator:free',
      tier: 'development',
      usedFallback: false,
    });
    vi.spyOn(service as any, 'runIterationExpansionPhase').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'extractQuestionsWithFallback').mockResolvedValue(['Welche Stabilisierung fehlt noch?']);
    vi.spyOn(service as any, 'runIterationAnswererPhase').mockResolvedValue({
      answerResult: {
        content: 'Keine weiteren offenen Punkte.',
        usage: buildUsage(35),
        model: 'mock/reviewer:free',
        tier: 'development',
        usedFallback: false,
      },
      answererOutputTruncated: false,
    });
    vi.spyOn(service as any, 'validateAndPreserveIterationStructure').mockResolvedValue({
      shouldContinue: false,
      preservedPRD: existingContent,
      candidateStructure: baseline,
    });

    const result = await service.generateIterative(
      existingContent,
      'Verbessere die Aufgabenverwaltung ohne Verlust der Main-Task-Subtask-Struktur.',
      'improve',
      2,
      false,
      'user-iterative-hierarchy',
    );

    expectParentTaskMetadata(result.structuredContent);
    expectParentTaskMarkdown(result.mergedPRD || result.finalContent);
  });
});