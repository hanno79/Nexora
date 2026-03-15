# AutoPRD Progress Dashboard

> Automatisch generiert nach jedem Experiment-Run.

## Übersicht

| Metrik | Wert |
|---|---|
| **Baseline-Score** | 105 |
| **Aktueller Best-Score** | 3 |
| **Runs gesamt** | 10 |
| **Kept** | 4 |
| **Discarded** | 6 |
| **Erfolgsquote** | 40.0% |

## Top Verbesserungen

| Run | Hypothese | Delta | Score |
|---|---|---|---|
| 8 | Reviewer/Repair-Modell: deepseek-v3 statt gemini fuer frische Perspektive bei OutOfScope Repairs | -37.5 | 48.5 |
| 2 | OutOfScope Repair-Prompt mit Projektkontext angereichert (Feature-Namen, System-Vision) | -11.5 | 93.5 |
| 3 | Reintroduced/Future-Leakage Repair-Prompt mit expliziter Nicht-Reintroduce Anweisung | -2 | 92 |

## Letzte 5 Runs

| Run | Timestamp | Hypothese | Score | Delta | Kept |
|---|---|---|---|---|---|
| 9 | 2026-03-15T20:47:26 | Semantic-Repair auch auf deepseek-v3: konsistentere Repairs ueber alle Phasen | 3 | -46 | ✗ |
| 8 | 2026-03-15T20:03:48 | Reviewer/Repair-Modell: deepseek-v3 statt gemini fuer frische Perspektive bei OutOfScope Repairs | 48.5 | -37.5 | ✓ |
| 7 | 2026-03-15T19:52:16 | Generator-Modell: gpt-4.1-mini statt gemini-2.5-flash fuer bessere Out-of-Scope Qualitaet | 93 | 7 | ✗ |
| 6 | 2026-03-15T19:39:41 | System-Prompt mit expliziten Qualitaetsregeln fuer OutOfScope, AcceptanceCriteria und Feature-Completeness | 224 | 138 | ✗ |
| 5 | 2026-03-15T18:58:02 | maxRepairPasses 3→5: Mehr Repair-Zyklen für hartnäckige OutOfScope-Boilerplate | 26 | -60 | ✗ |

## Statistik (letzter Run)

> Baseline-Run (nur 1 Durchlauf, keine Statistik)

## Per-Benchmark Breakdown (Median-Run)

### complex
✗ FAILED (aus Aggregation ausgeschlossen)
Dauer: 629344ms
⚠ PRD compiler quality gate failed after 3 repair attempt(s): Section appears generic and not context-specific: Out of Scope

### edge_case
✗ FAILED (aus Aggregation ausgeschlossen)
Dauer: 542172ms
⚠ PRD compiler quality gate failed after 3 repair attempt(s): Section appears generic and not context-specific: Out of Scope

### simple
Score: 3 (E:0×10=0 W:3×1=3 B:0×20=0 FB:0×5=0 MS:0×8=0 T:0 I:0) Features:7
Status: passed | Tokens: 86611 | Dauer: 344819ms
