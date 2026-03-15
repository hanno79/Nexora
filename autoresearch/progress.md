# AutoPRD Progress Dashboard

> Automatisch generiert nach jedem Experiment-Run.

## Übersicht

| Metrik | Wert |
|---|---|
| **Baseline-Score** | 107 |
| **Aktueller Best-Score** | 3 |
| **Runs gesamt** | 5 |
| **Kept** | 3 |
| **Discarded** | 2 |
| **Erfolgsquote** | 60.0% |

## Top Verbesserungen

| Run | Hypothese | Delta | Score |
|---|---|---|---|
| 2 | Baseline nach Multi-Run-Umbau | -104 | 3 |
| 2 | Repair-Mapping fuer generic_section_boilerplate_outOfScope hinzugefuegt | -4.5 | 102.5 |

## Letzte 5 Runs

| Run | Timestamp | Hypothese | Score | Delta | Kept |
|---|---|---|---|---|---|
| 3 | 2026-03-15T15:24:45 | 15min Timeout - alle Benchmarks vollständig | 47 | 44 | ✗ |
| 3 | 2026-03-15T15:24:44 | Quality-Repair-Limit von 5 auf 10 Warnings erhoeht | 118 | 115 | ✗ |
| 2 | 2026-03-15T14:57:48 | Baseline nach Multi-Run-Umbau | 3 | -104 | ✓ |
| 2 | 2026-03-15T14:10:00 | Repair-Mapping fuer generic_section_boilerplate_outOfScope hinzugefuegt | 102.5 | -4.5 | ✓ |
| 1 | 2026-03-15T13:46:05 | Baseline (sauber, alle 3 Benchmarks) | 107 | — | ✓ |

## Statistik (letzter Run)

> Baseline-Run (nur 1 Durchlauf, keine Statistik)

## Per-Benchmark Breakdown (Median-Run)

### complex
✗ FAILED (aus Aggregation ausgeschlossen)
Dauer: 604846ms
⚠ PRD compiler quality gate failed after 3 repair attempt(s): Section appears generic and not context-specific: Out of Scope | Out-of-scope item "Migration von Altdaten aus externen Systemen ist" is rei

### edge_case
Score: 44 (E:1×10=10 W:4×1=4 B:0×20=0 FB:0×5=0 MS:0×8=0 T:0 I:30) Features:9
Status: failed_quality | Tokens: 97223 | Dauer: 398119ms

### simple
Score: 3 (E:0×10=0 W:3×1=3 B:0×20=0 FB:0×5=0 MS:0×8=0 T:0 I:0) Features:6
Status: passed | Tokens: 61099 | Dauer: 102151ms
