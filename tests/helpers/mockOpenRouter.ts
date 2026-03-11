import { vi } from 'vitest';

// ── Types ────────────────────────────────────────────────────────────────────

export interface MockCallRecord {
  modelType: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  response: {
    content: string;
    model: string;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };
}

export interface MockOpenRouterOptions {
  defaultContent?: string;
  model?: string;
  responseMap?: Map<string, string>;  // prompt substring -> response content
  callLog?: MockCallRecord[];
  failOnCall?: number;  // 1-based
  failError?: Error;
}

// ── Mock client factory ──────────────────────────────────────────────────────

export function createMockOpenRouterClient(options: MockOpenRouterOptions = {}) {
  const {
    defaultContent = 'Mock AI response content.',
    model = 'mock/test-model:free',
    responseMap = new Map<string, string>(),
    callLog = [],
    failOnCall,
    failError = new Error('Simulated model failure'),
  } = options;

  let callCounter = 0;
  let preferredModels: Record<string, string | undefined> = {};
  let preferredTier: string = 'development';
  let fallbackChain: string[] = [];

  function resolveContent(userPrompt: string): string {
    for (const [substring, content] of responseMap.entries()) {
      if (userPrompt.includes(substring)) {
        return content;
      }
    }
    return defaultContent;
  }

  function buildResponse(content: string) {
    return {
      content,
      usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      model,
      finishReason: 'stop',
    };
  }

  const callModel = vi.fn(
    async (
      modelType: string,
      systemPrompt: string,
      userPrompt: string,
      maxTokens: number = 6000,
    ) => {
      callCounter++;
      if (failOnCall && callCounter === failOnCall) {
        throw failError;
      }

      const content = resolveContent(userPrompt);
      const response = buildResponse(content);

      callLog.push({
        modelType,
        systemPrompt,
        userPrompt,
        maxTokens,
        response: {
          content: response.content,
          model: response.model,
          usage: response.usage,
        },
      });

      return response;
    },
  );

  const callWithFallback = vi.fn(
    async (
      modelType: string,
      systemPrompt: string,
      userPrompt: string,
      maxTokens: number = 4000,
    ) => {
      callCounter++;
      if (failOnCall && callCounter === failOnCall) {
        throw failError;
      }

      const content = resolveContent(userPrompt);
      const response = buildResponse(content);

      callLog.push({
        modelType,
        systemPrompt,
        userPrompt,
        maxTokens,
        response: {
          content: response.content,
          model: response.model,
          usage: response.usage,
        },
      });

      return {
        ...response,
        tier: preferredTier,
        usedFallback: false,
      };
    },
  );

  return {
    callModel,
    callWithFallback,
    getPreferredModel: vi.fn((type: string) => preferredModels[type]),
    setPreferredModel: vi.fn((type: string, modelId: string | undefined) => {
      preferredModels[type] = modelId;
    }),
    setPreferredTier: vi.fn((tier: string) => {
      preferredTier = tier;
    }),
    setFallbackChain: vi.fn((chain: string[]) => {
      fallbackChain = [...chain];
    }),
    getFallbackChain: vi.fn(() => fallbackChain),
    getTier: vi.fn(() => preferredTier),
    getModels: vi.fn(() => ({
      generator: 'mock/generator:free',
      reviewer: 'mock/reviewer:free',
      verifier: 'mock/verifier:free',
      cost: '$0/Million Tokens',
    })),
    // expose internal state for assertions
    _callLog: callLog,
    _getCallCounter: () => callCounter,
  };
}

// ── PRD content helpers ──────────────────────────────────────────────────────

/**
 * Build a structurally valid PRD markdown document with canonical headings
 * and the specified number of features.
 */
export function buildMinimalPrdResponse(featureCount: number = 3, language: 'en' | 'de' = 'en'): string {
  const isGerman = language === 'de';

  const sections: string[] = [];

  sections.push('## System Vision');
  sections.push(
    isGerman
      ? 'Das System bietet eine kollaborative Plattform fuer Produktplanung und KI-gestuetzte PRD-Erstellung mit deterministischer Qualitaetssicherung.'
      : 'The system provides a collaborative platform for product planning and AI-assisted PRD creation with deterministic quality assurance.',
  );
  sections.push('');

  sections.push('## System Boundaries');
  sections.push(
    isGerman
      ? 'Webanwendung mit authentifizierten Benutzern, REST-API und PostgreSQL-Datenbank. Externe Integrationen ueber OpenRouter.'
      : 'Web application with authenticated users, REST API, and PostgreSQL database. External integrations via OpenRouter.',
  );
  sections.push('');

  sections.push('## Domain Model');
  sections.push(
    isGerman
      ? '- Kernentitaeten: Benutzer, PRD, Feature, Version, Sitzung.\n- Beziehungen: Ein Benutzer besitzt mehrere PRDs; ein PRD enthaelt mehrere Features.'
      : '- Core entities: User, PRD, Feature, Version, Session.\n- Relationships: A User owns multiple PRDs; a PRD contains multiple Features.',
  );
  sections.push('');

  sections.push('## Global Business Rules');
  sections.push(
    isGerman
      ? '- Feature-IDs bleiben ueber alle Verfeinerungslaeufe hinweg stabil und werden niemals neu zugewiesen.\n- Nur authentifizierte Benutzer koennen PRDs erstellen oder bearbeiten.'
      : '- Feature IDs remain stable across all refinement passes and are never reassigned.\n- Only authenticated users can create or edit PRDs.',
  );
  sections.push('');

  sections.push('## Functional Feature Catalogue');
  sections.push('');

  const featureNames = [
    ['PRD Authoring Workflow', 'PRD-Erstellungs-Workflow'],
    ['Quality Gate Evaluation', 'Qualitaets-Gate-Evaluierung'],
    ['Document Refinement', 'Dokumentenverfeinerung'],
    ['Team Collaboration', 'Teamzusammenarbeit'],
    ['Feature Catalogue Builder', 'Feature-Katalog-Erstellung'],
    ['Version History Tracking', 'Versionshistorie-Verfolgung'],
    ['Requirement Validation', 'Anforderungsvalidierung'],
    ['Compilation Pipeline', 'Kompilierungs-Pipeline'],
    ['Structured Export', 'Strukturierter Export'],
    ['Iterative Refinement', 'Iterative Verfeinerung'],
  ];

  for (let i = 1; i <= featureCount; i++) {
    const fId = `F-${String(i).padStart(2, '0')}`;
    const nameEntry = featureNames[(i - 1) % featureNames.length];
    const fName = isGerman ? nameEntry[1] : nameEntry[0];

    sections.push(`### ${fId}: ${fName}`);
    sections.push('');
    sections.push('1. Purpose');
    sections.push(
      isGerman
        ? `"${fName}" unterstuetzt die kollaborative Produktplanung und PRD-Erstellung durch deterministisch geprueften Qualitaetsoutput fuer das Zielteam.`
        : `"${fName}" supports collaborative product planning and PRD creation with deterministic quality-checked output for the target team.`,
    );
    sections.push('');
    sections.push('2. Actors');
    sections.push(
      isGerman
        ? `Primaer: Endnutzer im Kontext von "${fName}". Sekundaer: API- und Persistenzschicht.`
        : `Primary: end user invoking "${fName}". Secondary: API and persistence services.`,
    );
    sections.push('');
    sections.push('3. Trigger');
    sections.push(
      isGerman
        ? `Der Nutzer startet "${fName}" explizit ueber die Benutzeroberflaeche.`
        : `User explicitly initiates "${fName}" through the interface.`,
    );
    sections.push('');
    sections.push('4. Preconditions');
    sections.push(
      isGerman
        ? 'Alle benoetigten Eingaben sind vorhanden und vorvalidiert.'
        : 'Required inputs are present and validated before execution.',
    );
    sections.push('');
    sections.push('5. Main Flow');
    sections.push(
      isGerman
        ? `- System nimmt die Anfrage fuer "${fName}" entgegen und validiert Eingaben.\n- Geschaeftslogik fuer "${fName}" wird deterministisch ausgefuehrt.\n- Relevante Daten werden atomar gespeichert.\n- UI wird mit dem Ergebnis aktualisiert.`
        : `- System receives the "${fName}" request and validates input.\n- Business logic for "${fName}" executes deterministically.\n- Relevant data is created or updated atomically.\n- UI reflects the result and confirms completion.`,
    );
    sections.push('');
    sections.push('6. Alternate Flows');
    sections.push(
      isGerman
        ? '- Validierung fehlgeschlagen: Klare Fehlermeldung ohne Seiteneffekte.\n- Temporaerer Fehler: Protokollierung und Retry-Pfad.'
        : '- Validation failure: system returns a clear error and performs no partial write.\n- Transient failure: system logs the issue and offers a retry path.',
    );
    sections.push('');
    sections.push('7. Postconditions');
    sections.push(
      isGerman
        ? `Nach Abschluss von "${fName}" ist der Zustand konsistent, gespeichert und fuer Folgeaktionen verfuegbar.`
        : `After "${fName}" completes, resulting state is consistent, persisted, and available for follow-up actions.`,
    );
    sections.push('');
    sections.push('8. Data Impact');
    sections.push(
      isGerman
        ? `"${fName}" liest und aktualisiert nur die relevanten Entitaeten innerhalb des definierten Scopes.`
        : `The "${fName}" workflow reads and updates only in-scope entities required for this feature.`,
    );
    sections.push('');
    sections.push('9. UI Impact');
    sections.push(
      isGerman
        ? `Die Oberflaeche zeigt Lade-, Erfolg- und Fehlerzustaende fuer "${fName}" konsistent an.`
        : `UI surfaces loading, success, and error states for "${fName}" consistently and transparently.`,
    );
    sections.push('');
    sections.push('10. Acceptance Criteria');
    sections.push(
      isGerman
        ? `- "${fName}" ist fuer einen Nutzer ohne manuelles Nachladen in der UI verifizierbar.\n- Fehlerfaelle liefern klare Nutzerhinweise.\n- Datenaenderungen sind nach Ausfuehrung nachvollziehbar.`
        : `- "${fName}" is verifiable by end users directly in the UI without manual reload.\n- Error paths provide clear user feedback and keep state consistent.\n- Data mutations are observable after execution.`,
    );
    sections.push('');
  }

  sections.push('## Non-Functional Requirements');
  sections.push(
    isGerman
      ? '- Antwortzeiten unter zwei Sekunden fuer alle API-Aufrufe.\n- Verfuegbarkeit von mindestens 99,5% waehrend der Geschaeftszeiten.\n- Verschluesselung aller Daten in Transit und at Rest.'
      : '- Response times under two seconds for all API calls.\n- Availability of at least 99.5% during business hours.\n- Encryption of all data in transit and at rest.',
  );
  sections.push('');

  sections.push('## Error Handling & Recovery');
  sections.push(
    isGerman
      ? '- Fehlgeschlagene API-Aufrufe werden protokolliert und dem Nutzer mit klarer Meldung angezeigt.\n- Transiente Fehler werden automatisch bis zu dreimal wiederholt.'
      : '- Failed API calls are logged and surfaced to users with clear error messages.\n- Transient failures are automatically retried up to three times.',
  );
  sections.push('');

  sections.push('## Deployment & Infrastructure');
  sections.push(
    isGerman
      ? '- Node.js-Backend mit PostgreSQL-Datenbank und Docker-basiertem Deployment.\n- CI/CD-Pipeline mit automatisierten Tests vor jedem Deployment.'
      : '- Node.js backend with PostgreSQL database and Docker-based deployment.\n- CI/CD pipeline with automated tests before every deployment.',
  );
  sections.push('');

  sections.push('## Definition of Done');
  sections.push(
    isGerman
      ? '- Alle Pflichtabschnitte sind vollstaendig und alle Akzeptanzkriterien erfuellt.\n- Keine offenen Fehler mit Severity "Error" im Qualitaetsbericht.'
      : '- All required sections are complete and all acceptance criteria are met.\n- No open issues with severity "error" in the quality report.',
  );
  sections.push('');

  sections.push('## Out of Scope');
  sections.push(
    isGerman
      ? '- Native Mobile-Apps sind nicht Teil dieses Releases.\n- Erweiterte Analytics und Reporting sind in diesem Release nicht enthalten.'
      : '- Native mobile apps are not part of this release.\n- Advanced analytics and reporting are excluded from this release.',
  );
  sections.push('');

  sections.push('## Timeline & Milestones');
  sections.push(
    isGerman
      ? '- Phase 1 (Wochen 1-2): Kernfunktionen und Basisinfrastruktur.\n- Phase 2 (Wochen 3-4): Erweiterungen und Qualitaetssicherung.'
      : '- Phase 1 (Weeks 1-2): Core features and base infrastructure.\n- Phase 2 (Weeks 3-4): Extensions and quality assurance.',
  );
  sections.push('');

  sections.push('## Success Criteria & Acceptance Testing');
  sections.push(
    isGerman
      ? '- 95% aller Laeufe erzeugen ein gueltiges PRD-Dokument ohne manuellen Eingriff.\n- Qualitaetsbericht weist keine blockierenden Fehler auf.'
      : '- 95% of all runs produce a valid PRD document without manual intervention.\n- Quality report shows no blocking errors.',
  );

  return sections.join('\n');
}

// ── Guided question response helper ──────────────────────────────────────────

/**
 * Build a JSON string matching the GuidedQuestion[] format used by the guided
 * AI workflow, with the given number of questions.
 */
export function buildQuestionsResponse(count: number = 3): string {
  const questions = [];
  for (let i = 1; i <= count; i++) {
    questions.push({
      id: `q${i}`,
      question: `What is your preference for aspect ${i} of the project?`,
      context: `This helps define the scope and priorities for aspect ${i}.`,
      options: [
        { id: 'a', label: `Option A${i}`, description: `First choice for question ${i}` },
        { id: 'b', label: `Option B${i}`, description: `Second choice for question ${i}` },
        { id: 'c', label: `Option C${i}`, description: `Third choice for question ${i}` },
        { id: 'custom', label: 'Other', description: 'Let me explain my preference...' },
      ],
    });
  }

  return JSON.stringify({
    preliminaryPlan: `A preliminary plan covering ${count} key aspects of the project scope and delivery.`,
    questions,
  });
}
