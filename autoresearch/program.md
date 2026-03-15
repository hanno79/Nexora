# AutoPRD — Agent Instructions

## Ziel

Verbessere die PRD-Compiler Repair-Strategien so, dass der Composite Quality Score
über alle Benchmark-PRDs sinkt. Ziel: Score → 0 (keine Errors, keine Warnings,
keine Blocking Issues, keine Fallback Sections).

## Was du modifizieren darfst

### Primäre Targets (Repair-Strategien)
- `server/prdCompilerFinalizer.ts` — Repair-Loop-Logik, Repair-Pass-Steuerung,
  Degradation-Erkennung, Fallback-Strategien
- `server/guidedPromptBuilders.ts` — Repair-Prompt-Templates, Instruktionen an das LLM
  für Reparaturpässe

### Sekundäre Targets (wenn nötig)
- `server/prdContentReviewer.ts` — Content-Review-Logik und Rewrite-Prompts
- `server/prdFeatureDepth.ts` — Feature-Tiefe-Recovery und Enrichment

## Was du NICHT modifizieren darfst

- `autoresearch/score.ts` — Die Score-Funktion ist fix
- `autoresearch/run_experiment.ts` — Der Runner ist fix
- `autoresearch/test_inputs/*` — Die Benchmark-PRDs sind fix
- `server/prdCompilerValidation.ts` — Die Validierungsregeln sind fix
- `server/prdDeterministicSemanticLints.ts` — Die Lint-Regeln sind fix
- `server/prdQualitySignals.ts` — Die Quality-Signal-Erkennung ist fix
- Tests dürfen nicht gelöscht oder abgeschwächt werden

## Constraints

1. **Tests müssen grün bleiben**: `npx vitest run` muss vor jedem Commit bestehen
2. **Keine neuen Dependencies**: Keine neuen npm packages hinzufügen
3. **Keine API-Änderungen**: Funktions-Signaturen der exportierten Funktionen nicht ändern
4. **Eine Änderung pro Experiment**: Mache genau EINE fokussierte Änderung pro Durchlauf
5. **Hypothese dokumentieren**: Beschreibe VOR der Änderung was du vermutest und warum

## Experiment-Ablauf

```
1. Lies den aktuellen Repair-Code und die letzten Experiment-Ergebnisse
2. Formuliere eine Hypothese (z.B. "Repair-Prompt enthält zu wenig Kontext
   über die spezifischen Fehler")
3. Implementiere EINE fokussierte Änderung
4. Führe aus: npx tsx autoresearch/run_experiment.ts --hypothesis "deine Hypothese" --changed-file "datei.ts"
5. Wenn Score verbessert → git commit mit Hypothese als Message
6. Wenn Score gleich/schlechter → git checkout -- server/ (revert)
7. Repeat
```

### Multi-Run Validierung (Determinismus-Schutz)

Der Runner verwendet einen gestuften Ansatz um LLM-Nondeterminismus auszugleichen:

1. **Stufe 1 — Schnell-Check** (1 Run): Sofortige Ablehnung bei deutlicher
   Verschlechterung (>20% über Baseline), spart Kosten
2. **Stufe 2 — Validierung** (N zusätzliche Runs, default 3): Nur bei
   Verbesserung im Schnell-Check
3. **Stufe 3 — Entscheidung**: Kept nur wenn **Median < Baseline** UND
   **≥75% der Runs** besser als Baseline (Konsistenz-Check)

Konfiguration: `--validation-runs N` (default 3, `--validation-runs 0` für
Einzelrun wie bisher). Baseline-Runs (erster Run ohne vorherige Ergebnisse)
laufen immer nur 1x.

## Strategie-Hinweise

### Typische Schwachstellen im Repair-Loop
- Repair-Prompts sind zu generisch und adressieren spezifische Fehler nicht direkt
- Feature-Depth-Recovery verliert Acceptance-Criteria oder MainFlow bei Reparaturen
- Content-Review-Rewrites können Features unbeabsichtigt entfernen
- Truncation-Erkennung kann false positives liefern bei kurzen aber vollständigen PRDs
- Semantic-Repair kann in Zyklen geraten wenn sich Fixes gegenseitig aufheben

### Was erfahrungsgemäß hilft
- Fehler-Codes direkt in den Repair-Prompt einbauen (nicht nur "fix issues")
- Repair-Passes mit abnehmendem Scope (erst strukturell, dann inhaltlich)
- Explizite Feature-Preservation-Constraints im Repair-Prompt
- Bessere Kontext-Weitergabe zwischen Repair-Pässen (was wurde im letzten Pass versucht?)

## Metriken

Der Score setzt sich zusammen aus:
- Errors × 10 (schwerwiegende strukturelle/semantische Fehler)
- Warnings × 1 (kleinere Qualitätsprobleme)
- Blocking Issues × 20 (semantische Verifier-Blockaden)
- Fallback Sections × 5 (Compiler-generierte Platzhalter-Sections)
- Missing Sections × 8 (komplett fehlende Pflicht-Sections)
- Truncation Penalty: 50 (wenn Output abgeschnitten wirkt)
- Invalid Structure Penalty: 30 (wenn Parsing fehlschlägt)
