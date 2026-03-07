<!--
Author: rahn
Datum: 07.03.2026
Version: 1.0
Beschreibung: Root-Cause-spezifischer Minimal-Plan fuer P1 zur Reduktion verbleibender Near-Duplicate-Warnungen im PRD-Compiler
-->

## Ziel

P1 reduziert verbleibende `feature_near_duplicates_unmerged`-Warnungen moeglichst frueh und minimal, ohne aggressive Fehl-Merges oder neue Scope-Regressionen einzufuehren.

## Beobachtete Problemfaelle

- `epic/guided`: Warning `feature_near_duplicates_unmerged`
- `technical/simple`: Warning `feature_near_duplicates_unmerged`
- `technical/guided`: Warning `feature_aggregation_applied`
- `product-launch/iterative`: Warning `feature_near_duplicates_unmerged`
- `product-launch/guided`: Warnings `feature_aggregation_applied`, `feature_near_duplicates_unmerged`

## Aktuelle Root-Cause-Hypothesen

1. Die Hochstufung von Near-Duplicates zu echten Aggregationskandidaten ist aktuell zu stark auf Namensaehnlichkeit und CRUD-Familien konzentriert.
2. Mittlere Faelle bleiben als Warnings sichtbar, obwohl einzelne davon mit zusaetzlichem Inhaltssignal wahrscheinlich sicher mergebar waeren.
3. Es gibt bereits eine gute False-Positive-Sicherung fuer `epic` ueber `isEpicCapabilitySplitPair(...)`, aber kaum templatespezifische Positiv-Heuristiken fuer `technical` und `product-launch`.
4. Guided erzeugt eher semantisch nahe Varianten desselben Features; diese landen haeufig im Mid-Confidence-Bereich statt in High-Confidence-Clustern.

## Betroffene Dateien

- Primaer: `server/prdQualitySignals.ts`
- Tests: `tests/prdQualitySignals.test.ts`
- Nur falls zwingend noetig spaeter: `server/prdCompiler.ts`

## Minimalstrategie

1. Zuerst nur `server/prdQualitySignals.ts` anfassen.
2. Keine Guided-/Fallback-/Finalizer-Aenderungen in P1.
3. Vorhandene `epic`-Schutzlogik gegen Capability-Split-Falsch-Merges unveraendert erhalten.
4. Neue Heuristik nur dann zulassen, wenn sie klar begruendbare Mid-Confidence-Faelle hebt, nicht aber bestehende False-Positive-Schutzfaelle oeffnet.

## Konkreter Untersuchungs- und Umsetzungsplan

### Schritt 1 - Mid-Confidence-Faelle genauer klassifizieren

- In `findFeatureAggregationCandidates(...)` die Faelle analysieren, die heute nur in `nearDuplicates` landen.
- Pruefen, ob sich ein zweites Entscheidungssignal sauber ergaenzen laesst, zum Beispiel:
  - gemeinsamer fachlicher Kern ueber Objekt-/Core-Tokens
  - templatespezifische Signals fuer `technical` oder `product-launch`
  - zusaetzliche inhaltliche Ueberschneidung aus vorhandenen Feature-Feldern

### Schritt 2 - Kleine category-aware Heuristik pruefen

- Eine minimale, templatespezifische Positiv-Heuristik nur fuer klar begrenzte Faelle pruefen.
- `epic` darf dabei nicht aggressiver gemerged werden; die vorhandene `epicCapabilitySplit`-Schranke bleibt bestehen.

### Schritt 3 - Regressionen gezielt absichern

- `tests/prdQualitySignals.test.ts` um neue Faelle erweitern:
  - positive Regression fuer ein technisch nahes Duplicate-Paar
  - positive Regression fuer ein `product-launch`-nahes Duplicate-Paar
  - negative Regressionen muessen weiter gruen bleiben:
    - Checkout-Teilschritte
    - Cart-CRUD-Unterscheidungen
    - `epic`-Capability-Split-Faelle
    - Auth-Faelle, die bewusst nicht gemerged werden duerfen

### Schritt 4 - Erst klein, dann Smoke

- Zuerst nur gezielte Vitest-Validierung
- Danach optional TypeScript-Check
- Danach die betroffenen Smoke-Kombinationen einzeln und strikt sequenziell:
  1. `technical/simple`
  2. `technical/guided`
  3. `product-launch/iterative`
  4. `product-launch/guided`
  5. `epic/guided`

## Erfolgskriterien

- Mindestens ein echter Near-Duplicate-Warning-Pfad wird reduziert oder sauberer in Aggregation ueberfuehrt.
- Keine Regression in den vorhandenen False-Positive-Schutztests.
- Keine neue Verschlechterung bei Feature-Integritaet oder Feature-Anzahl.
- Die Validierung erfolgt streng nach Analyse -> Minimal-Fix -> derselbe Re-Run -> erst dann weiter.

## Nicht Teil von P1

- Guided-Rate-Limit-/Cooldown-Strategie
- spaete Compiler-Fallback-Sektionen
- inhaltsstaerkere Template-Semantik jenseits der Duplicate-Logik
- Artefaktpersistenz aller 12 Runs

## Naechster direkter Arbeitsschritt

Als Erstes werden die bestehenden Near-Duplicate-Tests und die aktuelle Mid-Confidence-Logik in `server/prdQualitySignals.ts` gegen die beobachteten Warnmuster gelesen. Danach folgt ein minimaler, root-cause-spezifischer Code-Fix nur in diesem Bereich.