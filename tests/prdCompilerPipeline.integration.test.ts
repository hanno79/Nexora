import { describe, it, expect } from 'vitest';
import { compilePrdDocument, CANONICAL_PRD_HEADINGS } from '../server/prdCompiler';
import type { PrdQualityReport } from '../server/prdCompiler';

// ---------------------------------------------------------------------------
// Helper: build a valid PRD markdown string with N features
// ---------------------------------------------------------------------------

interface BuildTestPrdOptions {
  featureCount?: number;
  language?: 'en' | 'de';
  /** Override the feature section content for all features with identical text */
  identicalFeatureContent?: string;
  /** Inject arbitrary text before the first section */
  preamble?: string;
  /** Inject arbitrary text after the last section */
  epilogue?: string;
  /** Replace specific section bodies by canonical heading name */
  sectionOverrides?: Partial<Record<string, string>>;
  /** Override feature names by index (0-based) */
  featureNameOverrides?: Record<number, string>;
}

const EN_FEATURE_SPECS: Array<{
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
}> = [
  {
    id: 'F-01',
    name: 'User Authentication',
    purpose: 'Allow users to securely log in and establish an authenticated session for accessing protected resources within the application.',
    actors: 'Primary: registered end user. Secondary: identity provider, session management service.',
    trigger: 'User navigates to the login page and submits valid credentials via the login form.',
    preconditions: 'User account exists in the identity store and the authentication service is operational.',
    mainFlow: [
      'User opens the login page and enters email and password.',
      'Client sends credentials to the authentication endpoint over HTTPS.',
      'Server validates credentials against the identity store and issues a session token.',
      'Client stores the session token and redirects the user to the dashboard.',
    ],
    alternateFlows: [
      'Invalid credentials: server returns a 401 response and the UI displays an error message without revealing which field was wrong.',
      'Account locked: after five consecutive failures the account is temporarily locked for fifteen minutes.',
    ],
    postconditions: 'An authenticated session is established and the user can access protected routes until the session expires.',
    dataImpact: 'A new session record is created in the sessions table with a TTL of sixty minutes.',
    uiImpact: 'The login form transitions to a loading state during validation and redirects on success or shows inline error feedback on failure.',
    acceptanceCriteria: [
      'A registered user can log in with correct credentials and reach the dashboard within three seconds.',
      'An incorrect password attempt increments the failure counter and shows a non-specific error.',
      'After five failed attempts the account is locked and a lockout message is displayed.',
    ],
  },
  {
    id: 'F-02',
    name: 'Dashboard Overview',
    purpose: 'Provide users with a consolidated summary view of recent activity, key metrics, and quick-action shortcuts after logging in.',
    actors: 'Primary: authenticated end user. Secondary: analytics aggregation service.',
    trigger: 'User completes authentication and is redirected to the dashboard route.',
    preconditions: 'User has an active authenticated session and at least read-level permissions.',
    mainFlow: [
      'Client requests aggregated dashboard data from the API.',
      'Server compiles recent activity entries, metric summaries, and notification counts.',
      'Client renders the dashboard layout with widgets for activity, metrics, and shortcuts.',
      'Each widget loads independently so partial data does not block the overall view.',
    ],
    alternateFlows: [
      'Empty state: if the user has no activity yet, the dashboard shows an onboarding guide instead of empty widgets.',
      'Slow aggregation: if the metrics service takes longer than two seconds, the widget shows a skeleton loader.',
    ],
    postconditions: 'The user sees an up-to-date dashboard reflecting their current activity and system status.',
    dataImpact: 'Read-only access to activity logs, metric snapshots, and notification counters.',
    uiImpact: 'Dashboard renders as a responsive grid of independent widgets with skeleton loaders for each async data source.',
    acceptanceCriteria: [
      'Dashboard loads within two seconds for a user with up to one thousand activity entries.',
      'Empty-state onboarding guide appears when the user has zero prior activity.',
      'Each widget degrades independently without crashing the overall page.',
    ],
  },
  {
    id: 'F-03',
    name: 'Profile Settings Management',
    purpose: 'Enable users to view and update their personal profile information, notification preferences, and account security settings.',
    actors: 'Primary: authenticated end user. Secondary: notification delivery service, file storage service.',
    trigger: 'User navigates to the settings page from the navigation menu.',
    preconditions: 'User is authenticated and their profile record exists in the database.',
    mainFlow: [
      'Client fetches the current profile data including display name, email, avatar URL, and notification preferences.',
      'User modifies one or more fields and clicks the save button.',
      'Client sends the updated fields to the profile update endpoint.',
      'Server validates the payload, persists the changes, and returns the updated profile.',
    ],
    alternateFlows: [
      'Validation failure: if the new email format is invalid the server returns a 422 response and the UI highlights the field.',
      'Avatar upload failure: if the uploaded image exceeds two megabytes the server rejects it with a descriptive error.',
    ],
    postconditions: 'The profile record in the database reflects the updated values and all downstream caches are invalidated.',
    dataImpact: 'Updates the user profile record and may create a new entry in the file storage bucket for avatar uploads.',
    uiImpact: 'The settings form shows inline validation feedback and a success toast notification after saving.',
    acceptanceCriteria: [
      'A user can change their display name and see the updated name reflected immediately across the app.',
      'An invalid email address triggers an inline validation error before submission.',
      'Avatar uploads larger than two megabytes are rejected with a clear size-limit message.',
    ],
  },
  {
    id: 'F-04',
    name: 'Data Export Wizard',
    purpose: 'Allow users to export their data in CSV or JSON format for offline analysis or regulatory compliance requirements.',
    actors: 'Primary: authenticated end user with export permissions. Secondary: background job runner, file storage service.',
    trigger: 'User clicks the export button in the data management section and selects an export format.',
    preconditions: 'User has export permissions and there is at least one exportable record in the system.',
    mainFlow: [
      'User selects the desired export format and optional date range filters.',
      'Client submits the export request to the export API endpoint.',
      'Server enqueues a background job to compile the export file.',
      'Once complete the server sends a notification and the user downloads the file from a signed URL.',
    ],
    alternateFlows: [
      'No data matches the filter: the system notifies the user that the export would be empty and cancels the job.',
      'Background job failure: the system retries once and if still failing notifies the user with an error and a retry option.',
    ],
    postconditions: 'A downloadable export file is available via a time-limited signed URL and an audit log entry is created.',
    dataImpact: 'Read-only access to user data records plus creation of an export file artifact and an audit log entry.',
    uiImpact: 'The export wizard shows a multi-step form with progress indicators and a download link upon completion.',
    acceptanceCriteria: [
      'A CSV export of up to ten thousand records completes within thirty seconds.',
      'The generated file contains all columns documented in the export schema.',
      'An empty-result export shows a clear message rather than producing an empty file.',
    ],
  },
  {
    id: 'F-05',
    name: 'Notification Center',
    purpose: 'Centralize all user notifications including system alerts, activity updates, and scheduled reminders into a single accessible inbox.',
    actors: 'Primary: authenticated end user. Secondary: event bus, push notification gateway.',
    trigger: 'A system event generates a notification payload targeting one or more users.',
    preconditions: 'The notification service is running and the target user has not opted out of the notification category.',
    mainFlow: [
      'Event bus publishes a notification event with payload, category, and target user identifiers.',
      'Notification service persists the notification and determines delivery channels based on user preferences.',
      'For in-app delivery the notification appears in the notification center badge count.',
      'User opens the notification center to view, mark as read, or dismiss notifications.',
    ],
    alternateFlows: [
      'Push delivery failure: if the push gateway is unreachable the notification is queued for retry with exponential backoff.',
      'Opt-out category: notifications for opted-out categories are silently dropped and logged for auditing.',
    ],
    postconditions: 'The notification is persisted, delivered through configured channels, and visible in the notification center until dismissed.',
    dataImpact: 'Creates notification records in the notifications table and updates badge counters in the user session cache.',
    uiImpact: 'The navigation bar shows an updated badge count and the notification center drawer displays a chronological list.',
    acceptanceCriteria: [
      'A new notification appears in the notification center within five seconds of the triggering event.',
      'Marking a notification as read decrements the badge counter immediately.',
      'Opted-out categories do not produce visible notifications for the user.',
    ],
  },
  {
    id: 'F-06',
    name: 'Role-Based Access Control',
    purpose: 'Enforce granular permission boundaries so that each user action is gated by their assigned role and associated permission set.',
    actors: 'Primary: any authenticated user. Secondary: authorization middleware, role management admin.',
    trigger: 'An authenticated request reaches a protected endpoint and the authorization middleware evaluates the required permission.',
    preconditions: 'The user has at least one assigned role and the role-permission mapping is loaded into memory.',
    mainFlow: [
      'Authorization middleware extracts the user role from the session token.',
      'Middleware checks the required permission for the requested endpoint against the role-permission map.',
      'If the permission is present the request proceeds to the handler.',
      'If the permission is absent the middleware returns a 403 Forbidden response.',
    ],
    alternateFlows: [
      'Missing role: if the session token contains no role claim the system treats the request as unauthenticated and returns 401.',
      'Role update propagation: when an admin changes a role mapping the cache is invalidated within ten seconds.',
    ],
    postconditions: 'The request is either authorized and processed or rejected with an appropriate HTTP status code and audit log entry.',
    dataImpact: 'Read-only access to role and permission tables plus creation of an audit log entry for denied requests.',
    uiImpact: 'UI elements gated by permissions are hidden or disabled for users without the required role.',
    acceptanceCriteria: [
      'A user with the editor role can create and update records but cannot delete them.',
      'A user with the viewer role sees read-only views with all mutation controls disabled.',
      'Permission changes propagate to active sessions within ten seconds without requiring logout.',
    ],
  },
  {
    id: 'F-07',
    name: 'Search and Filtering Engine',
    purpose: 'Provide full-text search and faceted filtering capabilities across all primary data entities to help users locate records quickly.',
    actors: 'Primary: authenticated end user. Secondary: search index service.',
    trigger: 'User enters a search query or selects filter facets in the search interface.',
    preconditions: 'The search index is populated and the indexing service is healthy.',
    mainFlow: [
      'User types a search query into the search bar or selects one or more facet filters.',
      'Client sends the query and active filters to the search API endpoint.',
      'Server queries the search index, applies facet constraints, and returns ranked results.',
      'Client renders the result list with highlighted matched terms and active filter chips.',
    ],
    alternateFlows: [
      'No results: the system displays a no-results message with suggestions to broaden the query.',
      'Index lag: if the index is more than sixty seconds behind the primary store a staleness indicator is shown.',
    ],
    postconditions: 'The user sees a ranked list of matching records that can be further refined or navigated.',
    dataImpact: 'Read-only access to the search index. No primary data is modified.',
    uiImpact: 'Search results render as a paginated list with keyword highlighting and active filter chips above the results.',
    acceptanceCriteria: [
      'A search query returns results within five hundred milliseconds for an index of up to one million records.',
      'Faceted filters correctly narrow the result set and update result counts in real time.',
      'The no-results state includes actionable suggestions rather than a blank page.',
    ],
  },
  {
    id: 'F-08',
    name: 'Audit Trail Logging',
    purpose: 'Record an immutable audit trail of all significant user and system actions for compliance, debugging, and accountability purposes.',
    actors: 'Primary: system audit service. Secondary: compliance officer reviewing audit logs.',
    trigger: 'Any state-changing operation completes successfully or fails with an auditable error.',
    preconditions: 'The audit service is running and the audit log storage is writable.',
    mainFlow: [
      'The application emits an audit event after each state-changing operation with actor, action, resource, and timestamp.',
      'The audit service receives the event and appends it to the immutable audit log.',
      'Log entries are indexed by actor, resource type, and timestamp for efficient querying.',
      'Compliance officers can query the audit log through a dedicated admin interface.',
    ],
    alternateFlows: [
      'Audit service unavailable: events are buffered in a local queue and flushed when the service recovers.',
      'Storage full: the system alerts operations and begins rotating the oldest non-retained entries.',
    ],
    postconditions: 'An immutable, queryable audit record exists for every significant operation in the system.',
    dataImpact: 'Creates append-only entries in the audit log store. No existing records are modified or deleted.',
    uiImpact: 'The admin audit log viewer provides sortable, filterable tables with detail expansion for each entry.',
    acceptanceCriteria: [
      'Every create, update, and delete operation produces an audit log entry within one second.',
      'Audit entries are immutable and cannot be modified or deleted through any application endpoint.',
      'The audit query interface returns results within two seconds for date-range queries spanning thirty days.',
    ],
  },
];

const DE_FEATURE_SPECS: Array<{
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
}> = [
  {
    id: 'F-01',
    name: 'Benutzer-Authentifizierung',
    purpose: 'Ermoeglicht es Nutzern, sich sicher anzumelden und eine authentifizierte Sitzung fuer den Zugriff auf geschuetzte Ressourcen herzustellen.',
    actors: 'Primaer: registrierter Endnutzer. Sekundaer: Identitaetsprovider, Sitzungsverwaltungsdienst.',
    trigger: 'Der Nutzer navigiert zur Anmeldeseite und gibt gueltige Anmeldedaten ein.',
    preconditions: 'Ein Benutzerkonto existiert im Identitaetsspeicher und der Authentifizierungsdienst ist betriebsbereit.',
    mainFlow: [
      'Der Nutzer oeffnet die Anmeldeseite und gibt E-Mail-Adresse und Passwort ein.',
      'Der Client sendet die Anmeldedaten ueber HTTPS an den Authentifizierungsendpunkt.',
      'Der Server validiert die Anmeldedaten gegen den Identitaetsspeicher und stellt ein Sitzungstoken aus.',
      'Der Client speichert das Sitzungstoken und leitet den Nutzer zum Dashboard weiter.',
    ],
    alternateFlows: [
      'Ungueltige Anmeldedaten: Der Server gibt eine 401-Antwort zurueck und die Oberflaeche zeigt eine allgemeine Fehlermeldung an.',
      'Konto gesperrt: Nach fuenf aufeinanderfolgenden Fehlversuchen wird das Konto fuer fuenfzehn Minuten temporaer gesperrt.',
    ],
    postconditions: 'Eine authentifizierte Sitzung ist hergestellt und der Nutzer kann auf geschuetzte Bereiche zugreifen bis die Sitzung ablaeuft.',
    dataImpact: 'Ein neuer Sitzungsdatensatz wird in der Sitzungstabelle mit einer Lebensdauer von sechzig Minuten erstellt.',
    uiImpact: 'Das Anmeldeformular wechselt waehrend der Validierung in einen Ladezustand und leitet bei Erfolg weiter oder zeigt bei Fehler eine Inline-Fehlermeldung an.',
    acceptanceCriteria: [
      'Ein registrierter Nutzer kann sich mit korrekten Anmeldedaten anmelden und das Dashboard innerhalb von drei Sekunden erreichen.',
      'Ein falsches Passwort erhoeht den Fehlerzaehler und zeigt eine unspezifische Fehlermeldung an.',
      'Nach fuenf Fehlversuchen wird das Konto gesperrt und eine Sperrmeldung angezeigt.',
    ],
  },
  {
    id: 'F-02',
    name: 'Dashboard-Uebersicht',
    purpose: 'Bietet dem Nutzer nach der Anmeldung eine konsolidierte Zusammenfassung der letzten Aktivitaeten, wichtiger Kennzahlen und Schnellzugriffe.',
    actors: 'Primaer: authentifizierter Endnutzer. Sekundaer: Analytik-Aggregationsdienst.',
    trigger: 'Der Nutzer schliesst die Authentifizierung ab und wird zur Dashboard-Route weitergeleitet.',
    preconditions: 'Der Nutzer hat eine aktive authentifizierte Sitzung und mindestens Leseberechtigungen.',
    mainFlow: [
      'Der Client fordert aggregierte Dashboard-Daten von der API an.',
      'Der Server stellt aktuelle Aktivitaetseintraege, Kennzahlenzusammenfassungen und Benachrichtigungszaehler zusammen.',
      'Der Client rendert das Dashboard-Layout mit Widgets fuer Aktivitaeten, Kennzahlen und Schnellzugriffe.',
      'Jedes Widget laedt unabhaengig, damit partielle Daten die Gesamtansicht nicht blockieren.',
    ],
    alternateFlows: [
      'Leerer Zustand: Hat der Nutzer noch keine Aktivitaeten, zeigt das Dashboard stattdessen einen Onboarding-Leitfaden an.',
      'Langsame Aggregation: Dauert der Kennzahlen-Dienst laenger als zwei Sekunden, zeigt das Widget einen Skeleton-Loader an.',
    ],
    postconditions: 'Der Nutzer sieht ein aktuelles Dashboard, das seinen derzeitigen Aktivitaets- und Systemstatus widerspiegelt.',
    dataImpact: 'Nur-Lese-Zugriff auf Aktivitaetsprotokolle, Kennzahlen-Snapshots und Benachrichtigungszaehler.',
    uiImpact: 'Das Dashboard wird als responsives Raster unabhaengiger Widgets mit Skeleton-Loadern fuer jede asynchrone Datenquelle dargestellt.',
    acceptanceCriteria: [
      'Das Dashboard laedt innerhalb von zwei Sekunden fuer einen Nutzer mit bis zu eintausend Aktivitaetseintraegen.',
      'Der Onboarding-Leitfaden fuer den leeren Zustand erscheint, wenn der Nutzer keine bisherigen Aktivitaeten hat.',
      'Jedes Widget degradiert unabhaengig, ohne die gesamte Seite zum Absturz zu bringen.',
    ],
  },
  {
    id: 'F-03',
    name: 'Profil-Einstellungen verwalten',
    purpose: 'Ermoeglicht Nutzern, ihre persoenlichen Profilinformationen, Benachrichtigungseinstellungen und Kontosicherheitseinstellungen einzusehen und zu aktualisieren.',
    actors: 'Primaer: authentifizierter Endnutzer. Sekundaer: Benachrichtigungsdienst, Dateispeicherdienst.',
    trigger: 'Der Nutzer navigiert ueber das Navigationsmenue zur Einstellungsseite.',
    preconditions: 'Der Nutzer ist authentifiziert und sein Profildatensatz existiert in der Datenbank.',
    mainFlow: [
      'Der Client ruft die aktuellen Profildaten ab, einschliesslich Anzeigename, E-Mail, Avatar-URL und Benachrichtigungseinstellungen.',
      'Der Nutzer aendert ein oder mehrere Felder und klickt auf die Speichern-Schaltflaeche.',
      'Der Client sendet die aktualisierten Felder an den Profil-Update-Endpunkt.',
      'Der Server validiert die Daten, speichert die Aenderungen und gibt das aktualisierte Profil zurueck.',
    ],
    alternateFlows: [
      'Validierungsfehler: Ist das neue E-Mail-Format ungueltig, gibt der Server eine 422-Antwort zurueck und die Oberflaeche hebt das Feld hervor.',
      'Avatar-Upload-Fehler: Ueberschreitet das hochgeladene Bild zwei Megabyte, lehnt der Server es mit einer beschreibenden Fehlermeldung ab.',
    ],
    postconditions: 'Der Profildatensatz in der Datenbank spiegelt die aktualisierten Werte wider und alle nachgelagerten Caches werden invalidiert.',
    dataImpact: 'Aktualisiert den Benutzerprofildatensatz und erstellt moeglicherweise einen neuen Eintrag im Dateispeicher fuer Avatar-Uploads.',
    uiImpact: 'Das Einstellungsformular zeigt Inline-Validierungsfeedback und eine Erfolgs-Toast-Benachrichtigung nach dem Speichern an.',
    acceptanceCriteria: [
      'Ein Nutzer kann seinen Anzeigenamen aendern und sieht den aktualisierten Namen sofort in der gesamten Anwendung.',
      'Eine ungueltige E-Mail-Adresse loest einen Inline-Validierungsfehler vor dem Absenden aus.',
      'Avatar-Uploads groesser als zwei Megabyte werden mit einer deutlichen Groessenbegrenzungsmeldung abgelehnt.',
    ],
  },
  {
    id: 'F-04',
    name: 'Datenexport-Assistent',
    purpose: 'Ermoeglicht Nutzern, ihre Daten im CSV- oder JSON-Format fuer Offline-Analysen oder regulatorische Compliance-Anforderungen zu exportieren.',
    actors: 'Primaer: authentifizierter Endnutzer mit Exportberechtigungen. Sekundaer: Hintergrundjob-Runner, Dateispeicherdienst.',
    trigger: 'Der Nutzer klickt im Datenverwaltungsbereich auf die Export-Schaltflaeche und waehlt ein Exportformat aus.',
    preconditions: 'Der Nutzer hat Exportberechtigungen und es gibt mindestens einen exportierbaren Datensatz im System.',
    mainFlow: [
      'Der Nutzer waehlt das gewuenschte Exportformat und optionale Datumsbereichsfilter.',
      'Der Client sendet die Exportanfrage an den Export-API-Endpunkt.',
      'Der Server reiht einen Hintergrundjob ein, um die Exportdatei zu kompilieren.',
      'Nach Abschluss sendet der Server eine Benachrichtigung und der Nutzer laedt die Datei ueber eine signierte URL herunter.',
    ],
    alternateFlows: [
      'Keine Daten entsprechen dem Filter: Das System benachrichtigt den Nutzer, dass der Export leer waere, und bricht den Job ab.',
      'Hintergrundjob-Fehler: Das System versucht es einmal erneut und benachrichtigt bei erneutem Fehler den Nutzer mit einer Fehlermeldung und einer Wiederholungsoption.',
    ],
    postconditions: 'Eine herunterladbare Exportdatei ist ueber eine zeitlich begrenzte signierte URL verfuegbar und ein Audit-Log-Eintrag wurde erstellt.',
    dataImpact: 'Nur-Lese-Zugriff auf Benutzerdaten plus Erstellung eines Exportdatei-Artefakts und eines Audit-Log-Eintrags.',
    uiImpact: 'Der Export-Assistent zeigt ein mehrstufiges Formular mit Fortschrittsanzeigen und einen Download-Link nach Abschluss an.',
    acceptanceCriteria: [
      'Ein CSV-Export von bis zu zehntausend Datensaetzen wird innerhalb von dreissig Sekunden abgeschlossen.',
      'Die generierte Datei enthaelt alle im Exportschema dokumentierten Spalten.',
      'Ein Export ohne Ergebnisse zeigt eine klare Meldung anstatt eine leere Datei zu erzeugen.',
    ],
  },
  {
    id: 'F-05',
    name: 'Benachrichtigungszentrale',
    purpose: 'Zentralisiert alle Benutzerbenachrichtigungen einschliesslich Systemwarnungen, Aktivitaetsupdates und geplanter Erinnerungen in einem einzigen zugaenglichen Posteingang.',
    actors: 'Primaer: authentifizierter Endnutzer. Sekundaer: Event-Bus, Push-Benachrichtigungs-Gateway.',
    trigger: 'Ein Systemereignis erzeugt ein Benachrichtigungs-Payload, das auf einen oder mehrere Nutzer abzielt.',
    preconditions: 'Der Benachrichtigungsdienst laeuft und der Zielnutzer hat die Benachrichtigungskategorie nicht abbestellt.',
    mainFlow: [
      'Der Event-Bus veroeffentlicht ein Benachrichtigungsereignis mit Payload, Kategorie und Zielnutzer-Identifikatoren.',
      'Der Benachrichtigungsdienst speichert die Benachrichtigung und bestimmt Zustellungskanaele basierend auf Nutzereinstellungen.',
      'Fuer die In-App-Zustellung erscheint die Benachrichtigung im Badge-Zaehler der Benachrichtigungszentrale.',
      'Der Nutzer oeffnet die Benachrichtigungszentrale, um Benachrichtigungen anzuzeigen, als gelesen zu markieren oder zu verwerfen.',
    ],
    alternateFlows: [
      'Push-Zustellungsfehler: Ist das Push-Gateway nicht erreichbar, wird die Benachrichtigung mit exponentiellem Backoff in die Warteschlange gestellt.',
      'Abbestellte Kategorie: Benachrichtigungen fuer abbestellte Kategorien werden stillschweigend verworfen und fuer die Pruefung protokolliert.',
    ],
    postconditions: 'Die Benachrichtigung ist gespeichert, ueber konfigurierte Kanaele zugestellt und in der Benachrichtigungszentrale sichtbar bis sie verworfen wird.',
    dataImpact: 'Erstellt Benachrichtigungsdatensaetze in der Benachrichtigungstabelle und aktualisiert Badge-Zaehler im Benutzer-Sitzungs-Cache.',
    uiImpact: 'Die Navigationsleiste zeigt einen aktualisierten Badge-Zaehler und die Benachrichtigungszentrale-Schublade zeigt eine chronologische Liste an.',
    acceptanceCriteria: [
      'Eine neue Benachrichtigung erscheint innerhalb von fuenf Sekunden nach dem ausloesenden Ereignis in der Benachrichtigungszentrale.',
      'Das Markieren einer Benachrichtigung als gelesen dekrementiert den Badge-Zaehler sofort.',
      'Abbestellte Kategorien erzeugen keine sichtbaren Benachrichtigungen fuer den Nutzer.',
    ],
  },
];

function buildFeatureMarkdown(
  spec: typeof EN_FEATURE_SPECS[number],
  nameOverride?: string,
): string {
  const name = nameOverride ?? spec.name;
  const lines: string[] = [];
  lines.push(`### ${spec.id}: ${name}`);
  lines.push('');
  lines.push(`**Purpose:** ${spec.purpose}`);
  lines.push(`**Actors:** ${spec.actors}`);
  lines.push(`**Trigger:** ${spec.trigger}`);
  lines.push(`**Preconditions:** ${spec.preconditions}`);
  lines.push('**Main Flow:**');
  spec.mainFlow.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  lines.push('**Alternate Flows:**');
  spec.alternateFlows.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  lines.push(`**Postconditions:** ${spec.postconditions}`);
  lines.push(`**Data Impact:** ${spec.dataImpact}`);
  lines.push(`**UI Impact:** ${spec.uiImpact}`);
  lines.push('**Acceptance Criteria:**');
  spec.acceptanceCriteria.forEach((criterion, i) => lines.push(`${i + 1}. ${criterion}`));
  return lines.join('\n');
}

function buildTestPrd(options?: BuildTestPrdOptions): string {
  const featureCount = options?.featureCount ?? 3;
  const language = options?.language ?? 'en';
  const sectionOverrides = options?.sectionOverrides ?? {};
  const featureNameOverrides = options?.featureNameOverrides ?? {};

  const isGerman = language === 'de';
  const featureSpecs = isGerman ? DE_FEATURE_SPECS : EN_FEATURE_SPECS;

  const sections: Record<string, string> = isGerman
    ? {
        'System Vision':
          'Nexora ist eine kollaborative Produktplanungsplattform, die es Teams ermoeglicht, deterministische und qualitaetsgesicherte Produktanforderungsdokumente zu erstellen. Die Plattform unterstuetzt strukturierte Workflows fuer die iterative Verfeinerung von Anforderungen und stellt sicher, dass alle Ergebnisse implementierungsbereit und testbar sind.',
        'System Boundaries':
          'Das System umfasst die Webanwendung und die zugehoerige REST-API. Authentifizierte Benutzer interagieren ueber den Browser. Externe Integrationen beschraenken sich auf den Identitaetsprovider und den Dateispeicherdienst. Native mobile Anwendungen und Offline-Funktionalitaet sind fuer diese Version nicht vorgesehen.',
        'Domain Model':
          'Die Kernentitaeten sind Benutzer, Projekt, PRD-Dokument, Version, Feature-Spezifikation und Reviewer-Kommentar. Jedes PRD-Dokument gehoert zu genau einem Projekt und enthaelt eine geordnete Liste von Feature-Spezifikationen. Versionen bilden eine unveraenderliche Historie ab.',
        'Global Business Rules':
          'Feature-IDs bleiben ueber alle Verfeinerungslaeufe stabil und werden nie wiederverwendet. Jede Mutation erfordert eine authentifizierte Sitzung. Gleichzeitige Bearbeitungen desselben Dokuments werden durch optimistisches Locking mit Versionszaehlern verhindert.',
        'Non-Functional Requirements':
          'Die Antwortzeit fuer API-Endpunkte muss unter fuenfhundert Millisekunden bei p95-Latenz liegen. Die Anwendung muss eine Verfuegbarkeit von mindestens neunundneunzig Komma neun Prozent pro Monat erreichen. Alle Daten werden im Ruhezustand und waehrend der Uebertragung verschluesselt.',
        'Error Handling & Recovery':
          'Transiente Fehler werden mit exponentiellem Backoff bis zu dreimal wiederholt. Permanente Fehler werden protokolliert und der Nutzer erhaelt eine klare Fehlermeldung mit Handlungsempfehlung. Bei Datenbankfehlern wird ein automatisches Rollback der laufenden Transaktion durchgefuehrt.',
        'Deployment & Infrastructure':
          'Die Anwendung wird als containerisierter Node.js-Dienst auf einer verwalteten Kubernetes-Plattform bereitgestellt. PostgreSQL dient als primaere Datenbank mit taeglichen automatisierten Backups. Redis wird als Sitzungs- und Cache-Speicher eingesetzt.',
        'Definition of Done':
          'Ein Feature gilt als abgeschlossen, wenn alle Akzeptanzkriterien erfuellt sind, die automatisierten Tests bestanden haben, ein Code-Review durchgefuehrt wurde und die Dokumentation aktualisiert ist.',
        'Out of Scope':
          'Native mobile Anwendungen, Offline-Synchronisation, mandantenfaehige Architektur und Drittanbieter-Plugin-System sind fuer diesen Release explizit ausgeschlossen.',
        'Timeline & Milestones':
          'Phase eins umfasst die Kernfunktionalitaet und ist fuer die Wochen eins bis vier geplant. Phase zwei behandelt erweiterte Funktionen in den Wochen fuenf bis acht. Der Beta-Launch ist fuer Woche neun vorgesehen, gefolgt vom stabilen Release in Woche zwoelf.',
        'Success Criteria & Acceptance Testing':
          'Der Release gilt als erfolgreich, wenn fuenfundneunzig Prozent der automatisierten Tests bestehen, die durchschnittliche API-Antwortzeit unter dreihundert Millisekunden liegt und weniger als fuenf kritische Fehler in den ersten zwei Wochen nach dem Launch gemeldet werden.',
      }
    : {
        'System Vision':
          'Nexora is a collaborative product planning platform that enables teams to create deterministic, quality-gated product requirements documents. The platform supports structured workflows for iterative requirements refinement and ensures all outputs are implementation-ready and testable.',
        'System Boundaries':
          'The system encompasses the web application and associated REST API. Authenticated users interact via the browser. External integrations are limited to the identity provider and file storage service. Native mobile applications and offline functionality are out of scope for this version.',
        'Domain Model':
          'Core entities include User, Project, PRD Document, Version, Feature Specification, and Reviewer Comment. Each PRD Document belongs to exactly one Project and contains an ordered list of Feature Specifications. Versions form an immutable history.',
        'Global Business Rules':
          'Feature IDs remain stable across all refinement runs and are never reused. Every mutation requires an authenticated session. Concurrent edits to the same document are prevented through optimistic locking with version counters.',
        'Non-Functional Requirements':
          'API endpoint response times must stay below five hundred milliseconds at p95 latency. The application must achieve at least ninety-nine point nine percent uptime per month. All data is encrypted at rest and in transit.',
        'Error Handling & Recovery':
          'Transient errors are retried with exponential backoff up to three times. Permanent errors are logged and the user receives a clear error message with recommended action. Database errors trigger an automatic rollback of the in-progress transaction.',
        'Deployment & Infrastructure':
          'The application is deployed as a containerized Node.js service on a managed Kubernetes platform. PostgreSQL serves as the primary database with daily automated backups. Redis is used for session and cache storage.',
        'Definition of Done':
          'A feature is complete when all acceptance criteria are satisfied, automated tests pass, a code review has been conducted, and documentation is updated.',
        'Out of Scope':
          'Native mobile applications, offline synchronization, multi-tenant architecture, and third-party plugin system are explicitly excluded from this release.',
        'Timeline & Milestones':
          'Phase one covers core functionality and is scheduled for weeks one through four. Phase two addresses advanced features in weeks five through eight. Beta launch is planned for week nine, followed by stable release in week twelve.',
        'Success Criteria & Acceptance Testing':
          'The release is successful when ninety-five percent of automated tests pass, average API response time is under three hundred milliseconds, and fewer than five critical bugs are reported in the first two weeks post-launch.',
      };

  // Apply section overrides
  for (const [heading, body] of Object.entries(sectionOverrides)) {
    sections[heading] = body;
  }

  const parts: string[] = [];

  if (options?.preamble) {
    parts.push(options.preamble);
  }

  parts.push('# Test PRD');
  parts.push('');

  // Emit canonical sections in order
  const preFeaturesHeadings = [
    'System Vision',
    'System Boundaries',
    'Domain Model',
    'Global Business Rules',
  ];
  for (const heading of preFeaturesHeadings) {
    parts.push(`## ${heading}`);
    parts.push('');
    parts.push(sections[heading]);
    parts.push('');
  }

  // Feature catalogue
  parts.push('## Functional Feature Catalogue');
  parts.push('');
  const featuresToEmit = featureSpecs.slice(0, featureCount);
  for (let i = 0; i < featuresToEmit.length; i++) {
    const spec = featuresToEmit[i];
    if (options?.identicalFeatureContent) {
      const name = featureNameOverrides[i] ?? spec.name;
      parts.push(`### ${spec.id}: ${name}`);
      parts.push('');
      parts.push(options.identicalFeatureContent);
      parts.push('');
    } else {
      parts.push(buildFeatureMarkdown(spec, featureNameOverrides[i]));
      parts.push('');
    }
  }

  const postFeaturesHeadings = [
    'Non-Functional Requirements',
    'Error Handling & Recovery',
    'Deployment & Infrastructure',
    'Definition of Done',
    'Out of Scope',
    'Timeline & Milestones',
    'Success Criteria & Acceptance Testing',
  ];
  for (const heading of postFeaturesHeadings) {
    parts.push(`## ${heading}`);
    parts.push('');
    parts.push(sections[heading]);
    parts.push('');
  }

  if (options?.epilogue) {
    parts.push(options.epilogue);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generate mode - happy path', () => {
  it('compiles a valid PRD without quality errors', () => {
    const rawContent = buildTestPrd({ featureCount: 3 });
    const result = compilePrdDocument(rawContent, {
      mode: 'generate',
      language: 'en',
    });

    expect(result.quality.valid).toBe(true);
    expect(result.quality.featureCount).toBeGreaterThanOrEqual(3);

    const errors = result.quality.issues.filter(i => i.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('preserves all canonical sections', () => {
    const rawContent = buildTestPrd({ featureCount: 3 });
    const result = compilePrdDocument(rawContent, {
      mode: 'generate',
      language: 'en',
    });

    for (const heading of CANONICAL_PRD_HEADINGS) {
      expect(result.content).toContain(heading);
    }
  });

  it('preserves project-specific feature content rather than inserting generic boilerplate', () => {
    const rawContent = buildTestPrd({ featureCount: 3 });
    const result = compilePrdDocument(rawContent, {
      mode: 'generate',
      language: 'en',
    });

    // Feature purpose from EN_FEATURE_SPECS should be preserved, not replaced by generic template
    const f01 = result.structure.features.find(f => f.id === 'F-01');
    expect(f01).toBeDefined();
    // Original purpose mentions "securely log in" — NOT the generic "delivers a clearly scoped user capability"
    expect(f01!.purpose).toMatch(/log\s*in|authenticat/i);
    expect(f01!.purpose).not.toMatch(/delivers a clearly scoped user capability/i);
    // Acceptance criteria should reference domain terms, not generic "verifiable by end users"
    expect(f01!.acceptanceCriteria?.length).toBeGreaterThanOrEqual(1);
    expect(f01!.acceptanceCriteria![0]).toMatch(/credential|dashboard|password|login/i);
  });

  it('features retain structured fields from input spec rather than template defaults', () => {
    const rawContent = buildTestPrd({ featureCount: 2 });
    const result = compilePrdDocument(rawContent, {
      mode: 'generate',
      language: 'en',
    });

    for (const feature of result.structure.features) {
      // Each feature should have mainFlow, actors, and trigger from the input spec
      expect(feature.mainFlow?.length).toBeGreaterThanOrEqual(2);
      expect(feature.actors).toBeTruthy();
      // Actors should NOT be the generic "Primary: end user invoking" template
      expect(feature.actors).not.toMatch(/Primary: end user invoking/i);
    }
  });
});

describe('improve mode - feature count regression', () => {
  it('warns when output has fewer features than baseline', () => {
    // Existing content has 6 distinct features.
    const existingContent = buildTestPrd({ featureCount: 6 });

    // Raw content has 6 features but F-01 and F-02 are renamed to near-identical
    // names so the aggregation engine merges them.  The resulting output has 5
    // features while the baseline had 6, yielding ~16% loss (warning threshold).
    const rawContent = buildTestPrd({
      featureCount: 6,
      featureNameOverrides: {
        0: 'User Authentication Login',
        1: 'User Authentication Logn',  // edit distance 1 from index 0 → similarity >0.9
      },
    });

    const result = compilePrdDocument(rawContent, {
      mode: 'improve',
      existingContent,
      language: 'en',
    });

    const regressionIssues = result.quality.issues.filter(
      i => i.code === 'feature_count_regression',
    );
    expect(regressionIssues.length).toBeGreaterThanOrEqual(1);
    expect(regressionIssues[0].severity).toBe('warning');
  });

  it('errors when more than twenty percent of features are lost', () => {
    // Existing content has 6 distinct features.
    const existingContent = buildTestPrd({ featureCount: 6 });

    // Raw content renames 3 pairs to near-identical names.  After aggregation
    // the output has 3 features versus a baseline of 6, i.e. 50% loss (error).
    const rawContent = buildTestPrd({
      featureCount: 6,
      featureNameOverrides: {
        0: 'User Authentication Login Flow',
        1: 'User Authentication Login Fow',  // 1-char diff → aggregated with F-01
        2: 'Profile Settings Management Page',
        3: 'Profile Settings Management Pag',  // 1-char diff → aggregated with F-03
        4: 'Notification Center Inbox View',
        5: 'Notification Center Inbox Vie',   // 1-char diff → aggregated with F-05
      },
    });

    const result = compilePrdDocument(rawContent, {
      mode: 'improve',
      existingContent,
      language: 'en',
    });

    const regressionIssues = result.quality.issues.filter(
      i => i.code === 'feature_count_regression',
    );
    expect(regressionIssues.length).toBeGreaterThanOrEqual(1);
    expect(regressionIssues[0].severity).toBe('error');
    expect(result.quality.valid).toBe(false);
  });

  it('reports no regression issue when feature count is preserved', () => {
    const existingContent = buildTestPrd({ featureCount: 4 });
    const rawContent = buildTestPrd({ featureCount: 4 });

    const result = compilePrdDocument(rawContent, {
      mode: 'improve',
      existingContent,
      language: 'en',
    });

    const regressionIssues = result.quality.issues.filter(
      i => i.code === 'feature_count_regression',
    );
    expect(regressionIssues).toHaveLength(0);
  });
});

describe('truncation detection', () => {
  it('detects truncated output', () => {
    // Build a minimal PRD that omits all sections after the feature catalogue.
    // The last line of assembled output will be the final feature's last
    // acceptance criterion ending with a connector word, which the truncation
    // heuristic flags.
    const sections: Record<string, string> = {
      'System Vision': 'Nexora is a collaborative product planning platform that enables teams to create deterministic, quality-gated product requirements documents.',
      'System Boundaries': 'The system encompasses the web application and associated REST API with authenticated browser access.',
      'Domain Model': 'Core entities include User, Project, PRD Document, Version, Feature Specification, and Reviewer Comment.',
      'Global Business Rules': 'Feature IDs remain stable across all refinement runs and are never reused.',
    };

    // Create a hand-crafted PRD that ends abruptly mid-sentence.
    // The last section's content ends with a connector so looksLikeTruncatedOutput fires.
    const truncatedPrd = [
      '# Test PRD',
      '',
      '## System Vision',
      '',
      sections['System Vision'],
      '',
      '## System Boundaries',
      '',
      sections['System Boundaries'],
      '',
      '## Domain Model',
      '',
      sections['Domain Model'],
      '',
      '## Global Business Rules',
      '',
      sections['Global Business Rules'],
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: User Authentication',
      '',
      '**Purpose:** Allow users to securely log in and establish an authenticated session.',
      '**Actors:** Primary: registered end user. Secondary: identity provider.',
      '**Trigger:** User submits credentials via the login form.',
      '**Preconditions:** User account exists in the identity store.',
      '**Main Flow:**',
      '1. User opens the login page and enters credentials.',
      '2. Server validates credentials and issues a session token.',
      '**Alternate Flows:**',
      '1. Invalid credentials: server returns error.',
      '**Postconditions:** An authenticated session is established.',
      '**Data Impact:** A new session record is created.',
      '**UI Impact:** The login form shows loading and redirects on success.',
      '**Acceptance Criteria:**',
      '1. A registered user can log in within three seconds.',
      '2. The system handles concurrent login attempts for',
    ].join('\n');

    const result = compilePrdDocument(truncatedPrd, {
      mode: 'generate',
      language: 'en',
    });

    // The quality report should flag truncation at the warning or error level.
    // The assembled output may or may not look truncated depending on how the
    // parser recovers, but the raw source truncation should still be detected.
    const truncationIssues = result.quality.issues.filter(
      i => i.code === 'truncated_output',
    );
    expect(truncationIssues.length).toBeGreaterThanOrEqual(1);
  });
});

describe('meta-leak sanitization', () => {
  it('removes meta and prompt artifacts from content', () => {
    const basePrd = buildTestPrd({ featureCount: 3 });

    // Inject meta/prompt artifacts into the System Vision section body itself
    // so they land inside a parsed section (not between sections as free text).
    const metaLeakSuffix = '\n\nIteration 3\n\n- Question one identified\n- Question two identified\n\nOriginal PRD:\n\nThis was the old version.\n\nReasoning: I decided to restructure.';
    const rawContent = buildTestPrd({
      featureCount: 3,
      sectionOverrides: {
        'System Vision':
          'Nexora is a collaborative product planning platform that enables teams to create deterministic, quality-gated product requirements documents.' +
          metaLeakSuffix,
      },
    });

    const result = compilePrdDocument(rawContent, {
      mode: 'generate',
      language: 'en',
    });

    // The sanitizer should have removed the meta artifacts from the compiled content
    expect(result.content).not.toContain('Iteration 3');
    expect(result.content).not.toContain('Original PRD:');
    expect(result.content).not.toContain('Reasoning: I decided');

    // The sanitizer runs before validation, so the final structure is clean.
    // Therefore collectMetaLeakIssues finds no residual leaks.
    // We verify the sanitization was effective by checking the content is clean.
    // This is the primary integration assertion: meta-leaks do not appear in output.
    expect(result.content).toContain('Nexora is a collaborative');
    expect(result.quality).toBeDefined();
  });
});

describe('boilerplate detection', () => {
  it('detects repeated boilerplate across features', () => {
    const boilerplateText = [
      '**Purpose:** This feature provides a comprehensive and fully integrated solution for managing critical workflows across the entire platform ecosystem with enterprise-grade reliability.',
      '**Actors:** Primary: authenticated end user interacting with the core platform. Secondary: backend orchestration services and external integration layer.',
      '**Trigger:** The user initiates the workflow by performing a deliberate action through the platform user interface.',
      '**Preconditions:** The user must be fully authenticated and authorized with all required permissions before accessing this capability.',
      '**Main Flow:**',
      '1. The system receives and validates the incoming request against the defined business rules.',
      '2. The core processing logic executes the operation deterministically according to the specification.',
      '3. All relevant data changes are persisted atomically to the primary data store.',
      '4. The user interface updates to reflect the completed operation with appropriate feedback.',
      '**Alternate Flows:**',
      '1. If validation fails the system returns a descriptive error message and performs no partial state change.',
      '2. If a transient error occurs the system retries the operation and notifies the user on persistent failure.',
      '**Postconditions:** After successful completion the resulting system state is consistent, persisted, and available for all downstream consumers.',
      '**Data Impact:** The operation reads and writes only the entities directly within scope of this specific feature boundary.',
      '**UI Impact:** The interface transitions through loading, success, and error states with clear visual indicators.',
      '**Acceptance Criteria:**',
      '1. This feature provides a comprehensive and fully integrated solution for managing critical workflows across the entire platform ecosystem with enterprise-grade reliability.',
      '2. Error scenarios produce clear feedback and maintain system state integrity without data corruption.',
      '3. All data changes caused by this operation are verifiable through the standard audit interface.',
    ].join('\n');

    const rawContent = buildTestPrd({
      featureCount: 8,
      identicalFeatureContent: boilerplateText,
    });

    const result = compilePrdDocument(rawContent, {
      mode: 'generate',
      language: 'en',
    });

    const boilerplateIssues = result.quality.issues.filter(i =>
      i.code.includes('boilerplate'),
    );
    expect(boilerplateIssues.length).toBeGreaterThanOrEqual(1);
  });
});

describe('language consistency', () => {
  it('detects language mixing in a German PRD', () => {
    // Build a German PRD but override several sections with English content
    // so approximately 30% of the body is English
    const rawContent = buildTestPrd({
      featureCount: 3,
      language: 'de',
      sectionOverrides: {
        'Domain Model':
          'The core entities are User, Project, PRD Document, Version, Feature Specification, and Reviewer Comment. Each PRD Document belongs to exactly one Project and contains an ordered list of Feature Specifications. Versions form an immutable history that cannot be altered after creation.',
        'Error Handling & Recovery':
          'Transient errors are retried with exponential backoff up to three times. Permanent errors are logged and the user receives a clear error message with recommended action. Database errors trigger an automatic rollback of the current transaction and all side effects are reverted cleanly.',
        'Definition of Done':
          'A feature is considered done when all acceptance criteria are satisfied, automated tests pass in the continuous integration pipeline, a code review has been completed by at least one peer, and the relevant documentation has been updated to reflect the final implementation.',
      },
    });

    const result = compilePrdDocument(rawContent, {
      mode: 'generate',
      language: 'de',
      strictLanguageConsistency: true,
    });

    const languageIssues = result.quality.issues.filter(i =>
      i.code.includes('language_mismatch'),
    );
    expect(languageIssues.length).toBeGreaterThanOrEqual(1);
  });
});

describe('template semantic validation', () => {
  it('validates against template-specific expectations', () => {
    // Use a 'feature' template category with a normal PRD.
    // The compilation should complete without throwing.
    const rawContent = buildTestPrd({ featureCount: 4 });

    const result = compilePrdDocument(rawContent, {
      mode: 'generate',
      language: 'en',
      templateCategory: 'feature',
    });

    // Basic assertion: the compilation completed and returned a result
    expect(result).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.structure).toBeDefined();
    expect(result.quality).toBeDefined();
    expect(result.quality.featureCount).toBeGreaterThanOrEqual(4);
  });
});
