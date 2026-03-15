# AutoPRD Progress Dashboard

> Automatisch generiert nach jedem Experiment-Run.

## Übersicht

| Metrik | Wert |
|---|---|
| **Baseline-Score** | 105 |
| **Aktueller Best-Score** | 92 |
| **Runs gesamt** | 5 |
| **Kept** | 3 |
| **Discarded** | 2 |
| **Erfolgsquote** | 60.0% |

## Top Verbesserungen

| Run | Hypothese | Delta | Score |
|---|---|---|---|
| 2 | OutOfScope Repair-Prompt mit Projektkontext angereichert (Feature-Namen, System-Vision) | -11.5 | 93.5 |
| 3 | Reintroduced/Future-Leakage Repair-Prompt mit expliziter Nicht-Reintroduce Anweisung | -2 | 92 |

## Letzte 5 Runs

| Run | Timestamp | Hypothese | Score | Delta | Kept |
|---|---|---|---|---|---|
| 5 | 2026-03-15T18:58:46 | maxRepairPasses 3->5: Mehr Repair-Zyklen fuer hartnaeckige OutOfScope-Boilerplate | 102 | 16 | ✗ |
| 4 | 2026-03-15T18:48:49 | OutOfScope Repair: Aktuelle Section als BAD EXAMPLE markiert, konkretes GOOD Example, komplett neu schreiben | 137 | 51 | ✗ |
| 3 | 2026-03-15T18:14:48 | Reintroduced/Future-Leakage Repair-Prompt mit expliziter Nicht-Reintroduce Anweisung | 92 | -2 | ✓ |
| 2 | 2026-03-15T17:33:25 | OutOfScope Repair-Prompt mit Projektkontext angereichert (Feature-Namen, System-Vision) | 93.5 | -11.5 | ✓ |
| 1 | 2026-03-15T17:21:16 | Baseline mit Graceful Degradation - alle 3 Benchmarks | 105 | — | ✓ |

## Statistik (letzter Run)

| Metrik | Wert |
|---|---|
| **Median** | 102 |
| **Mean** | 99.0 |
| **Stddev** | ±15.9 |
| **Min/Max** | 74..118 |
| **Runs** | 4 |
| **Konsistenz** | 25% |
| **Alle Scores** | 101, 103, 118, 74 |
| **Fehlgeschlagene Runs** | 0 |

## Per-Benchmark Breakdown (Median-Run)

### complex
Score: 51 (E:1×10=10 W:11×1=11 B:0×20=0 FB:0×5=0 MS:0×8=0 T:0 I:30) Features:11
Status: failed_quality | Tokens: 114981 | Dauer: 366213ms

### edge_case
Score: 46 (E:1×10=10 W:6×1=6 B:0×20=0 FB:0×5=0 MS:0×8=0 T:0 I:30) Features:9
Status: failed_quality | Tokens: 92994 | Dauer: 316289ms

### simple
Score: 4 (E:0×10=0 W:4×1=4 B:0×20=0 FB:0×5=0 MS:0×8=0 T:0 I:0) Features:7
Status: passed | Tokens: 66944 | Dauer: 169578ms
