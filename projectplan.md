<!--
Author: rahn
Datum: 06.03.2026
Version: 1.2
Beschreibung: Arbeitsplan zur Stabilisierung des Compiler-Verhaltens über alle 12 Kombinationen
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

## Problemanalyse

- [x] Guided nutzt im Finalizer noch keinen `contentRefineGenerator` wie `simple` und `iterative`.
- [x] Der API-Smoke-Test nutzt bisher keinen echten `prdId`-Flow und bildet den Template-Kontext dadurch unvollständig ab.
- [x] Containerbasierte Basisvalidierung für Guided-Test und TypeScript-Check ist abgeschlossen.
- [x] Der feste Clerk-Testnutzer ist auf kostenarme Free-Modelle für Smoke-Runs umgestellt.
- [x] Die Kombinationen sollen nicht mehr als 12er-Block, sondern einzeln mit Analyse-/Fix-/Re-Run-Schleife abgearbeitet werden.
- [x] Formal gefüllte, aber semantisch falsch gemappte Features und Feature-Placeholder werden im Reviewer bisher nicht gezielt erkannt.
- [x] Der semantische Reviewer-Fix ist im Container mit 30/30 Tests validiert.
- [ ] Das Development-Tier hängt bei Free-Ausfällen noch direkte Last-Resort-Provider-Fallbacks an.
- [ ] Aktive Modell-Cooldowns duerfen Guided/Expansion nicht in einen kuenstlichen 0-/1-Modell-Zustand drängen.
- [x] Guided darf degradierte Endergebnisse mit massiven Compiler-Fallback-Sections trotz Refine-/Fallback-Pfad nicht mehr akzeptieren.

## Aufgaben

- [x] Guided-Finalizer auf Parität bringen.
- [x] Smoke-Test auf echtes PRD mit `templateId`/`prdId` umbauen.
- [x] Änderungen mit gezielten Tests und TypeScript-Prüfung validieren.
- [x] Smoke-Test auf Filter für Einzelkombinationen vorbereiten.
- [x] Reviewer um semantische Feature-Prüfung und Placeholder-Backup für Features ergänzen.
- [ ] Direct-Provider-Last-Resort-Fallbacks im Development-Tier sperren und Regression absichern.
- [ ] Cooldown-erschöpfte Fallback-Kette im OpenRouter-Client kontrolliert als Last-Resort nachziehen.
- [x] Kombinationen nacheinander ausführen, Fehler beheben und jeweils erneut validieren.
- [x] Guided-Finalizer/Quality-Fallback so absichern, dass `excessive_fallback_sections` nicht als degradierter Erfolg endet.

## Überprüfung

- [x] Vitest für Guided-Service-Erweiterung im Container ausführen.
- [x] TypeScript-Check im Container ausführen.
- [x] Playwright-Spec `e2e/smoke-12-combos.e2e.spec.ts` per `--list` im Container prüfen.
- [x] `CLERK_SECRET_KEY` im Container verifizieren.
- [x] Testnutzer auf Free-Modelle für Generator/Reviewer/Fallback umstellen.
- [x] Ergebnisse dokumentieren.
- [x] Reviewer-Semantiktests im Container grün (`30/30`).
- [ ] OpenRouter-Regression für Development-Tier erneut im Container prüfen.
- [ ] Guided-Cooldown-Regression im Container prüfen.
- [x] Erste Einzelkombination im Container ausführen und stabilisieren.
- [x] Guided-Qualitaetsguard mit gezielten Vitest-Tests und echtem `epic/guided`-Re-Run pruefen.

## Stabilitaetsauswertung 07.03.2026

- 12/12 Smoke-Kombinationen sind im Container gruen; es gibt aktuell keine harten Compiler- oder Workflow-Blocker mehr.
- Die zuvor P1-betroffenen Kombinationen `technical/simple`, `technical/guided`, `product-launch/iterative`, `product-launch/guided` und `epic/guided` wurden nach Minimal-Fix strikt sequenziell erneut validiert und sind alle gruen.
- P1 ist damit umgesetzt: Mid-Confidence-Near-Duplicates werden jetzt nur mit zusaetzlich starkem strukturiertem Inhalts-Overlap hochgestuft, statt Namensnaehe global zu lockern.
- Guided ist der sensitivste Pfad: unter Rate-Limit-/Fallback-Druck steigen Tokenverbrauch, Laufzeit und inhaltliche Drift deutlicher als bei `simple` oder `iterative`.
- Compiler-Fallback-Sektionen werden inzwischen erkannt und koennen geblockt werden, entstehen architektonisch aber weiterhin relativ spaet und muessen haeufig erst im Content-Review umgeschrieben werden.
- Die Template-Semantik ist zusaetzlich abgesichert: fuer `technical` zaehlen jetzt bei neutraleren Titeln auch klar technische Feature-Inhalte; eine breitere inhaltsbasierte Absicherung bleibt als P4 offen.
- Die Persistenz der Smoke-Artefakte ist unvollstaendig: fuer die Querschnittsauswertung lagen nur noch 6 von 12 Result-JSONs direkt im Container vor.

## Priorisierte naechste Verbesserungen

- [x] P1: Near-Duplicates frueher und templatespezifischer reduzieren, damit weniger `feature_near_duplicates_unmerged` in den finalen Runs verbleiben.
- [ ] P2: Guided unter Rate-Limit-/Fallback-Druck robuster machen, damit Qualitaet, Laufzeit und Kosten weniger stark schwanken.
- [ ] P3: Compiler-Fallback-Sektionen frueher minimieren statt erst spaet im Content-Review umzuschreiben.
- [ ] P4: Template-Semantik staerker inhaltsbasiert pruefen, nicht nur ueber Feature-Namen und Signalwoerter.
- [ ] P5: Resultate und Laufmetriken aller 12 Kombinationen dauerhaft persistieren, damit kuenftige Auswertungen vollstaendig reproduzierbar bleiben.