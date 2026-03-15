# AutoPRD Progress Dashboard

> Automatisch generiert nach jedem Experiment-Run.

## Übersicht

| Metrik | Wert |
|---|---|
| **Baseline-Score** | 107 |
| **Aktueller Best-Score** | 3 |
| **Runs gesamt** | 3 |
| **Kept** | 3 |
| **Discarded** | 0 |
| **Erfolgsquote** | 100.0% |

## Top Verbesserungen

| Run | Hypothese | Delta | Score |
|---|---|---|---|
| 2 | Baseline nach Multi-Run-Umbau | -104 | 3 |
| 2 | Repair-Mapping fuer generic_section_boilerplate_outOfScope hinzugefuegt | -4.5 | 102.5 |

## Letzte 5 Runs

| Run | Timestamp | Hypothese | Score | Delta | Kept |
|---|---|---|---|---|---|
| 2 | 2026-03-15T14:57:48 | Baseline nach Multi-Run-Umbau | 3 | -104 | ✓ |
| 2 | 2026-03-15T14:10:00 | Repair-Mapping fuer generic_section_boilerplate_outOfScope hinzugefuegt | 102.5 | -4.5 | ✓ |
| 1 | 2026-03-15T13:46:05 | Baseline (sauber, alle 3 Benchmarks) | 107 | — | ✓ |

## Statistik (letzter Run)

| Metrik | Wert |
|---|---|
| **Median** | 3 |
| **Mean** | 3.0 |
| **Stddev** | ±2.4 |
| **Min/Max** | 0..6 |
| **Runs** | 3 |
| **Konsistenz** | 100% |
| **Alle Scores** | 3, 0, 6 |
| **Fehlgeschlagene Runs** | 9 |

## Per-Benchmark Breakdown (Median-Run)

### complex
✗ FAILED (aus Aggregation ausgeschlossen)
Dauer: 300024ms
⚠ Timeout nach 300s: complex

### edge_case
✗ FAILED (aus Aggregation ausgeschlossen)
Dauer: 300009ms
⚠ Timeout nach 300s: edge_case

### simple
Score: 3 (E:0×10=0 W:3×1=3 B:0×20=0 FB:0×5=0 MS:0×8=0 T:0 I:0) Features:7
Status: passed | Tokens: 70290 | Dauer: 115651ms
