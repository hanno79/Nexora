# AutoPRD Progress Dashboard

> Automatisch generiert nach jedem Experiment-Run.

## Übersicht

| Metrik | Wert |
|---|---|
| **Baseline-Score** | 105 |
| **Aktueller Best-Score** | 26 |
| **Runs gesamt** | 9 |
| **Kept** | 4 |
| **Discarded** | 5 |
| **Erfolgsquote** | 44.4% |

## Top Verbesserungen

| Run | Hypothese | Delta | Score |
|---|---|---|---|
| 8 | Reviewer/Repair-Modell: deepseek-v3 statt gemini fuer frische Perspektive bei OutOfScope Repairs | -37.5 | 48.5 |
| 2 | OutOfScope Repair-Prompt mit Projektkontext angereichert (Feature-Namen, System-Vision) | -11.5 | 93.5 |
| 3 | Reintroduced/Future-Leakage Repair-Prompt mit expliziter Nicht-Reintroduce Anweisung | -2 | 92 |

## Letzte 5 Runs

| Run | Timestamp | Hypothese | Score | Delta | Kept |
|---|---|---|---|---|---|
| 8 | 2026-03-15T20:03:48 | Reviewer/Repair-Modell: deepseek-v3 statt gemini fuer frische Perspektive bei OutOfScope Repairs | 48.5 | -37.5 | ✓ |
| 7 | 2026-03-15T19:52:16 | Generator-Modell: gpt-4.1-mini statt gemini-2.5-flash fuer bessere Out-of-Scope Qualitaet | 93 | 7 | ✗ |
| 6 | 2026-03-15T19:39:41 | System-Prompt mit expliziten Qualitaetsregeln fuer OutOfScope, AcceptanceCriteria und Feature-Completeness | 224 | 138 | ✗ |
| 5 | 2026-03-15T18:58:02 | maxRepairPasses 3→5: Mehr Repair-Zyklen für hartnäckige OutOfScope-Boilerplate | 26 | -60 | ✗ |
| 5 | 2026-03-15T18:58:46 | maxRepairPasses 3->5: Mehr Repair-Zyklen fuer hartnaeckige OutOfScope-Boilerplate | 102 | 16 | ✗ |

## Statistik (letzter Run)

| Metrik | Wert |
|---|---|
| **Median** | 48.5 |
| **Mean** | 48.5 |
| **Stddev** | ±33.6 |
| **Min/Max** | 1..96 |
| **Runs** | 4 |
| **Konsistenz** | 75% |
| **Alle Scores** | 51, 96, 46, 1 |
| **Fehlgeschlagene Runs** | 4 |

## Per-Benchmark Breakdown (Median-Run)

### complex
Score: 5 (E:0×10=0 W:5×1=5 B:0×20=0 FB:0×5=0 MS:0×8=0 T:0 I:0) Features:10
Status: passed | Tokens: 145023 | Dauer: 494670ms

### edge_case
Score: 44 (E:1×10=10 W:4×1=4 B:0×20=0 FB:0×5=0 MS:0×8=0 T:0 I:30) Features:9
Status: failed_quality | Tokens: 90959 | Dauer: 650618ms

### simple
Score: 2 (E:0×10=0 W:2×1=2 B:0×20=0 FB:0×5=0 MS:0×8=0 T:0 I:0) Features:7
Status: passed | Tokens: 83540 | Dauer: 328133ms
