<!--
Author: rahn
Datum: 07.03.2026
Version: 1.0
Beschreibung: Vollstaendige Stabilitaetsauswertung des erfolgreichen 12er-Smoke-Durchlaufs mit priorisierten Folgeschritten P1-P5
-->

## Ziel

Diese Auswertung dokumentiert die wichtigsten Ergebnisse und Restauffaelligkeiten nach der erfolgreichen containerbasierten Stabilisierung aller 12 Smoke-Kombinationen fuer `feature`, `epic`, `technical` und `product-launch` in den Methoden `simple`, `iterative` und `guided`.

## Ergebnislage

- Alle 12 Kombinationen sind aktuell gruen validiert.
- Es gibt keine harten Compiler- oder Workflow-Blocker mehr.
- Die verbleibenden Restthemen betreffen vor allem Qualitaetskonsistenz und semantische Sauberkeit.

## Konsolidierte Resultate

- `feature/simple`: PASS, valid=true, featureCount=14, qualityScore=120, keine Warnings
- `feature/iterative`: PASS, valid=true, featureCount=10, qualityScore=120, keine Warnings
- `feature/guided`: PASS, valid=true, featureCount=9, qualityScore=118, keine Warnings
- `epic/simple`: PASS, valid=true, featureCount=11, qualityScore=120, keine Warnings
- `epic/iterative`: PASS, valid=true, featureCount=12, qualityScore=120, keine Warnings
- `epic/guided`: PASS, valid=true, featureCount=19, qualityScore=117, Warning `feature_near_duplicates_unmerged`
- `technical/simple`: PASS, valid=true, featureCount=14, qualityScore=117, Warning `feature_near_duplicates_unmerged`
- `technical/iterative`: PASS, valid=true, featureCount=13, qualityScore=120, keine Warnings
- `technical/guided`: PASS, valid=true, featureCount=10, qualityScore=117, Warning `feature_aggregation_applied`
- `product-launch/simple`: PASS, valid=true, featureCount=15, qualityScore=120, keine Warnings
- `product-launch/iterative`: PASS, valid=true, featureCount=12, qualityScore=117, Warning `feature_near_duplicates_unmerged`
- `product-launch/guided`: PASS, valid=true, featureCount=16, qualityScore=114, Warnings `feature_aggregation_applied`, `feature_near_duplicates_unmerged`

## Wichtigste Restprobleme

### P1 - Near-Duplicates / konservative Aggregation

- Sichtbar in `epic/guided`, `technical/simple`, `technical/guided`, `product-launch/iterative`, `product-launch/guided`
- Hauptlogik liegt in `server/prdQualitySignals.ts`
- Der Compiler merged nur High-Confidence-Faelle automatisch; mittlere Faelle bleiben als Warnings sichtbar.

### P2 - Guided unter Fallback-/Rate-Limit-Druck

- Guided ist weiterhin der sensitivste und teurere Pfad.
- Relevant sind `server/guidedAiService.ts`, `server/prdCompilerFinalizer.ts` und `server/prdQualityFallback.ts`.

### P3 - Boilerplate-/Fallback-Sektionen entstehen zu spaet im Prozess

- Erkennung funktioniert inzwischen besser, aber oft erst nach Compile/Repair.
- Relevant sind `server/prdCompiler.ts`, `server/prdContentReviewer.ts` und `server/prdTemplateIntent.ts`.

### P4 - Template-Semantik noch teils zu feature-name-getrieben

- Besonders relevant fuer `technical` und `product-launch`.
- Hauptlogik liegt in `server/prdTemplateIntent.ts`.

### P5 - Artefaktpersistenz unvollstaendig

- Fuer die Auswertung lagen spaeter nur noch 6 von 12 Result-JSONs direkt im Container vor.
- Kuenftig sollten alle 12 Resultate und Laufmetriken dauerhaft abgelegt werden.

## Code-Zuordnung der Auffaelligkeiten

- Near-Duplicates / Aggregation: `server/prdQualitySignals.ts`
- Boilerplate / Cross-Section-Repetition: `server/prdQualitySignals.ts`, `server/prdContentReviewer.ts`
- Fallback-Sektionen / Compiler-Qualitaet: `server/prdCompiler.ts`, `server/prdCompilerFinalizer.ts`
- Guided-Repair / Quality-Fallback: `server/guidedAiService.ts`, `server/prdQualityFallback.ts`
- Template-Semantik / Fallback-Templates: `server/prdTemplateIntent.ts`

## Empfohlene Reihenfolge fuer die weitere Arbeit

1. P1 minimal und root-cause-spezifisch angehen
2. gezielte Tests fuer P1 ergaenzen oder anpassen
3. betroffene Smoke-Kombinationen einzeln und strikt sequenziell erneut im Container validieren
4. danach P2, P3, P4 und P5 nacheinander mit derselben Analyse-/Fix-/Re-Run-Logik angehen

## Geplante unmittelbare Fortsetzung

- Als naechster Schritt wird ein separater root-cause-spezifischer Plan fuer P1 erstellt.
- Ziel von P1 ist, verbleibende `feature_near_duplicates_unmerged`-Warnungen moeglichst frueh und minimal zu reduzieren, ohne aggressive Fehl-Merges einzufuehren.