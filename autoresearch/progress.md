# AutoPRD Progress Dashboard

> Automatisch generiert nach jedem Experiment-Run.

## Übersicht

| Metrik | Wert |
|---|---|
| **Baseline-Score** | 91 |
| **Aktueller Best-Score** | 46.5 |
| **Runs gesamt** | 2 |
| **Kept** | 2 |
| **Discarded** | 0 |
| **Erfolgsquote** | 100.0% |

## Top Verbesserungen

| Run | Hypothese | Delta | Score |
|---|---|---|---|
| 2 | Validierung der Baseline-Streuung | -44.5 | 46.5 |

## Letzte 5 Runs

| Run | Timestamp | Hypothese | Score | Delta | Kept |
|---|---|---|---|---|---|
| 2 | 2026-03-15T16:26:50 | Validierung der Baseline-Streuung | 46.5 | -44.5 | ✓ |
| 1 | 2026-03-15T16:16:45 | Frische Baseline mit 15min Timeout und per-Benchmark-Tracking | 91 | — | ✓ |

## Statistik (letzter Run)

| Metrik | Wert |
|---|---|
| **Median** | 46.5 |
| **Mean** | 49.3 |
| **Stddev** | ±6.3 |
| **Min/Max** | 44..60 |
| **Runs** | 4 |
| **Konsistenz** | 100% |
| **Alle Scores** | 46, 120, 47, 60 |
| **Fehlgeschlagene Runs** | 3 |

## Per-Benchmark Breakdown (Median-Run)

### complex
✗ FAILED (aus Aggregation ausgeschlossen)
Dauer: 694826ms
⚠ PRD compiler quality gate failed after 3 repair attempt(s): Section appears generic and not context-specific: Out of Scope

### edge_case
Score: 45 (E:1×10=10 W:5×1=5 B:0×20=0 FB:0×5=0 MS:0×8=0 T:0 I:30) Features:10
Status: failed_quality | Tokens: 91158 | Dauer: 331550ms

### simple
Score: 1 (E:0×10=0 W:1×1=1 B:0×20=0 FB:0×5=0 MS:0×8=0 T:0 I:0) Features:7
Status: passed | Tokens: 57153 | Dauer: 107095ms
