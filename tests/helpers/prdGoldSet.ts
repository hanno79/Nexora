import { compilePrdDocument, type CompilePrdOptions, type CompilePrdResult } from '../../server/prdCompiler';

export interface GoldSetFeature {
  id: string;
  name: string;
  purpose: string;
  actors: string;
  trigger: string;
  preconditions: string;
  mainFlow: string[];
  alternateFlows: string[];
  postconditions: string;
  dataImpact: string;
  uiImpact: string;
  acceptanceCriteria: string[];
}

const BASE_FEATURES: GoldSetFeature[] = [
  {
    id: 'F-01',
    name: 'Provider List Management',
    purpose: 'Load the ordered provider list for the selected tier so embedded widgets can present available routing options without manual configuration.',
    actors: 'Authenticated developer, backend configuration API.',
    trigger: 'The widget initializes or the user switches the active tier tab.',
    preconditions: 'A valid user session exists and at least one provider is configured for the selected tier.',
    mainFlow: [
      'The widget requests providers for the selected tier from the configuration API.',
      'The backend loads provider metadata, free-model flags, and ordering rules from persistent storage.',
      'The UI renders the provider list in the configured order and highlights the current default provider.',
    ],
    alternateFlows: [
      'If the tier has no configured providers, the widget shows a disabled empty state with a corrective message.',
      'If authorization fails, the widget keeps existing selections read-only and displays an access warning.',
    ],
    postconditions: 'The user sees the current provider order for the selected tier and can continue with model selection using the loaded data.',
    dataImpact: 'Reads Provider and TierConfiguration records without mutating persisted state.',
    uiImpact: 'Provider dropdowns, tier badges, and empty-state messaging are updated for the selected tier.',
    acceptanceCriteria: [
      'The provider list respects the stored orderIndex for the selected tier.',
      'The widget shows a clear empty state when no providers are configured.',
      'Unauthorized users cannot edit provider ordering from the widget.',
    ],
  },
  {
    id: 'F-02',
    name: 'Model Catalog Retrieval',
    purpose: 'Load provider-specific models with tier and cost metadata so users can choose an appropriate runtime target for each environment.',
    actors: 'Authenticated developer, model catalog API.',
    trigger: 'The user selects a provider or opens the model selection area.',
    preconditions: 'A valid providerId exists and the requesting user may view model metadata for that tenant.',
    mainFlow: [
      'The widget requests the model catalog for the selected provider.',
      'The backend returns model names, pricing metadata, free-tier flags, and capability summaries.',
      'The UI renders a model list that distinguishes free models from paid models before selection.',
    ],
    alternateFlows: [
      'If the provider is unknown, the API returns not found and the widget clears the current model selection.',
      'If the model service is temporarily unavailable, the widget surfaces a retry action without mutating saved settings.',
    ],
    postconditions: 'The user can pick from the latest known model set for the active provider.',
    dataImpact: 'Reads Model records and linked Provider metadata without changing configuration.',
    uiImpact: 'Model dropdown options, pricing badges, and warning callouts refresh for the selected provider.',
    acceptanceCriteria: [
      'The widget shows only models that belong to the selected provider.',
      'Free and paid models are labeled distinctly in the UI.',
      'A temporary catalog failure does not clear the last saved configuration.',
    ],
  },
  {
    id: 'F-03',
    name: 'Tier Configuration Storage',
    purpose: 'Persist tier-specific provider ordering so runtime fallback behavior remains deterministic across widget sessions and deployments.',
    actors: 'Administrator, backend configuration service, audit logger.',
    trigger: 'An administrator saves provider ordering for a tier.',
    preconditions: 'The payload contains a non-empty provider order and the user has administrator privileges.',
    mainFlow: [
      'The backend validates the submitted provider order and free-tier constraints.',
      'The configuration service writes the updated TierConfiguration records inside one transaction.',
      'The audit log records the change and the API returns the persisted order to the widget.',
    ],
    alternateFlows: [
      'If duplicate order indexes are submitted, validation fails and the previous ordering remains unchanged.',
      'If storage times out, the transaction rolls back and the widget shows a retry message.',
    ],
    postconditions: 'The saved provider order is durable and available to subsequent runtime fallback requests.',
    dataImpact: 'Creates or updates TierConfiguration rows and audit log entries after validation succeeds.',
    uiImpact: 'The admin view confirms the saved ordering and clears unsaved-change warnings.',
    acceptanceCriteria: [
      'Saving a valid provider order persists the exact submitted order.',
      'Invalid ordering attempts do not create partial writes.',
      'An audit entry is recorded for every successful tier-configuration change.',
    ],
  },
  {
    id: 'F-04',
    name: 'Fallback Order Engine',
    purpose: 'Switch to the next configured provider when a rate-limit response blocks the current runtime path, while preserving deterministic limits on retry behavior.',
    actors: 'Runtime request router, provider gateway, developer observing runtime status.',
    trigger: 'The active provider returns HTTP 429 during an inference request.',
    preconditions: 'A tier-specific provider order exists and the current request has not exhausted the maximum switch count.',
    mainFlow: [
      'The router classifies the provider failure as rate-limit eligible for fallback.',
      'The next provider in the configured order is selected for the same request context.',
      'The system retries the request once per provider until the switch limit is reached or a provider succeeds.',
    ],
    alternateFlows: [
      'If no additional provider exists, the runtime returns a degraded-mode error to the caller.',
      'If the switch limit is reached, the router stops retrying and logs the exhausted fallback chain.',
    ],
    postconditions: 'The request either completes through an alternate provider or fails with an explicit fallback-exhausted status.',
    dataImpact: 'Writes runtime diagnostics and per-request fallback telemetry without mutating tier configuration.',
    uiImpact: 'Operational status views show which provider handled the request and whether fallback occurred.',
    acceptanceCriteria: [
      'A 429 response triggers selection of the next configured provider in order.',
      'The router stops after the configured maximum number of provider switches.',
      'Fallback telemetry records each attempted provider for the request.',
    ],
  },
  {
    id: 'F-05',
    name: 'Theme Customization Interface',
    purpose: 'Let administrators adapt widget colors and typography without breaking tier-selection or provider-configuration workflows.',
    actors: 'Administrator, embedded widget UI, theme settings API.',
    trigger: 'The administrator edits theme values and confirms the changes.',
    preconditions: 'The user may edit theme settings and submitted values pass validation.',
    mainFlow: [
      'The widget validates the proposed theme values before submitting them to the backend.',
      'The backend persists the approved theme configuration for the current account.',
      'The widget re-renders with the saved theme variables and confirms the change.',
    ],
    alternateFlows: [
      'If a submitted color token is invalid, validation blocks persistence and highlights the broken field.',
      'If persistence fails, the widget restores the previous theme preview and shows an error notification.',
    ],
    postconditions: 'The saved theme is available on the next widget load for the same account.',
    dataImpact: 'Updates WidgetSettings.themeName and ThemeSettings tokens for the authenticated account.',
    uiImpact: 'Buttons, badges, and container styling update immediately after a successful save.',
    acceptanceCriteria: [
      'Valid theme changes persist across a browser refresh.',
      'Invalid theme values do not overwrite the previous saved theme.',
      'The widget preview updates only after the backend confirms a successful save.',
    ],
  },
  {
    id: 'F-06',
    name: 'Model Selection Persistence',
    purpose: 'Persist the selected default model per tier so each environment resumes with the expected routing target after reload.',
    actors: 'Authenticated developer, backend settings API.',
    trigger: 'The user saves the chosen default model for a tier.',
    preconditions: 'The selected model belongs to the chosen provider and the user is allowed to edit widget settings.',
    mainFlow: [
      'The widget submits the chosen default model and provider context for the active tier.',
      'The backend validates that the model belongs to the selected provider and tier policy.',
      'The persisted widget settings are returned to the UI and become the new default selection.',
    ],
    alternateFlows: [
      'If the model is invalid for the selected provider, the save fails and the previous default remains active.',
      'If the request times out, the widget shows a retry action without dropping the current local selection.',
    ],
    postconditions: 'The saved default model is restored automatically on the next widget load for the same user context.',
    dataImpact: 'Updates WidgetSettings.selectedModelId, WidgetSettings.defaultTier, and the active provider ordering reference after validation succeeds.',
    uiImpact: 'The model selector shows the saved default model and clears unsaved-change indicators.',
    acceptanceCriteria: [
      'Refreshing the page restores the saved default model for the active tier.',
      'Saving an invalid model leaves the previous persisted selection unchanged.',
      'The UI shows a success confirmation only after persistence succeeds.',
    ],
  },
];

const EN_SECTIONS = {
  systemVision: 'The reusable LLM widget gives product teams one embedded control surface for provider selection, model configuration, fallback ordering, and runtime governance. It reduces duplicated implementation work while keeping model-routing behavior, cost visibility, and reviewable defaults consistent across projects.',
  systemBoundaries: 'The scope includes the embeddable React widget, a backend configuration API, and persistent runtime settings stored in PostgreSQL. The system serves authenticated internal users through web applications.',
  domainModel: [
    '- Provider (id, name, tier, isFree, orderIndex, description)',
    '- Model (id, providerId, name, costPerToken, isFree, capabilitySummary)',
    '- TierConfiguration (tier, providerId, orderIndex, maxSwitches)',
    '- WidgetSettings (userId, defaultTier, selectedModelId, providerOrderArray, themeName)',
    '- ThemeSettings (userId, colorTokens, typographyPreset)',
  ].join('\n'),
  globalBusinessRules: [
    '- Every tier configuration must contain at least one provider in a deterministic order.',
    '- Only authenticated administrators may change tier configuration or theme settings.',
    '- Free-tier selections may only reference models marked as free.',
    '- Runtime fallback may switch providers at most three times for one request after HTTP 429.',
  ].join('\n'),
  nonFunctional: [
    '- Configuration API responses complete within 300 ms at p95 latency.',
    '- Runtime fallback decisions are logged with provider, reason, and elapsed latency.',
    '- All persisted widget settings are encrypted at rest and transmitted over HTTPS only.',
  ].join('\n'),
  errorHandling: [
    '- Validation failures return field-level messages and preserve the previous persisted configuration.',
    '- Rate-limit responses trigger deterministic provider fallback until the switch budget is exhausted.',
    '- Storage failures roll back partial writes and emit audit-friendly diagnostic entries.',
  ].join('\n'),
  deployment: [
    '- The widget ships as an npm package and is served by a Node-based configuration API.',
    '- PostgreSQL stores provider, tier, widget, and theme settings; Redis is optional for short-lived runtime cache entries.',
    '- CI runs type checks, unit tests, integration tests, and package publishing gates before release.',
  ].join('\n'),
  definitionOfDone: [
    '- All required PRD sections are complete, internally consistent, and compiler-valid.',
    '- Reviewer and verifier diagnostics are persisted for accepted release candidates.',
    '- Widget configuration, fallback routing, and settings persistence pass integration coverage.',
  ].join('\n'),
  outOfScope: [
    '- Native mobile applications for iOS or Android are not included in this release.',
    '- Direct client-side storage of secret provider API keys is excluded from the widget.',
    '- Real-time collaborative editing of widget settings is excluded from this release.',
  ].join('\n'),
  timeline: [
    '- Phase 1: Provider and model configuration foundations.',
    '- Phase 2: Runtime fallback handling and diagnostics.',
    '- Phase 3: Theme customization, packaging, and release hardening.',
  ].join('\n'),
  successCriteria: [
    '- Teams reuse the widget in at least seventy percent of new AI-enabled projects.',
    '- Widget integration time drops by at least half compared with project-specific implementations.',
    '- Runtime fallback incidents remain observable and attributable through persisted diagnostics.',
  ].join('\n'),
};

const DE_SECTIONS = {
  systemVision: 'Das wiederverwendbare LLM-Widget bietet Teams eine gemeinsame Oberflaeche fuer Provider-Auswahl, Modellkonfiguration, Fallback-Reihenfolge und Laufzeit-Governance. Es reduziert doppelten Implementierungsaufwand und haelt Routing-Verhalten, Kostentransparenz und nachvollziehbare Standardwerte ueber Projekte hinweg konsistent.',
  systemBoundaries: 'Der Scope umfasst das einbettbare React-Widget, eine Backend-Konfigurations-API und persistente Laufzeit-Einstellungen in PostgreSQL. Das System bedient authentifizierte interne Benutzer in Webanwendungen.',
  domainModel: [
    '- Provider (id, name, tier, isFree, orderIndex, description)',
    '- Model (id, providerId, name, costPerToken, isFree, capabilitySummary)',
    '- TierConfiguration (tier, providerId, orderIndex, maxSwitches)',
    '- WidgetSettings (userId, defaultTier, selectedModelId, providerOrderArray, themeName)',
    '- ThemeSettings (userId, colorTokens, typographyPreset)',
  ].join('\n'),
  globalBusinessRules: [
    '- Jede Tier-Konfiguration enthaelt mindestens einen Provider in deterministischer Reihenfolge.',
    '- Nur authentifizierte Administratoren duerfen Tier-Konfigurationen oder Theme-Einstellungen aendern.',
    '- Free-Tier-Auswahlen duerfen nur Modelle mit gesetztem Free-Flag referenzieren.',
    '- Runtime-Fallback darf nach HTTP 429 hoechstens drei Provider-Wechsel pro Anfrage ausfuehren.',
  ].join('\n'),
  nonFunctional: [
    '- API-Antworten fuer Konfigurationen bleiben bei p95 unter 300 ms.',
    '- Runtime-Fallback-Entscheidungen werden mit Provider, Grund und Latenz protokolliert.',
    '- Persistierte Widget-Einstellungen sind at rest verschluesselt und werden nur ueber HTTPS uebertragen.',
  ].join('\n'),
  errorHandling: [
    '- Validierungsfehler liefern feldbezogene Meldungen und erhalten die zuletzt persistierte Konfiguration.',
    '- Rate-Limit-Antworten loesen deterministischen Provider-Fallback aus, bis das Wechselbudget erschoepft ist.',
    '- Speicherfehler fuehren zu Rollback ohne Teilzustand und erzeugen nachvollziehbare Diagnose-Eintraege.',
  ].join('\n'),
  deployment: [
    '- Das Widget wird als npm-Paket ausgeliefert und von einer Node-basierten Konfigurations-API versorgt.',
    '- PostgreSQL speichert Provider-, Tier-, Widget- und Theme-Einstellungen; Redis bleibt optional fuer kurzlebige Runtime-Caches.',
    '- CI fuehrt Typpruefungen, Unit-Tests, Integrationstests und Publish-Gates vor jedem Release aus.',
  ].join('\n'),
  definitionOfDone: [
    '- Alle Pflichtabschnitte sind vollstaendig, intern konsistent und compiler-valide.',
    '- Reviewer- und Verifier-Diagnostik wird fuer akzeptierte Releases persistiert.',
    '- Widget-Konfiguration, Fallback-Routing und Settings-Persistenz bestehen die Integrationsabdeckung.',
  ].join('\n'),
  outOfScope: [
    '- Native Mobile-Apps fuer iOS oder Android sind nicht Teil dieses Releases.',
    '- Direkte clientseitige Speicherung geheimer Provider-API-Keys ist aus dem Widget ausgeschlossen.',
    '- Echtzeit-Kollaboration bei Widget-Einstellungen ist in diesem Release nicht enthalten.',
  ].join('\n'),
  timeline: [
    '- Phase 1: Grundlagen fuer Provider- und Modellkonfiguration.',
    '- Phase 2: Runtime-Fallback und Diagnostik.',
    '- Phase 3: Theme-Anpassung, Packaging und Release-Haertung.',
  ].join('\n'),
  successCriteria: [
    '- Teams verwenden das Widget in mindestens siebzig Prozent neuer KI-Projekte wieder.',
    '- Die Integrationszeit sinkt gegenueber projektspezifischen Implementierungen um mindestens die Haelfte.',
    '- Runtime-Fallback-Vorfaelle bleiben ueber persistierte Diagnostik nachvollziehbar.',
  ].join('\n'),
};

type SupportedLanguage = 'en' | 'de';

function sectionsForLanguage(language: SupportedLanguage) {
  return language === 'de' ? DE_SECTIONS : EN_SECTIONS;
}

const DE_FEATURE_TRANSLATIONS: Record<string, Partial<GoldSetFeature>> = {
  'F-01': {
    name: 'Provider-Listenverwaltung',
    purpose: 'Lädt die geordnete Provider-Liste für das ausgewählte Tier, damit eingebettete Widgets verfügbare Routing-Optionen ohne manuelle Konfiguration anzeigen können.',
    actors: 'Authentifizierter Entwickler, Backend-Konfigurations-API.',
    trigger: 'Das Widget initialisiert sich oder der Benutzer wechselt den aktiven Tier-Tab.',
    preconditions: 'Eine gültige Benutzersitzung existiert und mindestens ein Provider ist für das ausgewählte Tier konfiguriert.',
    mainFlow: [
      'Das Widget fordert die Provider für das ausgewählte Tier von der Konfigurations-API an.',
      'Das Backend lädt Provider-Metadaten, Free-Modell-Flags und Reihenfolgeregeln aus dem persistenten Speicher.',
      'Die UI rendert die Provider-Liste in der konfigurierten Reihenfolge und markiert den aktuellen Standard-Provider.',
    ],
    alternateFlows: [
      'Wenn für das Tier keine Provider konfiguriert sind, zeigt das Widget einen deaktivierten Leerzustand mit einer Korrekturmeldung an.',
      'Wenn die Autorisierung fehlschlägt, behält das Widget bestehende Auswahlen schreibgeschützt bei und zeigt eine Zugriffswarnung an.',
    ],
    postconditions: 'Der Benutzer sieht die aktuelle Provider-Reihenfolge für das ausgewählte Tier und kann mit der Modellauswahl auf Basis der geladenen Daten fortfahren.',
    dataImpact: 'Liest Provider- und TierConfiguration-Datensätze, ohne persistierten Zustand zu verändern.',
    uiImpact: 'Provider-Dropdowns, Tier-Badges und Leerzustandsmeldungen werden für das ausgewählte Tier aktualisiert.',
    acceptanceCriteria: [
      'Die Provider-Liste respektiert den gespeicherten orderIndex für das ausgewählte Tier.',
      'Das Widget zeigt einen klaren Leerzustand, wenn keine Provider konfiguriert sind.',
      'Nicht autorisierte Benutzer können die Provider-Reihenfolge im Widget nicht bearbeiten.',
    ],
  },
  'F-02': {
    name: 'Modellkatalog-Abruf',
    purpose: 'Lädt provider-spezifische Modelle mit Tier- und Kosten-Metadaten, damit Benutzer für jede Umgebung ein geeignetes Laufzeitziel auswählen können.',
    actors: 'Authentifizierter Entwickler, Modellkatalog-API.',
    trigger: 'Der Benutzer wählt einen Provider aus oder öffnet den Bereich zur Modellauswahl.',
    preconditions: 'Eine gültige providerId existiert und der anfragende Benutzer darf Modell-Metadaten für diesen Tenant einsehen.',
    mainFlow: [
      'Das Widget fordert den Modellkatalog für den ausgewählten Provider an.',
      'Das Backend liefert Modellnamen, Preis-Metadaten, Free-Tier-Flags und Fähigkeitszusammenfassungen zurück.',
      'Die UI rendert eine Modellliste, die Free-Modelle vor der Auswahl klar von kostenpflichtigen Modellen unterscheidet.',
    ],
    alternateFlows: [
      'Wenn der Provider unbekannt ist, liefert die API Not Found und das Widget leert die aktuelle Modellauswahl.',
      'Wenn der Modellservice vorübergehend nicht verfügbar ist, zeigt das Widget eine Wiederholen-Aktion an, ohne gespeicherte Einstellungen zu verändern.',
    ],
    postconditions: 'Der Benutzer kann aus dem zuletzt bekannten Modellsatz für den aktiven Provider auswählen.',
    dataImpact: 'Liest Model-Datensätze und verknüpfte Provider-Metadaten, ohne die Konfiguration zu ändern.',
    uiImpact: 'Modell-Dropdown-Optionen, Preis-Badges und Warnhinweise werden für den ausgewählten Provider aktualisiert.',
    acceptanceCriteria: [
      'Das Widget zeigt nur Modelle an, die zum ausgewählten Provider gehören.',
      'Free- und kostenpflichtige Modelle sind in der UI klar gekennzeichnet.',
      'Ein vorübergehender Katalogfehler löscht nicht die zuletzt gespeicherte Konfiguration.',
    ],
  },
  'F-03': {
    name: 'Tier-Konfigurationsspeicherung',
    purpose: 'Persistiert Tier-spezifische Provider-Reihenfolgen, damit das Laufzeit-Fallback über Widget-Sitzungen und Deployments hinweg deterministisch bleibt.',
    actors: 'Administrator, Backend-Konfigurationsservice, Audit-Logger.',
    trigger: 'Ein Administrator speichert die Provider-Reihenfolge für ein Tier.',
    preconditions: 'Die Nutzlast enthält eine nicht-leere Provider-Reihenfolge und der Benutzer besitzt Administratorrechte.',
    mainFlow: [
      'Das Backend validiert die übermittelte Provider-Reihenfolge und Free-Tier-Einschränkungen.',
      'Der Konfigurationsservice schreibt die aktualisierten TierConfiguration-Datensätze innerhalb einer Transaktion.',
      'Das Audit-Log zeichnet die Änderung auf und die API liefert die persistierte Reihenfolge an das Widget zurück.',
    ],
    alternateFlows: [
      'Wenn doppelte orderIndex-Werte übermittelt werden, schlägt die Validierung fehl und die vorherige Reihenfolge bleibt unverändert.',
      'Wenn der Speicherzugriff ein Timeout erreicht, rollt die Transaktion zurück und das Widget zeigt eine Wiederholen-Meldung an.',
    ],
    postconditions: 'Die gespeicherte Provider-Reihenfolge ist dauerhaft verfügbar und steht nachfolgenden Laufzeit-Fallback-Anfragen zur Verfügung.',
    dataImpact: 'Erstellt oder aktualisiert TierConfiguration-Zeilen und Audit-Log-Einträge nach erfolgreicher Validierung.',
    uiImpact: 'Die Admin-Ansicht bestätigt die gespeicherte Reihenfolge und entfernt Warnungen zu ungespeicherten Änderungen.',
    acceptanceCriteria: [
      'Das Speichern einer gültigen Provider-Reihenfolge persistiert exakt die übermittelte Reihenfolge.',
      'Ungültige Ordnungsversuche erzeugen keine Teil-Schreibvorgänge.',
      'Für jede erfolgreiche Tier-Konfigurationsänderung wird ein Audit-Eintrag aufgezeichnet.',
    ],
  },
  'F-04': {
    name: 'Fallback-Reihenfolge-Engine',
    purpose: 'Wechselt zum nächsten konfigurierten Provider, wenn eine Rate-Limit-Antwort den aktuellen Laufzeitpfad blockiert, und bewahrt dabei deterministische Grenzen für das Wiederholungsverhalten.',
    actors: 'Laufzeit-Request-Router, Provider-Gateway, Entwickler mit Blick auf den Laufzeitstatus.',
    trigger: 'Der aktive Provider liefert während einer Inferenzanfrage HTTP 429 zurück.',
    preconditions: 'Eine Tier-spezifische Provider-Reihenfolge existiert und die aktuelle Anfrage hat die maximale Wechselanzahl noch nicht ausgeschöpft.',
    mainFlow: [
      'Der Router klassifiziert den Provider-Fehler als Rate-Limit-berechtigt für ein Fallback.',
      'Der nächste Provider in der konfigurierten Reihenfolge wird für denselben Anfragekontext ausgewählt.',
      'Das System wiederholt die Anfrage höchstens einmal pro Provider, bis das Wechsel-Limit erreicht ist oder ein Provider erfolgreich antwortet.',
    ],
    alternateFlows: [
      'Wenn kein weiterer Provider existiert, liefert die Laufzeit einen Degraded-Mode-Fehler an den Aufrufer zurück.',
      'Wenn das Wechsel-Limit erreicht ist, beendet der Router weitere Wiederholungen und protokolliert die ausgeschöpfte Fallback-Kette.',
    ],
    postconditions: 'Die Anfrage wird entweder über einen alternativen Provider erfolgreich abgeschlossen oder mit einem expliziten Fallback-exhausted-Status beendet.',
    dataImpact: 'Schreibt Laufzeit-Diagnostik und Fallback-Telemetrie pro Anfrage, ohne die Tier-Konfiguration zu verändern.',
    uiImpact: 'Betriebsstatus-Ansichten zeigen an, welcher Provider die Anfrage verarbeitet hat und ob ein Fallback stattgefunden hat.',
    acceptanceCriteria: [
      'Eine 429-Antwort löst die Auswahl des nächsten konfigurierten Providers in der richtigen Reihenfolge aus.',
      'Der Router stoppt nach der konfigurierten maximalen Anzahl von Provider-Wechseln.',
      'Die Fallback-Telemetrie zeichnet jeden versuchten Provider für die Anfrage auf.',
    ],
  },
  'F-05': {
    name: 'Theme-Anpassungsoberfläche',
    purpose: 'Ermöglicht Administratoren, Widget-Farben und Typografie anzupassen, ohne Tier-Auswahl- oder Provider-Konfigurations-Workflows zu beschädigen.',
    actors: 'Administrator, eingebettete Widget-UI, Theme-Settings-API.',
    trigger: 'Der Administrator bearbeitet Theme-Werte und bestätigt die Änderungen.',
    preconditions: 'Der Benutzer darf Theme-Einstellungen bearbeiten und die übermittelten Werte bestehen die Validierung.',
    mainFlow: [
      'Das Widget validiert die vorgeschlagenen Theme-Werte, bevor es sie an das Backend sendet.',
      'Das Backend persistiert die freigegebene Theme-Konfiguration für das aktuelle Konto.',
      'Das Widget rendert sich mit den gespeicherten Theme-Variablen neu und bestätigt die Änderung.',
    ],
    alternateFlows: [
      'Wenn ein übermitteltes Farbtokenelement ungültig ist, blockiert die Validierung die Persistenz und markiert das fehlerhafte Feld.',
      'Wenn die Persistenz fehlschlägt, stellt das Widget die vorherige Theme-Vorschau wieder her und zeigt eine Fehlerbenachrichtigung an.',
    ],
    postconditions: 'Das gespeicherte Theme steht beim nächsten Widget-Ladevorgang für dasselbe Konto wieder zur Verfügung.',
    dataImpact: 'Aktualisiert WidgetSettings.themeName und ThemeSettings-Tokens für das authentifizierte Konto.',
    uiImpact: 'Buttons, Badges und Container-Styling werden unmittelbar nach einem erfolgreichen Speichern aktualisiert.',
    acceptanceCriteria: [
      'Gültige Theme-Änderungen bleiben nach einem Browser-Refresh erhalten.',
      'Ungültige Theme-Werte überschreiben das zuvor gespeicherte Theme nicht.',
      'Die Widget-Vorschau aktualisiert sich erst, nachdem das Backend ein erfolgreiches Speichern bestätigt hat.',
    ],
  },
  'F-06': {
    name: 'Modellauswahl-Persistenz',
    purpose: 'Persistiert das ausgewählte Standardmodell pro Tier, damit jede Umgebung nach einem Reload mit dem erwarteten Routing-Ziel fortsetzt.',
    actors: 'Authentifizierter Entwickler, Backend-Settings-API.',
    trigger: 'Der Benutzer speichert das gewählte Standardmodell für ein Tier.',
    preconditions: 'Das ausgewählte Modell gehört zum gewählten Provider und der Benutzer darf Widget-Einstellungen bearbeiten.',
    mainFlow: [
      'Das Widget übermittelt das gewählte Standardmodell und den Provider-Kontext für das aktive Tier.',
      'Das Backend validiert, dass das Modell zum ausgewählten Provider und zur Tier-Policy gehört.',
      'Die persistierten Widget-Einstellungen werden an die UI zurückgegeben und werden zur neuen Standardauswahl.',
    ],
    alternateFlows: [
      'Wenn das Modell für den ausgewählten Provider ungültig ist, schlägt das Speichern fehl und der vorherige Standard bleibt aktiv.',
      'Wenn die Anfrage ein Timeout erreicht, zeigt das Widget eine Wiederholen-Aktion an, ohne die aktuelle lokale Auswahl zu verwerfen.',
    ],
    postconditions: 'Das gespeicherte Standardmodell wird beim nächsten Widget-Ladevorgang für denselben Benutzerkontext automatisch wiederhergestellt.',
    dataImpact: 'Aktualisiert WidgetSettings.selectedModelId, WidgetSettings.defaultTier und die Referenz auf die aktive Provider-Reihenfolge nach erfolgreicher Validierung.',
    uiImpact: 'Der Modellselektor zeigt das gespeicherte Standardmodell an und entfernt Hinweise auf ungespeicherte Änderungen.',
    acceptanceCriteria: [
      'Ein Seiten-Refresh stellt das gespeicherte Standardmodell für das aktive Tier wieder her.',
      'Das Speichern eines ungültigen Modells lässt die zuvor persistierte Auswahl unverändert.',
      'Die UI zeigt eine Erfolgsmeldung erst an, nachdem die Persistenz erfolgreich war.',
    ],
  },
};

const DE_FEATURE_SECTION_HEADINGS = {
  purpose: '1. Zweck',
  actors: '2. Akteure',
  trigger: '3. Auslöser',
  preconditions: '4. Vorbedingungen',
  mainFlow: '5. Hauptablauf',
  alternateFlows: '6. Alternativabläufe',
  postconditions: '7. Nachbedingungen',
  dataImpact: '8. Datenauswirkungen',
  uiImpact: '9. UI-Auswirkungen',
  acceptanceCriteria: '10. Akzeptanzkriterien',
} as const;

function featureForLanguage(feature: GoldSetFeature, language: SupportedLanguage): GoldSetFeature {
  if (language !== 'de') return feature;
  const translated = DE_FEATURE_TRANSLATIONS[feature.id];
  if (!translated) return feature;

  return {
    ...feature,
    ...translated,
    mainFlow: translated.mainFlow ? [...translated.mainFlow] : [...feature.mainFlow],
    alternateFlows: translated.alternateFlows ? [...translated.alternateFlows] : [...feature.alternateFlows],
    acceptanceCriteria: translated.acceptanceCriteria ? [...translated.acceptanceCriteria] : [...feature.acceptanceCriteria],
  };
}

function renderFeature(feature: GoldSetFeature, language: SupportedLanguage): string {
  const headings = language === 'de'
    ? DE_FEATURE_SECTION_HEADINGS
    : {
      purpose: '1. Purpose',
      actors: '2. Actors',
      trigger: '3. Trigger',
      preconditions: '4. Preconditions',
      mainFlow: '5. Main Flow',
      alternateFlows: '6. Alternate Flows',
      postconditions: '7. Postconditions',
      dataImpact: '8. Data Impact',
      uiImpact: '9. UI Impact',
      acceptanceCriteria: '10. Acceptance Criteria',
    };
  return [
    `### ${feature.id}: ${feature.name}`,
    '',
    headings.purpose,
    feature.purpose,
    '',
    headings.actors,
    feature.actors,
    '',
    headings.trigger,
    feature.trigger,
    '',
    headings.preconditions,
    feature.preconditions,
    '',
    headings.mainFlow,
    ...feature.mainFlow.map(step => `- ${step}`),
    '',
    headings.alternateFlows,
    ...feature.alternateFlows.map(step => `- ${step}`),
    '',
    headings.postconditions,
    feature.postconditions,
    '',
    headings.dataImpact,
    feature.dataImpact,
    '',
    headings.uiImpact,
    feature.uiImpact,
    '',
    headings.acceptanceCriteria,
    ...feature.acceptanceCriteria.map(step => `- ${step}`),
    '',
  ].join('\n');
}

export function buildGoldSetPrd(params?: {
  language?: SupportedLanguage;
  featureCount?: number;
}): string {
  const language = params?.language || 'en';
  const sections = sectionsForLanguage(language);
  const requestedFeatureCount = params?.featureCount !== undefined ? params.featureCount : BASE_FEATURES.length;
  const features = BASE_FEATURES
    .slice(0, Math.max(0, requestedFeatureCount))
    .map(feature => featureForLanguage(feature, language));

  return [
    '# LLM Widget',
    '',
    '## System Vision',
    sections.systemVision,
    '',
    '## System Boundaries',
    sections.systemBoundaries,
    '',
    '## Domain Model',
    sections.domainModel,
    '',
    '## Global Business Rules',
    sections.globalBusinessRules,
    '',
    '## Functional Feature Catalogue',
    '',
    ...features.map(feature => renderFeature(feature, language)),
    '## Non-Functional Requirements',
    sections.nonFunctional,
    '',
    '## Error Handling & Recovery',
    sections.errorHandling,
    '',
    '## Deployment & Infrastructure',
    sections.deployment,
    '',
    '## Definition of Done',
    sections.definitionOfDone,
    '',
    '## Out of Scope',
    sections.outOfScope,
    '',
    '## Timeline & Milestones',
    sections.timeline,
    '',
    '## Success Criteria & Acceptance Testing',
    sections.successCriteria,
    '',
  ].join('\n');
}

export function replaceSectionBody(content: string, heading: string, body: string): string {
  const marker = `## ${heading}`;
  const start = content.indexOf(marker);
  if (start < 0) return content;
  const nextHeading = content.indexOf('\n## ', start + marker.length);
  const prefix = content.slice(0, start);
  const suffix = nextHeading >= 0 ? content.slice(nextHeading) : '';
  return `${prefix}${marker}\n\n${body.trim()}\n${suffix}`;
}

export function replaceFeatureBlock(content: string, featureId: string, body: string): string {
  const headingPattern = new RegExp(`###\\s+${featureId.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}:\\s+[^\\n]+`);
  const match = content.match(headingPattern);
  if (!match || match.index === undefined) return content;

  const start = match.index;
  const nextFeature = content.indexOf('\n### F-', start + match[0].length);
  const nextSection = content.indexOf('\n## ', start + match[0].length);
  const nextBoundary = [nextFeature, nextSection].filter(index => index >= 0).sort((a, b) => a - b)[0] ?? content.length;
  const prefix = content.slice(0, start);
  const suffix = content.slice(nextBoundary);
  return `${prefix}${body.trimEnd()}\n${suffix}`;
}

export function renameFeature(content: string, featureId: string, nextName: string): string {
  const pattern = new RegExp(`(###\\s+${featureId.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}:\\s+)([^\\n]+)`);
  return content.replace(pattern, `$1${nextName}`);
}

export function buildBoilerplateFeatureBlock(featureId: string, featureName: string): string {
  const repeatedPurpose = 'This feature provides a comprehensive and fully integrated solution for managing critical workflows across the entire platform ecosystem with enterprise-grade reliability.';
  const repeatedDataImpact = 'The operation reads and writes only the entities directly within scope of this specific feature boundary.';
  const repeatedUiImpact = 'The interface transitions through loading, success, and error states with clear visual indicators.';
  const repeatedAcceptance = 'Error paths provide clear user feedback and keep state consistent.';

  return [
    `### ${featureId}: ${featureName}`,
    '',
    '1. Purpose',
    repeatedPurpose,
    '',
    '2. Actors',
    'Primary: end user invoking the workflow. Secondary: backend orchestration services.',
    '',
    '3. Trigger',
    'The user initiates the workflow through the primary widget interface.',
    '',
    '4. Preconditions',
    'Required inputs are present and validated before execution.',
    '',
    '5. Main Flow',
    '- The system receives the request and validates input.',
    '- Business logic executes deterministically according to specification.',
    '- Relevant data is created or updated atomically.',
    '- UI reflects completion and confirms success.',
    '',
    '6. Alternate Flows',
    '- Validation failure returns a clear error and performs no partial write.',
    '- Transient failure is logged and a retry path is offered.',
    '',
    '7. Postconditions',
    'After successful completion the resulting system state is consistent, persisted, and available for all downstream consumers.',
    '',
    '8. Data Impact',
    repeatedDataImpact,
    '',
    '9. UI Impact',
    repeatedUiImpact,
    '',
    '10. Acceptance Criteria',
    '- This feature provides a comprehensive and fully integrated solution for managing critical workflows across the entire platform ecosystem with enterprise-grade reliability.',
    `- ${repeatedAcceptance}`,
    '- Data mutations are observable after execution.',
    '',
  ].join('\n');
}

export function compileGoldSetPrd(
  rawContent: string,
  options?: Partial<CompilePrdOptions>
): CompilePrdResult {
  return compilePrdDocument(rawContent, {
    mode: 'generate',
    language: 'en',
    strictCanonical: true,
    strictLanguageConsistency: true,
    enableFeatureAggregation: true,
    ...options,
  });
}
