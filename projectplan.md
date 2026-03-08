<!--
Author: rahn
 Datum: 08.03.2026
 Version: 2.9
Beschreibung: Arbeitsplan zur Stabilisierung des Compiler-Verhaltens, zum vollstaendigen Codebase-Review gegen die Projektregeln und zur priorisierten Refactoring-Roadmap
-->

<!-- ÄNDERUNG 06.03.2026: Containerbasierte Validierung dokumentiert, kostenarmen Testnutzer gesetzt, sequenziellen Einzel-Run-Ansatz ergänzt und semantische Feature-Prüfung ergänzt -->
<!-- ÄNDERUNG 07.03.2026: Neuer Blocker dokumentiert - Development-Tier haengt noch direkte Last-Resort-Provider-Fallbacks an und muss vor dem Re-Run gesperrt werden -->
<!-- ÄNDERUNG 07.03.2026: Guided-Blocker ergaenzt - globale Modell-Cooldowns duerfen die Fallback-Kette nicht auf einen kuenstlichen 0-/1-Modell-Lauf reduzieren -->
<!-- ÄNDERUNG 07.03.2026: Neuer Guided-Qualitaetsblocker dokumentiert - degradierte Ergebnisse mit `excessive_fallback_sections` duerfen trotz Refine-Pfad nicht mehr still akzeptiert werden -->
<!-- ÄNDERUNG 07.03.2026: `epic/guided` nach Minimal-Fix erfolgreich revalidiert - degradierter Fallback nutzt jetzt den kompilierten Fehlstand, echter Re-Run ist mit Score 117 ohne `excessive_fallback_sections` gruen -->
<!-- ÄNDERUNG 07.03.2026: `technical/simple` nach erweitertem Technical-Signal-Set erfolgreich revalidiert - echter Re-Run ist mit Score 117 und ohne Semantic-Mismatch gruen -->
<!-- ÄNDERUNG 07.03.2026: `technical/iterative` ohne weiteren Code-Fix erfolgreich bestaetigt - echter Einzel-Run ist mit Score 120 und ohne Warnings gruen -->
<!-- ÄNDERUNG 07.03.2026: `technical/guided` erfolgreich bestaetigt - echter Einzel-Run ist mit Score 117 gruen, der komplette `technical/*`-Block ist damit stabilisiert -->
<!-- ÄNDERUNG 07.03.2026: `product-launch/simple` erfolgreich bestaetigt - echter Einzel-Run ist mit Score 120 und ohne Warnings gruen -->
<!-- ÄNDERUNG 07.03.2026: `product-launch/iterative` erfolgreich bestaetigt - echter Einzel-Run ist mit Score 117 gruen; einzig verbleibend ist jetzt noch `product-launch/guided` -->
<!-- ÄNDERUNG 07.03.2026: `product-launch/guided` erfolgreich bestaetigt - echter Einzel-Run ist mit Score 114 gruen; damit sind jetzt alle 12 Smoke-Kombinationen im Container erfolgreich stabilisiert -->
<!-- ÄNDERUNG 07.03.2026: Vollstaendige Stabilitaetsauswertung der 12 erfolgreichen Runs dokumentiert - wichtigste Restthemen sind Near-Duplicates, Guided-/Fallback-Druck, spaet erkannte Boilerplate-Sektionen, noch zu feature-name-getriebene Template-Semantik und fehlende Artefaktpersistenz -->
<!-- ÄNDERUNG 07.03.2026: P1-Minimalfix und sequenzielle Revalidierung abgeschlossen - `technical/simple` (117), `technical/guided` (117), `product-launch/iterative` (110), `product-launch/guided` (117) und `epic/guided` (117) sind im Container erneut gruen -->
<!-- ÄNDERUNG 07.03.2026: P2-Teilfix umgesetzt - frisch im aktuellen Lauf gekuehlte Modelle werden jetzt fuer den kontrollierten Last-Resort-Retry mitgefuehrt; gezielte OpenRouter-Regressionen sind im Container gruen -->
<!-- ÄNDERUNG 07.03.2026: Development-Tier-Guard erneut im Container bestaetigt - direkte Last-Resort-Provider-Fallbacks bleiben auch nach dem Cooldown-Fix gesperrt (`tests/openrouterDefaults.test.ts`, gezielter Einzeltest gruen) -->
<!-- ÄNDERUNG 07.03.2026: P3-Minimalfix umgesetzt - Template-Fallback-Opener werden jetzt zentral erkannt und bereits im Compiler als Boilerplate markiert, ohne explizit compiler-gefuellte Recovery-Sektionen doppelt als Modellfehler zu bestrafen -->
<!-- ÄNDERUNG 07.03.2026: P4-Minimalfix umgesetzt - template-spezifische Feature-Signale duerfen jetzt allgemein auch aus klar passendem Feature-Inhalt statt nur aus Feature-Titeln zaehlen; Regressionen und TypeScript-Check sind im Container gruen -->
<!-- ÄNDERUNG 07.03.2026: P5-Minimalfix umgesetzt - `e2e/smoke-12-combos.e2e.spec.ts` persistiert Smoke-Resultate und Laufmetriken jetzt dauerhaft unter `documentation/smoke_results` als timestamped und latest JSON; Persistenztest, Playwright-Load und TypeScript-Check sind im Container gruen -->
<!-- ÄNDERUNG 08.03.2026: Vollstaendiges Codebase-Review gegen die Projektregeln gestartet - Architektur, Datei-Groessen, Header-/Aenderungsdoku, Ordnerstruktur, Sprachkonventionen und Testabdeckung werden systematisch geprueft -->
<!-- ÄNDERUNG 08.03.2026: Codebase-Review abgeschlossen und priorisierte Refactoring-Roadmap mit Quick Wins, Risikobloecken und empfohlener Reihenfolge ergaenzt -->
<!-- ÄNDERUNG 08.03.2026: Phase-0-Quick-Win-Paket 1 umgesetzt - leere Root-Artefakte nach `to_delete/phase0_root_artefakte_08_03_2026` verschoben, kleine First-Party-Dateien mit Header/Aenderungsdoku nachgezogen und ein unabhaengiger TypeScript-Blocker in `server/prdQualitySignals.ts` minimal bereinigt -->
<!-- ÄNDERUNG 08.03.2026: Phase-0-Quick-Win-Paket 2 umgesetzt - weitere kleine First-Party-Dateien mit Header/Aenderungsdoku versehen, Frontend-Auth-Default explizit markiert, 404-Text sprachlich vereinheitlicht und Paket 2 per IDE-Diagnostik sowie containerbasiertem `npm run check` validiert -->
<!-- ÄNDERUNG 08.03.2026: Phase-1-Minimalfix validiert - `generate` + `excessive_fallback_sections` erzwingt jetzt den Repair-/Fehlerpfad; `tests/prdCompilerFinalizer.test.ts` und `tests/guidedPrdCompiler.test.ts` sind im Container gruen, ebenso `npm run check` nach vollstaendigem Server-/Shared-/Tests-Sync -->
<!-- ÄNDERUNG 08.03.2026: Phase-2-Minimalsplit validiert - Repair-Prompt-Helfer aus `server/prdCompilerFinalizer.ts` nach `server/prdCompilerRepairPrompt.ts` extrahiert; Finalizer liegt jetzt bei 385 Zeilen und Zieltests plus `npm run check` sind im Container gruen -->
<!-- ÄNDERUNG 08.03.2026: Zweiter Phase-2-Minimalsplit validiert - Feature-Depth-/Hint-Logik aus `server/prdCompiler.ts` nach `server/prdFeatureDepth.ts` extrahiert; `server/prdCompiler.ts` liegt jetzt bei 906 Zeilen und Zieltests plus `npm run check` sind im Container gruen -->
<!-- ÄNDERUNG 08.03.2026: Dritter Phase-2-Minimalsplit validiert - interne Normalisierungs-/Parse-Helfer aus `server/prdCompiler.ts` nach `server/prdCompilerNormalization.ts` extrahiert; `server/prdCompiler.ts` liegt jetzt bei 869 Zeilen und gezielte Compiler-Regressionen plus `npm run check` sind im Container gruen -->
<!-- ÄNDERUNG 08.03.2026: Vierter Phase-2-Minimalsplit validiert - Merge-/Improve-Helfer aus `server/prdCompiler.ts` nach `server/prdCompilerMerge.ts` extrahiert; `server/prdCompiler.ts` liegt jetzt bei 698 Zeilen und gezielte Compiler-Regressionen plus `npm run check` sind im Container gruen -->
<!-- ÄNDERUNG 08.03.2026: Fuenfter Phase-2-Minimalsplit validiert - Required-Section-/Section-Depth-Helfer aus `server/prdCompiler.ts` nach `server/prdCompilerSectionPolicy.ts` extrahiert; `server/prdCompiler.ts` liegt jetzt bei 670 Zeilen und gezielte Compiler-Regressionen plus `npm run check` sind im Container gruen -->
<!-- ÄNDERUNG 08.03.2026: Sechster Phase-2-Minimalsplit validiert - Validierungs-Helfer aus `server/prdCompiler.ts` nach `server/prdCompilerValidation.ts` extrahiert; `server/prdCompiler.ts` liegt jetzt bei 353 Zeilen und gezielte Compiler-Regressionen plus `npm run check` sind im Container gruen -->
<!-- ÄNDERUNG 08.03.2026: Siebter Phase-2-Minimalsplit validiert - Cooldown-/Circuit-Breaker-Helfer aus `server/openrouter.ts` nach `server/openrouterCooldowns.ts` extrahiert; `server/openrouter.ts` liegt jetzt bei 1076 Zeilen, OpenRouter-Regressionen (`33/33`) und `npm run check` sind im Container gruen, der Verifier-Fallback-Test wurde gegen zusaetzliche unabhaengige Direct-Provider-Kandidaten stabilisiert -->
<!-- ÄNDERUNG 08.03.2026: Achter bis elfter Phase-2-Minimalsplit validiert - Tier-/Fallback-Konfiguration, Fallback-Orchestrierung, Models-API und User-Preference-Helfer wurden schrittweise aus `server/openrouter.ts` in eigene Module ausgelagert; `server/openrouter.ts` liegt nach Vollcount jetzt bei 481 Zeilen und ist damit kein Groessenblocker mehr -->
<!-- ÄNDERUNG 08.03.2026: Zwoelfter Phase-2-Minimalsplit validiert - Provider-/Modell-Routen aus `server/routes.ts` nach `server/modelProviderRoutes.ts` extrahiert; `tests/modelProviderRoutes.test.ts` sowie `npm run check` wurden erfolgreich validiert -->
<!-- ÄNDERUNG 08.03.2026: Dreizehnter Phase-2-Minimalsplit validiert - Guided-Compiler-Gates, Prompt-Builder und Fragen-/Antwort-Helfer aus `server/guidedAiService.ts` nach `server/guidedCompilerGates.ts`, `server/guidedPromptBuilders.ts` und `server/guidedQuestionUtils.ts` extrahiert; Guided-Tests und `npm run check` sind im Container gruen, `server/guidedAiService.ts` liegt nach Vollcount bei 488 Zeilen und ist damit kein Groessenblocker mehr -->
<!-- ÄNDERUNG 08.03.2026: Vierzehnter Phase-2-Minimalsplit validiert - Guided-Routen aus `server/routes.ts` nach `server/guidedRoutes.ts`, `server/guidedRouteRegistrySupport.ts`, `server/guidedFinalizeRoutes.ts` und `server/guidedFinalizeStreamRoute.ts` extrahiert; alle neuen Guided-Routenmodule liegen unter 500 Zeilen, gezielte Vitest-Regressionen (`9/9`) und `npm run check` sind im Container gruen -->
<!-- ÄNDERUNG 08.03.2026: Fuenfzehnter Phase-2-Minimalsplit validiert - Linear-/Dart-Integrationsrouten aus `server/routes.ts` nach `server/integrationRoutes.ts` extrahiert; gezielte Regressionen (`5/5`) und `npm run check` sind im Container gruen -->
<!-- ÄNDERUNG 08.03.2026: Sechzehnter Phase-2-Minimalsplit validiert - PRD-Export-, Restore- und Structure-Routen aus `server/routes.ts` nach `server/prdMaintenanceRoutes.ts` extrahiert; gezielte Regressionen (`5/5`), IDE-Diagnostik und `npm run check` sind ueber Logdateien im Container gruen bestaetigt -->
<!-- ÄNDERUNG 08.03.2026: Siebzehnter Phase-2-Minimalsplit validiert - Versionsrouten aus `server/routes.ts` nach `server/prdVersionRoutes.ts` extrahiert; IDE-Diagnostik, gezielte Regressionen (`6/6`) und `npm run check` sind ueber Workspace-Logdateien gruen bestaetigt -->
<!-- ÄNDERUNG 08.03.2026: Achtzehnter Phase-2-Minimalsplit validiert - Share-Routen aus `server/routes.ts` nach `server/prdShareRoutes.ts` extrahiert; IDE-Diagnostik, gezielte Regressionen (`8/8`) und `npm run check` sind ueber Workspace-Logdateien gruen bestaetigt -->
<!-- ÄNDERUNG 08.03.2026: Neunzehnter Phase-2-Minimalsplit validiert - Comments-Routen aus `server/routes.ts` nach `server/prdCommentRoutes.ts` extrahiert; IDE-Diagnostik, gezielte Regressionen (`4/4`) und `npm run check` sind ueber Workspace-Logdateien gruen bestaetigt -->
<!-- ÄNDERUNG 08.03.2026: Zwanzigster Phase-2-Minimalsplit validiert - Approval-Routen aus `server/routes.ts` nach `server/prdApprovalRoutes.ts` extrahiert; IDE-Diagnostik, gezielte Regressionen (`7/7`) und `npm run check` sind ueber Workspace-Logdateien gruen bestaetigt -->

## Problemanalyse

- [x] Guided nutzt im Finalizer noch keinen `contentRefineGenerator` wie `simple` und `iterative`.
- [x] Der API-Smoke-Test nutzt bisher keinen echten `prdId`-Flow und bildet den Template-Kontext dadurch unvollständig ab.
- [x] Containerbasierte Basisvalidierung für Guided-Test und TypeScript-Check ist abgeschlossen.
- [x] Der feste Clerk-Testnutzer ist auf kostenarme Free-Modelle für Smoke-Runs umgestellt.
- [x] Die Kombinationen sollen nicht mehr als 12er-Block, sondern einzeln mit Analyse-/Fix-/Re-Run-Schleife abgearbeitet werden.
- [x] Formal gefüllte, aber semantisch falsch gemappte Features und Feature-Placeholder werden im Reviewer bisher nicht gezielt erkannt.
- [x] Der semantische Reviewer-Fix ist im Container mit 30/30 Tests validiert.
- [x] Das Development-Tier hängt bei Free-Ausfällen keine direkten Last-Resort-Provider-Fallbacks mehr an.
- [x] Aktive Modell-Cooldowns duerfen Guided/Expansion nicht in einen kuenstlichen 0-/1-Modell-Zustand drängen.
- [x] Guided darf degradierte Endergebnisse mit massiven Compiler-Fallback-Sections trotz Refine-/Fallback-Pfad nicht mehr akzeptieren.
- [x] Template-spezifische Fallback-Opener aus Basis-/Template-Fallbacks werden nun bereits im Compiler statt erst im spaeten Content-Review erkannt.
- [x] Template-Semantik mit `featureNameSignals` darf nicht nur an Feature-Titeln haengen; klar template-spezifischer Feature-Inhalt muss fuer die Signal-Ratio mitzaehlen.
- [x] Smoke-Resultate und Laufmetriken der Einzel- und Vollruns brauchen einen dauerhaften, versionierbaren Projektpfad statt temporärer `.tmp_*`-Artefakte.
- [x] Die gesamte aktive Codebasis muss gegen alle geltenden Projektregeln vollstaendig geprüft und strukturiert bewertet werden.
- [x] Die groessten Regelverstoesse sind priorisiert; als verbleibende Phase-2-Groessenblocker stehen aktuell `server/routes.ts` (1602) und `server/dualAiService.ts` (3576) im Fokus, waehrend `server/guidedAiService.ts` (488) und `server/openrouter.ts` (481) nicht mehr ueber dem Limit liegen.
- [x] Das kritischste inhaltliche Risiko ist nicht nur Groesse, sondern generische PRD-Fallback-Inhalte im Compiler, die gegen das Fail-Fast-Prinzip arbeiten.
- [x] Fuer sichere Refactorings ist eine risikoarme Reihenfolge aus Quick Wins, kleineren Backend-Splits und erst danach den verbleibenden Grossmodulen festgelegt.

## Aufgaben

- [x] Guided-Finalizer auf Parität bringen.
- [x] Smoke-Test auf echtes PRD mit `templateId`/`prdId` umbauen.
- [x] Änderungen mit gezielten Tests und TypeScript-Prüfung validieren.
- [x] Smoke-Test auf Filter für Einzelkombinationen vorbereiten.
- [x] Reviewer um semantische Feature-Prüfung und Placeholder-Backup für Features ergänzen.
- [x] Direct-Provider-Last-Resort-Fallbacks im Development-Tier sperren und Regression absichern.
- [x] Cooldown-erschöpfte Fallback-Kette im OpenRouter-Client kontrolliert als Last-Resort nachziehen.
- [x] Kombinationen nacheinander ausführen, Fehler beheben und jeweils erneut validieren.
- [x] Guided-Finalizer/Quality-Fallback so absichern, dass `excessive_fallback_sections` nicht als degradierter Erfolg endet.
- [x] Gemeinsame Fallback-Erkennung fuer Compiler und Reviewer zentralisieren.
- [x] P3-Regressionstest fuer Template-Fallback-Opener im Compiler ergaenzen.
- [x] P4-Minimalfix fuer inhaltsbasierte Template-Semantik und gezielte Product-Launch-Regression umsetzen.
- [x] P5-Minimalfix fuer dauerhafte Smoke-Resultat- und Laufmetriken-Persistenz umsetzen.
- [x] Alle relevanten Quell-, Test-, Konfigurations- und Dokumentationsdateien lesen und ihre Rolle im Gesamtsystem erfassen.
- [x] Verstoesse und Risiken gegen die Projektregeln nach Kategorien priorisieren.
- [x] Vollstaendige Review-Auswertung mit Architekturueberblick, Regel-Check und Handlungsempfehlungen dokumentieren.
- [x] Refactoring-Roadmap mit Quick Wins, Abhaengigkeiten und Phasen erstellen.
- [x] Phase 0 Quick-Win-Paket 1 umsetzen: leere Root-Artefakte nach `to_delete/` verschieben und kleine First-Party-Dateien mit Header/Aenderungsdoku ergaenzen.
- [x] Weiteres Phase-0-Quick-Win-Paket mit weiteren kleinen First-Party-Dateien und transparenten Defaults vorbereiten.
- [x] Phase 1 vorbereiten: inhaltliche Fail-Fast-/Fallback-Bereinigung im Compiler absichern.
- [ ] Phase 2 vorbereiten: groesste God-Files schrittweise in Module/Hooks/Router-Segmente aufteilen.
  - Zwischenstand 08.03.2026: erster risikoarmer Split in `server/prdCompilerFinalizer.ts` umgesetzt; Repair-Prompt-Helfer leben jetzt in `server/prdCompilerRepairPrompt.ts`.
  - Zwischenstand 08.03.2026: zweiter risikoarmer Split in `server/prdCompiler.ts` umgesetzt; Feature-Depth-/Hint-Helfer leben jetzt in `server/prdFeatureDepth.ts`, `server/prdCompiler.ts` ist auf 906 Zeilen reduziert.
  - Zwischenstand 08.03.2026: dritter risikoarmer Split in `server/prdCompiler.ts` umgesetzt; Normalisierungs-/Parse-Helfer leben jetzt in `server/prdCompilerNormalization.ts`, `server/prdCompiler.ts` ist auf 869 Zeilen reduziert.
  - Zwischenstand 08.03.2026: vierter risikoarmer Split in `server/prdCompiler.ts` umgesetzt; Merge-/Improve-Helfer leben jetzt in `server/prdCompilerMerge.ts`, `server/prdCompiler.ts` ist auf 698 Zeilen reduziert.
  - Zwischenstand 08.03.2026: fuenfter risikoarmer Split in `server/prdCompiler.ts` umgesetzt; Required-Section-/Section-Depth-Helfer leben jetzt in `server/prdCompilerSectionPolicy.ts`, `server/prdCompiler.ts` ist auf 670 Zeilen reduziert.
  - Zwischenstand 08.03.2026: sechster risikoarmer Split in `server/prdCompiler.ts` umgesetzt; Validierungs-Helfer leben jetzt in `server/prdCompilerValidation.ts`, `server/prdCompiler.ts` ist auf 353 Zeilen reduziert.
  - Zwischenstand 08.03.2026: siebter risikoarmer Split in `server/openrouter.ts` umgesetzt; Cooldown-/Circuit-Breaker-Helfer leben jetzt in `server/openrouterCooldowns.ts`, `server/openrouter.ts` ist auf 1076 Zeilen reduziert.
  - Zwischenstand 08.03.2026: achter bis elfter risikoarmer Split in `server/openrouter.ts` umgesetzt; Tier-/Fallback-Konfiguration, Fallback-Orchestrierung, Models-API und User-Preference-Helfer leben jetzt in `server/openrouterModelConfig.ts`, `server/openrouterFallback.ts`, `server/openrouterModelsApi.ts` und `server/openrouterUserPreferences.ts`, `server/openrouter.ts` liegt nach Vollcount bei 481 Zeilen.
  - Zwischenstand 08.03.2026: zwoelfter risikoarmer Split in `server/routes.ts` umgesetzt; Provider-/Modell-Routen leben jetzt in `server/modelProviderRoutes.ts`, gezielte Regressionen in `tests/modelProviderRoutes.test.ts` sind gruen.
  - Zwischenstand 08.03.2026: dreizehnter risikoarmer Split in `server/guidedAiService.ts` umgesetzt; Compiler-Gates, Prompt-Builder und Fragen-/Antwort-Helfer leben jetzt in `server/guidedCompilerGates.ts`, `server/guidedPromptBuilders.ts` und `server/guidedQuestionUtils.ts`, `server/guidedAiService.ts` liegt nach Vollcount bei 488 Zeilen.
    - Zwischenstand 08.03.2026: vierzehnter risikoarmer Split in `server/routes.ts` umgesetzt; Guided-Routen leben jetzt in `server/guidedRoutes.ts`, `server/guidedRouteRegistrySupport.ts`, `server/guidedFinalizeRoutes.ts` und `server/guidedFinalizeStreamRoute.ts`, alle neuen Guided-Routenmodule liegen unter 500 Zeilen, `server/routes.ts` bleibt mit 2076 Zeilen aber weiterer Restblocker.
    - Zwischenstand 08.03.2026: fuenfzehnter risikoarmer Split in `server/routes.ts` umgesetzt; Linear-/Dart-Integrationsrouten leben jetzt in `server/integrationRoutes.ts`, gezielte Regressionen in `tests/integrationRoutes.test.ts` sind gruen.
    - Zwischenstand 08.03.2026: sechzehnter risikoarmer Split in `server/routes.ts` umgesetzt; PRD-Export-, Restore- und Structure-Routen leben jetzt in `server/prdMaintenanceRoutes.ts`, gezielte Regressionen in `tests/prdMaintenanceRoutes.test.ts` sind gruen und `server/routes.ts` liegt aktuell bei 1851 Zeilen.
    - Zwischenstand 08.03.2026: siebzehnter risikoarmer Split in `server/routes.ts` umgesetzt; Versionsrouten leben jetzt in `server/prdVersionRoutes.ts`, gezielte Regressionen in `tests/prdVersionRoutes.test.ts` sind gruen und `server/routes.ts` liegt aktuell bei 1811 Zeilen.
  - Zwischenstand 08.03.2026: achtzehnter risikoarmer Split in `server/routes.ts` umgesetzt; Share-Routen leben jetzt in `server/prdShareRoutes.ts`, gezielte Regressionen in `tests/prdShareRoutes.test.ts` sind gruen und `server/routes.ts` liegt aktuell bei 1763 Zeilen.
  - Zwischenstand 08.03.2026: neunzehnter risikoarmer Split in `server/routes.ts` umgesetzt; Comments-Routen leben jetzt in `server/prdCommentRoutes.ts`, gezielte Regressionen in `tests/prdCommentRoutes.test.ts` sind gruen und `server/routes.ts` liegt aktuell bei 1565 Zeilen.
  - Zwischenstand 08.03.2026: zwanzigster risikoarmer Split in `server/routes.ts` umgesetzt; Approval-Routen leben jetzt in `server/prdApprovalRoutes.ts`, gezielte Regressionen in `tests/prdApprovalRoutes.test.ts` sind gruen und `server/routes.ts` liegt aktuell bei 1602 Zeilen.

## Überprüfung

- [x] Vitest für Guided-Service-Erweiterung im Container ausführen.
- [x] TypeScript-Check im Container ausführen.
- [x] Playwright-Spec `e2e/smoke-12-combos.e2e.spec.ts` per `--list` im Container prüfen.
- [x] `CLERK_SECRET_KEY` im Container verifizieren.
- [x] Testnutzer auf Free-Modelle für Generator/Reviewer/Fallback umstellen.
- [x] Ergebnisse dokumentieren.
- [x] Reviewer-Semantiktests im Container grün (`30/30`).
- [x] OpenRouter-Regression für Development-Tier erneut im Container prüfen.
- [x] Guided-Cooldown-Regression im Container prüfen.
- [x] Erste Einzelkombination im Container ausführen und stabilisieren.
- [x] Guided-Qualitaetsguard mit gezielten Vitest-Tests und echtem `epic/guided`-Re-Run pruefen.
- [x] `tests/prdTemplateIntentCompiler.test.ts` im Container gruen (`15/15`).
- [x] `tests/prdContentReviewer.test.ts` im Container gruen (`27/27`).
- [x] `npm run check` im Container gruen.
- [x] `tests/prd_template_feature_signals.test.ts` im Container gruen (`3/3`).
- [x] `tests/smoke_report_persistence.test.ts` im Container gruen (`1/1`).
- [x] `playwright test e2e/smoke-12-combos.e2e.spec.ts --list` im Container gruen.
- [x] Dateibestand und Zeilenanzahlen der aktiven Projektdateien erfassen.
- [x] Review der Kernarchitektur (Frontend, Backend, Compiler-Pipeline, Provider, Persistenz, Tests) abschliessen.
- [x] Ergebnisse gegen die Projektregeln konsolidieren und priorisieren.
- [x] Refactoring-Reihenfolge fuer Quick Wins, Risikobloecke und Gross-Refactorings festlegen.
- [x] IDE-Diagnostik fuer erstes Phase-0-Paket ohne Befunde pruefen.
- [x] Containerbasierten TypeScript-Check (`npm run check`) fuer erstes Phase-0-Paket erfolgreich ausfuehren.
- [x] IDE-Diagnostik fuer zweites Phase-0-Paket ohne Befunde pruefen.
- [x] Containerbasierten TypeScript-Check (`npm run check`) fuer zweites Phase-0-Paket erfolgreich ausfuehren.
- [x] `tests/prdCompilerFinalizer.test.ts` und `tests/guidedPrdCompiler.test.ts` im Container gruen (`34/34`).
- [x] Containerbasierten TypeScript-Check (`npm run check`) fuer Phase-1-Minimalfix erfolgreich ausfuehren.
- [x] IDE-Diagnostik fuer `server/prdCompilerFinalizer.ts` und `server/prdCompilerRepairPrompt.ts` ohne Befunde pruefen.
- [x] `tests/prdCompilerFinalizer.test.ts` und `tests/guidedPrdCompiler.test.ts` nach Phase-2-Minimalsplit im Container gruen (`34/34`).
- [x] Containerbasierten TypeScript-Check (`npm run check`) fuer Phase-2-Minimalsplit erfolgreich ausfuehren.
- [x] IDE-Diagnostik fuer `server/prdCompiler.ts`, `server/prdFeatureDepth.ts`, `tests/prdFeatureDepth.test.ts` und `tests/guidedPrdCompiler.test.ts` ohne Befunde pruefen.
- [x] `tests/prdFeatureDepth.test.ts` und `tests/guidedPrdCompiler.test.ts` nach dem zweiten Phase-2-Minimalsplit im Container gruen (`35/35`).
- [x] Containerbasierten TypeScript-Check (`npm run check`) fuer den zweiten Phase-2-Minimalsplit erfolgreich ausfuehren.
- [x] IDE-Diagnostik fuer `server/prdCompiler.ts`, `server/prdCompilerNormalization.ts`, `tests/guidedPrdCompiler.test.ts` und `tests/prdCompilerPipeline.integration.test.ts` ohne Befunde pruefen.
- [x] `tests/guidedPrdCompiler.test.ts` und `tests/prdCompilerPipeline.integration.test.ts` nach dem dritten Phase-2-Minimalsplit im Container gruen (`32/32`).
- [x] Containerbasierten TypeScript-Check (`npm run check`) fuer den dritten Phase-2-Minimalsplit erfolgreich ausfuehren.
- [x] IDE-Diagnostik fuer `server/prdCompiler.ts`, `server/prdCompilerMerge.ts`, `tests/guidedPrdCompiler.test.ts`, `tests/prdCompilerPipeline.integration.test.ts` und `tests/prdFeatureDepth.test.ts` ohne Befunde pruefen.
- [x] `tests/prdFeatureDepth.test.ts`, `tests/guidedPrdCompiler.test.ts` und `tests/prdCompilerPipeline.integration.test.ts` nach dem vierten Phase-2-Minimalsplit im Container gruen (`47/47`).
- [x] Containerbasierten TypeScript-Check (`npm run check`) fuer den vierten Phase-2-Minimalsplit erfolgreich ausfuehren.
- [x] IDE-Diagnostik fuer `server/prdCompiler.ts`, `server/prdCompilerSectionPolicy.ts`, `server/guidedPrdCompiler.ts`, `tests/guidedPrdCompiler.test.ts`, `tests/prdFeatureDepth.test.ts` und `tests/prdCompilerPipeline.integration.test.ts` ohne Befunde pruefen.
- [x] `tests/prdFeatureDepth.test.ts`, `tests/guidedPrdCompiler.test.ts` und `tests/prdCompilerPipeline.integration.test.ts` nach dem fuenften Phase-2-Minimalsplit im Container gruen (`47/47`).
- [x] Containerbasierten TypeScript-Check (`npm run check`) fuer den fuenften Phase-2-Minimalsplit erfolgreich ausfuehren.
- [x] IDE-Diagnostik fuer `server/prdCompiler.ts`, `server/prdCompilerValidation.ts`, `server/guidedPrdCompiler.ts`, `server/prdCompilerFinalizer.ts`, `server/prdRunQuality.ts`, `server/compilerArtifact.ts`, `tests/prdFeatureDepth.test.ts`, `tests/guidedPrdCompiler.test.ts` und `tests/prdCompilerPipeline.integration.test.ts` ohne Befunde pruefen.
- [x] `tests/prdFeatureDepth.test.ts`, `tests/guidedPrdCompiler.test.ts` und `tests/prdCompilerPipeline.integration.test.ts` nach dem sechsten Phase-2-Minimalsplit im Container gruen (`47/47`).
- [x] Containerbasierten TypeScript-Check (`npm run check`) fuer den sechsten Phase-2-Minimalsplit erfolgreich ausfuehren.
- [x] IDE-Diagnostik fuer `server/openrouter.ts`, `server/openrouterCooldowns.ts`, `server/routes.ts`, `server/services/llm/expandFeature.ts`, `tests/openrouterDefaults.test.ts`, `tests/openrouter_cooldown_fallback.test.ts` und `tests/openrouterFallback.test.ts` ohne Befunde pruefen.
- [x] `tests/openrouterDefaults.test.ts`, `tests/openrouter_cooldown_fallback.test.ts` und `tests/openrouterFallback.test.ts` nach dem siebten Phase-2-Minimalsplit im Container gruen (`33/33`).
- [x] Containerbasierten TypeScript-Check (`npm run check`) fuer den siebten Phase-2-Minimalsplit erfolgreich ausfuehren.
- [x] Gezielte OpenRouter-Regressionen und `npm run check` auch nach den weiteren OpenRouter-Extraktionen erfolgreich pruefen; `server/openrouter.ts` liegt jetzt per Vollcount unter 500 Zeilen.
- [x] IDE-Diagnostik fuer `server/routes.ts`, `server/modelProviderRoutes.ts` und `tests/modelProviderRoutes.test.ts` ohne Befunde pruefen.
- [x] `tests/modelProviderRoutes.test.ts` nach dem Routes-Minimalsplit erfolgreich validieren.
- [x] IDE-Diagnostik fuer `server/guidedAiService.ts`, `server/guidedCompilerGates.ts`, `server/guidedPromptBuilders.ts`, `server/guidedQuestionUtils.ts`, `tests/guidedAiService.test.ts` und `tests/guidedQuestionUtils.test.ts` ohne Befunde pruefen.
- [x] `tests/guidedQuestionUtils.test.ts` im Container gruen (`2/2`) und `tests/guidedAiService.test.ts` im Container gruen (`1/1`) ueber frische Logdateien unter `documentation/validation_logs` bestaetigen.
- [x] Containerbasierten TypeScript-Check (`npm run check`) fuer den Guided-Minimalsplit ueber frische Logdateien unter `documentation/validation_logs` erfolgreich bestaetigen.
- [x] IDE-Diagnostik fuer `server/routes.ts`, `server/guidedRoutes.ts`, `server/guidedRouteRegistrySupport.ts`, `server/guidedFinalizeRoutes.ts`, `server/guidedFinalizeStreamRoute.ts`, `server/aiRouteSupport.ts`, `server/guidedRouteSupport.ts`, `tests/aiRouteSupport.test.ts` und `tests/guidedRouteSupport.test.ts` ohne Befunde pruefen.
- [x] `tests/aiRouteSupport.test.ts`, `tests/guidedRouteSupport.test.ts`, `tests/guidedQuestionUtils.test.ts` und `tests/guidedAiService.test.ts` nach dem Guided-Routen-Split im Container gruen (`9/9`) ueber frische Logdateien unter `documentation/validation_logs` bestaetigen.
- [x] Containerbasierten TypeScript-Check (`npm run check`) nach vollem `server/`-/`tests/`-Sync im Container gruen bestaetigen.
- [x] IDE-Diagnostik fuer `server/routes.ts`, `server/integrationRoutes.ts` und `tests/integrationRoutes.test.ts` ohne Befunde pruefen.
- [x] `tests/integrationRoutes.test.ts` nach dem Integrations-Split im Container gruen (`5/5`) bestaetigen.
- [x] IDE-Diagnostik fuer `server/routes.ts`, `server/prdMaintenanceRoutes.ts` und `tests/prdMaintenanceRoutes.test.ts` ohne Befunde pruefen.
- [x] `tests/prdMaintenanceRoutes.test.ts` nach dem PRD-Maintenance-Split im Container gruen (`5/5`) ueber Logdatei bestaetigen.
- [x] Containerbasierten TypeScript-Check (`npm run check`) nach dem PRD-Maintenance-Split ueber Logdatei bestaetigen.
- [x] IDE-Diagnostik fuer `server/routes.ts`, `server/prdVersionRoutes.ts` und `tests/prdVersionRoutes.test.ts` ohne Befunde pruefen.
- [x] `tests/prdVersionRoutes.test.ts` nach dem Versions-Split im Container gruen (`6/6`) ueber Workspace-Logdatei bestaetigen.
- [x] Containerbasierten TypeScript-Check (`npm run check`) nach dem Versions-Split ueber Workspace-Logdatei bestaetigen.
- [x] IDE-Diagnostik fuer `server/routes.ts`, `server/prdShareRoutes.ts` und `tests/prdShareRoutes.test.ts` ohne Befunde pruefen.
- [x] `tests/prdShareRoutes.test.ts` nach dem Share-Split im Container gruen (`8/8`) ueber Workspace-Logdatei bestaetigen.
- [x] Containerbasierten TypeScript-Check (`npm run check`) nach dem Share-Split ueber Workspace-Logdatei bestaetigen.
- [x] IDE-Diagnostik fuer `server/routes.ts`, `server/prdCommentRoutes.ts` und `tests/prdCommentRoutes.test.ts` ohne Befunde pruefen.
- [x] `tests/prdCommentRoutes.test.ts` nach dem Comments-Split im Container gruen (`4/4`) ueber Workspace-Logdatei bestaetigen.
- [x] Containerbasierten TypeScript-Check (`npm run check`) nach dem Comments-Split ueber Workspace-Logdatei bestaetigen.
- [x] IDE-Diagnostik fuer `server/routes.ts`, `server/prdApprovalRoutes.ts` und `tests/prdApprovalRoutes.test.ts` ohne Befunde pruefen.
- [x] `tests/prdApprovalRoutes.test.ts` nach dem Approval-Split im Container gruen (`7/7`) ueber Workspace-Logdatei bestaetigen.
- [x] Containerbasierten TypeScript-Check (`npm run check`) nach dem Approval-Split ueber Workspace-Logdatei bestaetigen.

## Stabilitaetsauswertung 07.03.2026

- 12/12 Smoke-Kombinationen sind im Container gruen; es gibt aktuell keine harten Compiler- oder Workflow-Blocker mehr.
- Die zuvor P1-betroffenen Kombinationen `technical/simple`, `technical/guided`, `product-launch/iterative`, `product-launch/guided` und `epic/guided` wurden nach Minimal-Fix strikt sequenziell erneut validiert und sind alle gruen.
- P1 ist damit umgesetzt: Mid-Confidence-Near-Duplicates werden jetzt nur mit zusaetzlich starkem strukturiertem Inhalts-Overlap hochgestuft, statt Namensnaehe global zu lockern.
- Guided ist der sensitivste Pfad: unter Rate-Limit-/Fallback-Druck steigen Tokenverbrauch, Laufzeit und inhaltliche Drift deutlicher als bei `simple` oder `iterative`.
- Compiler-Fallback-Sektionen werden frueher erkannt: Template-Fallback-Opener aus Basis- und templatespezifischen Fallbacks laufen jetzt ueber eine gemeinsame zentrale Erkennung und werden bereits im Compiler sichtbar.
- Explizit vom Compiler selbst eingefuegte Recovery-Sektionen werden dabei nicht doppelt als generische Modellausgabe bestraft; sie bleiben ueber `fallbackSections` separat nachvollziehbar.
- Die Template-Semantik ist zusaetzlich abgesichert: fuer Templates mit `featureNameSignals` zaehlen bei neutraleren Titeln jetzt auch klar template-spezifische Feature-Inhalte; damit werden insbesondere `product-launch`-Runs weniger unnoetig feature-name-getrieben bewertet.
- Die Persistenz der Smoke-Artefakte ist jetzt abgesichert: `e2e/smoke-12-combos.e2e.spec.ts` legt Resultate und Laufmetriken dauerhaft unter `documentation/smoke_results` ab und schreibt pro Auswahl sowohl eine timestamped JSON-Datei als auch eine stabile `latest`-Datei.

## Priorisierte naechste Verbesserungen

- [x] P1: Near-Duplicates frueher und templatespezifischer reduzieren, damit weniger `feature_near_duplicates_unmerged` in den finalen Runs verbleiben.
- [x] P2: Guided unter Rate-Limit-/Fallback-Druck robuster machen, damit Qualitaet, Laufzeit und Kosten weniger stark schwanken.
- [x] P3: Compiler-Fallback-Sektionen frueher minimieren statt erst spaet im Content-Review umzuschreiben.
- [x] P4: Template-Semantik staerker inhaltsbasiert pruefen, nicht nur ueber Feature-Namen und Signalwoerter.
- [x] P5: Resultate und Laufmetriken aller 12 Kombinationen dauerhaft persistieren, damit kuenftige Auswertungen vollstaendig reproduzierbar bleiben.

## Refactoring-Roadmap 08.03.2026

- Phase 0 / Quick Wins:
  - Leere Root-Artefakte (`fallbackModel`, `generatorModel`, `reviewerModel`, `tier`, `tierModels`) und offensichtliche Strukturreste bereinigen oder in die Zielstruktur ueberfuehren.
  - Kleine First-Party-Dateien mit fehlendem Header und fehlender Aenderungsdokumentation im Batch nachziehen; vendor-/ui-nahe Fremdkomponenten separat behandeln.
  - Kleine sprachliche Inkonsistenzen und triviale Fehltexte in kleinen, risikoarmen Dateien vereinheitlichen.
  - Stille Defaults/Fallbacks markieren, sofern sie ohne Logikumbau transparent gemacht werden koennen.
  - Status Paket 1: Root-Artefakte in `to_delete/phase0_root_artefakte_08_03_2026` verschoben; erste kleine First-Party-Dateien mit Header/Aenderungsdoku versehen.
  - Status Paket 2: `client/src/lib/authUtils.ts`, `client/src/lib/reviewerSelection.ts`, `client/src/lib/authRoutes.ts`, `server/guidedPrdCompiler.ts`, `server/emailUtils.ts` und `client/src/pages/not-found.tsx` standardisiert; Frontend-Auth-Default in `authRoutes.ts` explizit markiert.
- Phase 1 / Inhaltliche Sicherheitsbereinigung:
  - Generische PRD-Inhaltsfallbacks im Compiler auf Fail-Fast bzw. explizit sichtbare Diagnose umstellen.
  - Tests fuer fehlende Abschnitte, degradierte Compiler-Ergebnisse und sichtbare Fallback-Markierung erweitern.
  - Status: Finalizer erzwingt in `generate` bei `excessive_fallback_sections` jetzt Repair/Reject; gezielte Finalizer-/Guided-Regressionen und `npm run check` sind im Container gruen.
- Phase 2 / Backend-God-Files zerlegen:
  - `server/routes.ts` nach Domänen splitten (`auth`, `settings`, `templates`, `prds`, `ai`, `share`, `approval`, `export`).
  - `server/openrouter.ts` in Tier-Konfiguration, Cooldowns/Circuit-Breaker und Call-Orchestrierung aufteilen.
  - `server/prdCompiler.ts` in Normalisierung, Validierung, Qualitätsanalyse und Fallback-/Section-Policies trennen.
  - Status erster Minimal-Split: Repair-Prompt-Helfer nach `server/prdCompilerRepairPrompt.ts` extrahiert; `server/prdCompilerFinalizer.ts` ist damit auf 385 Zeilen reduziert und unveraendertes Laufzeitverhalten wurde per Zieltests und `npm run check` bestaetigt.
  - Status zweiter Minimal-Split: Feature-Depth-/Hint-Helfer nach `server/prdFeatureDepth.ts` extrahiert; `server/prdCompiler.ts` ist damit auf 906 Zeilen reduziert und rueckwaertskompatibel per Zieltests, IDE-Diagnostik und `npm run check` bestaetigt.
  - Status dritter Minimal-Split: interne Normalisierungs-/Parse-Helfer nach `server/prdCompilerNormalization.ts` extrahiert; `server/prdCompiler.ts` ist damit auf 869 Zeilen reduziert und per Compiler-Regressionen, IDE-Diagnostik und `npm run check` bestaetigt.
  - Status vierter Minimal-Split: Merge-/Improve-Helfer nach `server/prdCompilerMerge.ts` extrahiert; `server/prdCompiler.ts` ist damit auf 698 Zeilen reduziert und per Compiler-Regressionen, IDE-Diagnostik und `npm run check` bestaetigt.
  - Status fuenfter Minimal-Split: Required-Section-/Section-Depth-Helfer nach `server/prdCompilerSectionPolicy.ts` extrahiert; `server/prdCompiler.ts` ist damit auf 670 Zeilen reduziert und per Compiler-Regressionen, IDE-Diagnostik und `npm run check` bestaetigt.
  - Status sechster Minimal-Split: Validierungs-Helfer nach `server/prdCompilerValidation.ts` extrahiert; `server/prdCompiler.ts` ist damit auf 353 Zeilen reduziert und per Compiler-Regressionen, IDE-Diagnostik und `npm run check` bestaetigt.
  - Status siebter Minimal-Split: Cooldown-/Circuit-Breaker-Helfer nach `server/openrouterCooldowns.ts` extrahiert; `server/openrouter.ts` ist damit auf 1076 Zeilen reduziert und per OpenRouter-Regressionen, IDE-Diagnostik und `npm run check` bestaetigt.
  - Status achter bis elfter Minimal-Split: weitere OpenRouter-Bloecke fuer Tier-/Fallback-Konfiguration, Fallback-Orchestrierung, Models-API und User-Preferences in eigene Module extrahiert; `server/openrouter.ts` liegt nach Vollcount bei 481 Zeilen und ist damit vorerst aus dem Groessen-Blocker-Kreis heraus.
  - Status zwoelfter Minimal-Split: Provider-/Modell-Routen aus `server/routes.ts` nach `server/modelProviderRoutes.ts` extrahiert; gezielte Regressionen in `tests/modelProviderRoutes.test.ts`, IDE-Diagnostik und `npm run check` sind gruen.
  - Status dreizehnter Minimal-Split: Guided-Compiler-Gates, Prompt-Builder und Fragen-/Antwort-Helfer aus `server/guidedAiService.ts` extrahiert; gezielte Guided-Regressionen und `npm run check` sind gruen, `server/guidedAiService.ts` liegt nach Vollcount bei 488 Zeilen und ist damit kein Groessenblocker mehr.
  - Status vierzehnter Minimal-Split: Guided-Routen aus `server/routes.ts` nach `server/guidedRoutes.ts`, `server/guidedRouteRegistrySupport.ts`, `server/guidedFinalizeRoutes.ts` und `server/guidedFinalizeStreamRoute.ts` extrahiert; gezielte Guided-Support-Regressionen, IDE-Diagnostik und `npm run check` sind gruen, `server/routes.ts` bleibt mit 2076 Zeilen zusammen mit `server/dualAiService.ts` der wichtigste verbleibende Backend-Restblocker.
  - Status fuenfzehnter Minimal-Split: Linear-/Dart-Integrationsrouten aus `server/routes.ts` nach `server/integrationRoutes.ts` extrahiert; gezielte Regressionen in `tests/integrationRoutes.test.ts`, IDE-Diagnostik und `npm run check` sind gruen.
  - Status sechzehnter Minimal-Split: PRD-Export-, Restore- und Structure-Routen aus `server/routes.ts` nach `server/prdMaintenanceRoutes.ts` extrahiert; `tests/prdMaintenanceRoutes.test.ts`, IDE-Diagnostik und `npm run check` sind gruen, `server/routes.ts` liegt danach bei 1851 Zeilen und `server/dualAiService.ts` bleibt der groesste Restblocker.
  - Status siebzehnter Minimal-Split: Versionsrouten aus `server/routes.ts` nach `server/prdVersionRoutes.ts` extrahiert; `tests/prdVersionRoutes.test.ts`, IDE-Diagnostik und `npm run check` sind gruen, `server/routes.ts` liegt danach bei 1811 Zeilen und `server/dualAiService.ts` bleibt der groesste Restblocker.
  - Status achtzehnter Minimal-Split: Share-Routen aus `server/routes.ts` nach `server/prdShareRoutes.ts` extrahiert; `tests/prdShareRoutes.test.ts`, IDE-Diagnostik und `npm run check` sind gruen, `server/routes.ts` liegt danach bei 1763 Zeilen und `server/dualAiService.ts` bleibt der groesste Restblocker.
  - Status neunzehnter Minimal-Split: Comments-Routen aus `server/routes.ts` nach `server/prdCommentRoutes.ts` extrahiert; `tests/prdCommentRoutes.test.ts`, IDE-Diagnostik und `npm run check` sind gruen, `server/routes.ts` liegt danach bei 1565 Zeilen und `server/dualAiService.ts` bleibt der groesste Restblocker.
  - Status zwanzigster Minimal-Split: Approval-Routen aus `server/routes.ts` nach `server/prdApprovalRoutes.ts` extrahiert; `tests/prdApprovalRoutes.test.ts`, IDE-Diagnostik und `npm run check` sind gruen, `server/routes.ts` liegt aktuell bei 1602 Zeilen und `server/dualAiService.ts` bleibt der groesste Restblocker.
- Phase 3 / Frontend-God-Files zerlegen:
  - `client/src/pages/Editor.tsx` in Container, Toolbar/Header, Editor-State, Save/Delete-Aktionen, Sidebars und AI-Integration zerlegen.
  - `DualAiDialog.tsx` und `GuidedAiDialog.tsx` in State-Hooks, API-/SSE-Logik und Presentational-Komponenten trennen.
- Phase 4 / Reststandardisierung:
  - Sprachstandard fuer Logs, Kommentare, Testnamen und Benutzertexte vereinheitlichen.
  - Weitere grosse Testdateien entlang fachlicher Teilbereiche aufteilen.
  - Danach erneute Regelpruefung und gezielte Container-Validierung durchfuehren.