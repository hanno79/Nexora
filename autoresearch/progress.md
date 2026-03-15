# AutoPRD Progress Dashboard

> Automatisch generiert nach jedem Experiment-Run.

## Übersicht

| Metrik | Wert |
|---|---|
| **Baseline-Score** | 105 |
| **Aktueller Best-Score** | 93.5 |
| **Runs gesamt** | 2 |
| **Kept** | 2 |
| **Discarded** | 0 |
| **Erfolgsquote** | 100.0% |

## Top Verbesserungen

| Run | Hypothese | Delta | Score |
|---|---|---|---|
| 2 | OutOfScope Repair-Prompt mit Projektkontext angereichert (Feature-Namen, System-Vision) | -11.5 | 93.5 |

## Letzte 5 Runs

| Run | Timestamp | Hypothese | Score | Delta | Kept |
|---|---|---|---|---|---|
| 2 | 2026-03-15T17:33:25 | OutOfScope Repair-Prompt mit Projektkontext angereichert (Feature-Namen, System-Vision) | 93.5 | -11.5 | ✓ |
| 1 | 2026-03-15T17:21:16 | Baseline mit Graceful Degradation - alle 3 Benchmarks | 105 | — | ✓ |

## Statistik (letzter Run)

| Metrik | Wert |
|---|---|
| **Median** | 93.5 |
| **Mean** | 98.0 |
| **Stddev** | ±39.6 |
| **Min/Max** | 47..158 |
| **Runs** | 4 |
| **Konsistenz** | 75% |
| **Alle Scores** | 98, 47, 89, 158 |
| **Fehlgeschlagene Runs** | 1 |

## Per-Benchmark Breakdown (Median-Run)

### complex
Score: 50 (E:1×10=10 W:10×1=10 B:0×20=0 FB:0×5=0 MS:0×8=0 T:0 I:30) Features:10
Status: failed_quality | Tokens: 120801 | Dauer: 419893ms

### edge_case
Score: 43 (E:1×10=10 W:3×1=3 B:0×20=0 FB:0×5=0 MS:0×8=0 T:0 I:30) Features:9
Status: failed_quality | Tokens: 98948 | Dauer: 335900ms

### simple
Score: 5 (E:0×10=0 W:5×1=5 B:0×20=0 FB:0×5=0 MS:0×8=0 T:0 I:0) Features:7
Status: passed | Tokens: 71093 | Dauer: 115053ms
