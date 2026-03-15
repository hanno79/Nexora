# AutoPRD Progress Dashboard

> Automatisch generiert nach jedem Experiment-Run.

## Übersicht

| Metrik | Wert |
|---|---|
| **Baseline-Score** | 105 |
| **Aktueller Best-Score** | 92 |
| **Runs gesamt** | 3 |
| **Kept** | 3 |
| **Discarded** | 0 |
| **Erfolgsquote** | 100.0% |

## Top Verbesserungen

| Run | Hypothese | Delta | Score |
|---|---|---|---|
| 2 | OutOfScope Repair-Prompt mit Projektkontext angereichert (Feature-Namen, System-Vision) | -11.5 | 93.5 |
| 3 | Reintroduced/Future-Leakage Repair-Prompt mit expliziter Nicht-Reintroduce Anweisung | -2 | 92 |

## Letzte 5 Runs

| Run | Timestamp | Hypothese | Score | Delta | Kept |
|---|---|---|---|---|---|
| 3 | 2026-03-15T18:14:48 | Reintroduced/Future-Leakage Repair-Prompt mit expliziter Nicht-Reintroduce Anweisung | 92 | -2 | ✓ |
| 2 | 2026-03-15T17:33:25 | OutOfScope Repair-Prompt mit Projektkontext angereichert (Feature-Namen, System-Vision) | 93.5 | -11.5 | ✓ |
| 1 | 2026-03-15T17:21:16 | Baseline mit Graceful Degradation - alle 3 Benchmarks | 105 | — | ✓ |

## Statistik (letzter Run)

| Metrik | Wert |
|---|---|
| **Median** | 92 |
| **Mean** | 85.8 |
| **Stddev** | ±20.4 |
| **Min/Max** | 52..107 |
| **Runs** | 4 |
| **Konsistenz** | 75% |
| **Alle Scores** | 92, 52, 107, 92 |
| **Fehlgeschlagene Runs** | 0 |

## Per-Benchmark Breakdown (Median-Run)

### complex
Score: 42 (E:1×10=10 W:2×1=2 B:0×20=0 FB:0×5=0 MS:0×8=0 T:0 I:30) Features:5
Status: failed_quality | Tokens: 164747 | Dauer: 481926ms

### edge_case
Score: 45 (E:1×10=10 W:5×1=5 B:0×20=0 FB:0×5=0 MS:0×8=0 T:0 I:30) Features:9
Status: failed_quality | Tokens: 101885 | Dauer: 340670ms

### simple
Score: 5 (E:0×10=0 W:5×1=5 B:0×20=0 FB:0×5=0 MS:0×8=0 T:0 I:0) Features:7
Status: passed | Tokens: 65545 | Dauer: 103616ms
