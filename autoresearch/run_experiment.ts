/**
 * AutoPRD Headless Runner
 *
 * Führt den PRD-Compiler headless auf Benchmark-PRDs aus,
 * sammelt Metriken und berechnet den Composite-Score.
 *
 * Usage:
 *   npx tsx autoresearch/run_experiment.ts [--hypothesis "description"] [--validation-runs N] [--sequential] [--dry-run]
 *
 * Gestufter Ansatz:
 *   1. Schnell-Check (1 Run) — bei deutlicher Verschlechterung sofort verwerfen
 *   2. Validierung (N zusätzliche Runs, default 3) — nur bei Verbesserung
 *   3. Entscheidung per Median + Konsistenz (>=75% besser als Baseline)
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getOpenRouterClient } from '../server/openrouter';
import { generateWithCompilerGates } from '../server/guidedCompilerGates';
import {
  computeScore, formatScoreOneLiner, type ScoreBreakdown, type SemanticVerdict,
  computeRunStatistics, formatStatisticsOneLiner, type RunStatistics,
} from './score';
import type { PrdQualityReport } from '../server/prdCompilerValidation';

// ── Config ──────────────────────────────────────────────────────────────────

const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);
const AUTORESEARCH_DIR = path.resolve(__dirname_esm);
const TEST_INPUTS_DIR = path.join(AUTORESEARCH_DIR, 'test_inputs');
const RESULTS_FILE = path.join(AUTORESEARCH_DIR, 'results.tsv');
const PROGRESS_FILE = path.join(AUTORESEARCH_DIR, 'progress.md');
const BENCHMARK_BESTS_FILE = path.join(AUTORESEARCH_DIR, 'benchmark_bests.json');
const DEFAULT_VALIDATION_RUNS = 3; // Zusätzliche Runs zur Validierung nach positivem Schnell-Check
const BENCHMARK_TIMEOUT_MS = 15 * 60 * 1000; // 15 Minuten Timeout pro Benchmark-Run
const INVALID_EXPERIMENT_SCORE = -1; // Marker für ungültige Experimente (alle Runs fehlgeschlagen)

const SYSTEM_PROMPT = `Du bist ein erfahrener Software-Architekt und PRD-Spezialist.
Erstelle ein vollständiges, professionelles Product Requirements Document (PRD) auf Deutsch.
Verwende klare Struktur mit Überschriften, Features mit Purpose/Actors/MainFlow/AcceptanceCriteria.
Schreibe präzise, fachlich korrekt, und vermeide Platzhalter oder generische Formulierungen.`;

// ── Types ───────────────────────────────────────────────────────────────────

interface BenchmarkInput {
  name: string;
  file: string;
  prompt: string;
}

interface ExperimentResult {
  inputName: string;
  score: ScoreBreakdown | null; // null bei Runtime-Fehler/Timeout — wird aus Aggregation ausgeschlossen
  qualityStatus: string;
  modelsUsed: string[];
  totalTokens: number;
  durationMs: number;
  error?: string;
}

interface ExperimentSummary {
  runNumber: number;
  timestamp: string;
  hypothesis: string;
  aggregateScore: number;
  results: ExperimentResult[];
  kept: boolean;
  previousBest: number | null;
  statistics: RunStatistics | null; // null wenn nur 1 Run (Schnell-Check gescheitert)
  allRunScores: number[]; // Alle Aggregate-Scores aus allen Runs (nur erfolgreiche)
  failedRuns: number; // Anzahl fehlgeschlagener Runs (Runtime-Fehler/Timeout)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function loadBenchmarkInputs(): BenchmarkInput[] {
  const files = fs.readdirSync(TEST_INPUTS_DIR).filter(f => f.endsWith('.md'));
  return files.map(file => {
    const content = fs.readFileSync(path.join(TEST_INPUTS_DIR, file), 'utf-8');
    return {
      name: path.basename(file, '.md'),
      file,
      prompt: content.trim(),
    };
  });
}

function getNextRunNumber(): number {
  if (!fs.existsSync(RESULTS_FILE)) return 1;
  const lines = fs.readFileSync(RESULTS_FILE, 'utf-8').trim().split('\n');
  if (lines.length <= 1) return 1; // only header
  const lastLine = lines[lines.length - 1];
  const runNum = parseInt(lastLine.split('\t')[0], 10);
  return isNaN(runNum) ? 1 : runNum + 1;
}

// ── Per-Benchmark Best-Score Tracking ───────────────────────────────────────

interface BenchmarkBests {
  [benchmarkName: string]: number; // Bester Score pro Benchmark
}

function loadBenchmarkBests(): BenchmarkBests {
  if (!fs.existsSync(BENCHMARK_BESTS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(BENCHMARK_BESTS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveBenchmarkBests(bests: BenchmarkBests): void {
  fs.writeFileSync(BENCHMARK_BESTS_FILE, JSON.stringify(bests, null, 2), 'utf-8');
}

function getComparableAggregateScore(
  results: ExperimentResult[],
  bests: BenchmarkBests,
): { aggregateScore: number; comparableBest: number | null; newBenchmarks: string[] } {
  // Nur Benchmarks mit Score (nicht fehlgeschlagen) berücksichtigen
  const successful = results.filter(r => r.score !== null);
  if (successful.length === 0) return { aggregateScore: 0, comparableBest: null, newBenchmarks: [] };

  const aggregateScore = successful.reduce((sum, r) => sum + r.score!.total, 0);

  // Vergleichbaren Best-Score berechnen: nur Benchmarks die auch in Bests existieren
  const comparable = successful.filter(r => r.inputName in bests);
  const newBenchmarks = successful.filter(r => !(r.inputName in bests)).map(r => r.inputName);

  if (comparable.length === 0) {
    // Keine vergleichbaren Benchmarks → Baseline-Run
    return { aggregateScore, comparableBest: null, newBenchmarks };
  }

  const comparableBest = comparable.reduce((sum, r) => sum + bests[r.inputName], 0);
  return { aggregateScore, comparableBest, newBenchmarks };
}

function updateBenchmarkBests(results: ExperimentResult[], bests: BenchmarkBests): BenchmarkBests {
  const updated = { ...bests };
  for (const r of results) {
    if (r.score === null) continue;
    if (!(r.inputName in updated) || r.score.total < updated[r.inputName]) {
      updated[r.inputName] = r.score.total;
    }
  }
  return updated;
}

// Legacy-Funktion für TSV-Kompatibilität
function getPreviousBestAggregate(bests: BenchmarkBests): number | null {
  const values = Object.values(bests);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0);
}

// ── Core: Run single benchmark ──────────────────────────────────────────────

// Günstige Paid-Modelle ohne Rate-Limits für den Experiment-Loop
const EXPERIMENT_MODELS = {
  generator: 'google/gemini-2.5-flash',
  reviewer: 'google/gemini-2.5-flash',
  verifier: 'google/gemini-2.5-flash',
  semantic_repair: 'google/gemini-2.5-flash',
  fallback: 'deepseek/deepseek-chat-v3-0324',
};

function createExperimentClient() {
  const client = getOpenRouterClient();
  client.setPreferredModel('generator', EXPERIMENT_MODELS.generator);
  client.setPreferredModel('reviewer', EXPERIMENT_MODELS.reviewer);
  client.setPreferredModel('verifier', EXPERIMENT_MODELS.verifier);
  client.setPreferredModel('semantic_repair', EXPERIMENT_MODELS.semantic_repair);
  client.setPreferredModel('fallback', EXPERIMENT_MODELS.fallback);
  client.setFallbackChain([
    'google/gemini-2.5-flash',
    'deepseek/deepseek-chat-v3-0324',
    'openai/gpt-4.1-nano',
  ]);
  return client;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout nach ${ms / 1000}s: ${label}`)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function runSingleBenchmark(input: BenchmarkInput): Promise<ExperimentResult> {
  const client = createExperimentClient();
  const startedAt = Date.now();

  try {
    const result = await withTimeout(
      generateWithCompilerGates({
        client,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: input.prompt,
        mode: 'generate',
        contentLanguage: 'de',
        temperature: 0,
      }),
      BENCHMARK_TIMEOUT_MS,
      input.name,
    );

    const quality: PrdQualityReport | undefined = result.compilerArtifact?.quality;

    // Log error issue codes for diagnosis
    if (quality) {
      const errorIssues = quality.issues.filter(i => i.severity === 'error');
      const warningIssues = quality.issues.filter(i => i.severity === 'warning');
      if (errorIssues.length > 0) {
        console.log(`    ⛔ Error codes: ${errorIssues.map(i => `${i.code} (${i.message.slice(0, 80)})`).join(' | ')}`);
      }
      if (warningIssues.length > 0) {
        console.log(`    ⚠ Warning codes: ${warningIssues.map(i => i.code).join(', ')}`);
      }
    }

    if (!quality) {
      return {
        inputName: input.name,
        score: null,
        qualityStatus: 'failed_runtime',
        modelsUsed: result.modelsUsed,
        totalTokens: result.totalTokens,
        durationMs: Date.now() - startedAt,
        error: 'No quality report returned',
      };
    }

    const semanticVerdict: SemanticVerdict | undefined =
      result.compilerArtifact?.semanticVerification
        ? {
            verdict: result.compilerArtifact.semanticVerification.verdict,
            blockingIssueCount: result.compilerArtifact.semanticVerification.blockingIssues?.length ?? 0,
          }
        : undefined;

    const score = computeScore(quality, semanticVerdict);

    return {
      inputName: input.name,
      score,
      qualityStatus: quality.valid ? 'passed' : 'failed_quality',
      modelsUsed: result.modelsUsed,
      totalTokens: result.totalTokens,
      durationMs: Date.now() - startedAt,
    };
  } catch (err: any) {
    return {
      inputName: input.name,
      score: null,
      qualityStatus: 'failed_runtime',
      modelsUsed: [],
      totalTokens: 0,
      durationMs: Date.now() - startedAt,
      error: err.message?.slice(0, 200),
    };
  }
}

// ── Core: Run all benchmarks (single pass) ──────────────────────────────────

function printResult(result: ExperimentResult, includeInputName: boolean): void {
  const prefix = includeInputName ? `${result.inputName}: ` : '';
  if (result.score) {
    console.log(`    ${prefix}${formatScoreOneLiner(result.score)} [${result.durationMs}ms]`);
  } else {
    const duration = result.durationMs >= 0 ? `${result.durationMs}ms` : 'unknown';
    console.log(`    ${prefix}✗ FAILED [${duration}]`);
  }
  if (result.error) console.log(`      ⚠ ${result.error}`);
}

async function runBenchmarkPass(inputs: BenchmarkInput[], passLabel: string, parallel: boolean): Promise<{ results: ExperimentResult[]; aggregateScore: number | null; failedCount: number }> {
  let results: ExperimentResult[];

  if (parallel && inputs.length > 1) {
    console.log(`  ▸ [${passLabel}] Running ${inputs.length} benchmarks parallel...`);
    const settled = await Promise.allSettled(
      inputs.map(input => runSingleBenchmark(input)),
    );

    results = settled.map((s, i) => {
      if (s.status === 'fulfilled') return s.value;
      return {
        inputName: inputs[i].name,
        score: null,
        qualityStatus: 'failed_runtime',
        modelsUsed: [],
        totalTokens: 0,
        durationMs: -1, // Dauer unbekannt bei Promise-Rejection
        error: (s.reason as Error)?.message?.slice(0, 200) ?? 'Unknown error',
      } satisfies ExperimentResult;
    });

    // Ergebnisse nach Abschluss sequentiell ausgeben
    for (const result of results) printResult(result, true);
  } else {
    // Sequentiell: Inline-Output pro Benchmark (Name → Run → Ergebnis)
    results = [];
    for (const input of inputs) {
      console.log(`  ▸ [${passLabel}] Running "${input.name}"...`);
      const result = await runSingleBenchmark(input);
      printResult(result, false);
      results.push(result);
    }
  }

  const failedCount = results.filter(r => r.score === null).length;
  const successfulScores = results.filter(r => r.score !== null);
  const aggregateScore = successfulScores.length > 0
    ? successfulScores.reduce((sum, r) => sum + r.score!.total, 0)
    : null;
  return { results, aggregateScore, failedCount };
}

// ── Core: Gestufter Multi-Run Experiment-Loop ───────────────────────────────

async function runAllBenchmarks(hypothesis: string, validationRuns: number, parallel: boolean): Promise<ExperimentSummary> {
  const inputs = loadBenchmarkInputs();
  if (inputs.length === 0) {
    throw new Error(`No benchmark inputs found in ${TEST_INPUTS_DIR}`);
  }

  const runNumber = getNextRunNumber();
  const bests = loadBenchmarkBests();
  const previousBest = getPreviousBestAggregate(bests);
  const timestamp = new Date().toISOString();

  console.log(`\n═══ AutoPRD Experiment #${runNumber} ═══`);
  console.log(`Hypothesis: ${hypothesis}`);
  console.log(`Benchmarks: ${inputs.map(i => i.name).join(', ')}`);
  console.log(`Validation runs: ${validationRuns}`);
  console.log(`Parallel: ${parallel}`);
  console.log(`Per-Benchmark Bests: ${Object.keys(bests).length > 0 ? Object.entries(bests).map(([k, v]) => `${k}=${v}`).join(', ') : 'N/A (baseline run)'}`);
  console.log(`Previous aggregate best: ${previousBest ?? 'N/A'}\n`);

  const isBaseline = Object.keys(bests).length === 0;

  // ── Stufe 1: Schnell-Check (1 Run) ──
  console.log(`── Stufe 1: Schnell-Check ──`);
  const firstPass = await runBenchmarkPass(inputs, 'Schnell-Check', parallel);
  let totalFailedRuns = firstPass.failedCount;

  // Schnell-Check komplett fehlgeschlagen: Experiment ungültig
  if (firstPass.aggregateScore === null) {
    console.log(`\n  ✗ Schnell-Check komplett fehlgeschlagen — Experiment ungültig.\n`);
    return {
      runNumber, timestamp, hypothesis,
      aggregateScore: INVALID_EXPERIMENT_SCORE,
      results: firstPass.results,
      kept: false,
      previousBest,
      statistics: null,
      allRunScores: [],
      failedRuns: totalFailedRuns,
    };
  }

  // Per-Benchmark-Vergleich: nur Benchmarks vergleichen die in beiden Runs existieren
  const comparison = getComparableAggregateScore(firstPass.results, bests);
  const allRunScores: number[] = [firstPass.aggregateScore];

  console.log(`\n  Schnell-Check Score: ${firstPass.aggregateScore}${firstPass.failedCount > 0 ? ` [${firstPass.failedCount} failed excluded]` : ''}`);
  if (comparison.comparableBest !== null) {
    console.log(`  Vergleichbar mit Baseline: ${comparison.comparableBest} (nur gemeinsame Benchmarks)`);
  }
  if (comparison.newBenchmarks.length > 0) {
    console.log(`  Neue Benchmarks (kein Vergleich): ${comparison.newBenchmarks.join(', ')}`);
  }

  // Baseline-Run: immer behalten und Bests speichern
  if (isBaseline) {
    console.log(`  → Baseline-Run, wird direkt übernommen.\n`);
    const newBests = updateBenchmarkBests(firstPass.results, bests);
    saveBenchmarkBests(newBests);
    return {
      runNumber, timestamp, hypothesis,
      aggregateScore: firstPass.aggregateScore,
      results: firstPass.results,
      kept: true,
      previousBest,
      statistics: null,
      allRunScores,
      failedRuns: totalFailedRuns,
    };
  }

  // Keine Validierungsruns: Einzelrun-Entscheidung per Benchmark-Vergleich
  if (validationRuns === 0) {
    const kept = comparison.comparableBest !== null && firstPass.aggregateScore <= comparison.comparableBest;
    console.log(`  → Einzelrun-Modus: ${kept ? '✓ KEPT' : '✗ DISCARDED'}\n`);
    if (kept) {
      saveBenchmarkBests(updateBenchmarkBests(firstPass.results, bests));
    }
    return {
      runNumber, timestamp, hypothesis,
      aggregateScore: firstPass.aggregateScore,
      results: firstPass.results,
      kept,
      previousBest,
      statistics: null,
      allRunScores,
      failedRuns: totalFailedRuns,
    };
  }

  // Deutlich schlechter (>20% über vergleichbare Baseline): sofort verwerfen
  if (comparison.comparableBest !== null) {
    const rejectThreshold = comparison.comparableBest * 1.2;
    // Nur die vergleichbaren Benchmarks für den Reject-Check nutzen
    const comparableScore = firstPass.results
      .filter(r => r.score !== null && r.inputName in bests)
      .reduce((sum, r) => sum + r.score!.total, 0);
    if (comparableScore > rejectThreshold) {
      console.log(`  → Vergleichbare Benchmarks deutlich schlechter (${comparableScore} > ${rejectThreshold.toFixed(0)}), sofort verworfen.\n`);
      return {
        runNumber, timestamp, hypothesis,
        aggregateScore: firstPass.aggregateScore,
        results: firstPass.results,
        kept: false,
        previousBest,
        statistics: null,
        allRunScores,
        failedRuns: totalFailedRuns,
      };
    }
  }

  // ── Stufe 2: Validierung (N zusätzliche Runs) ──
  console.log(`\n── Stufe 2: Validierung (${validationRuns} zusätzliche Runs) ──`);
  const allResults: ExperimentResult[][] = [firstPass.results];

  for (let i = 0; i < validationRuns; i++) {
    const pass = await runBenchmarkPass(inputs, `Validierung ${i + 1}/${validationRuns}`, parallel);
    totalFailedRuns += pass.failedCount;
    if (pass.aggregateScore !== null) {
      allRunScores.push(pass.aggregateScore);
      console.log(`  Validierung ${i + 1} Score: ${pass.aggregateScore}${pass.failedCount > 0 ? ` [${pass.failedCount} failed]` : ''}`);
    } else {
      console.log(`  Validierung ${i + 1}: komplett fehlgeschlagen, übersprungen`);
    }
    allResults.push(pass.results);
  }

  // ── Stufe 3: Entscheidung per Median + Konsistenz ──
  if (allRunScores.length === 0) {
    console.log(`\n── Stufe 3: Alle Runs fehlgeschlagen — Experiment ungültig ──\n`);
    return {
      runNumber, timestamp, hypothesis,
      aggregateScore: INVALID_EXPERIMENT_SCORE,
      results: allResults[0],
      kept: false,
      previousBest,
      statistics: null,
      allRunScores: [],
      failedRuns: totalFailedRuns,
    };
  }

  // Per-Benchmark vergleichbare Best-Scores für Konsistenz-Berechnung
  const comparableBestForStats = comparison.comparableBest ?? previousBest;
  const statistics = computeRunStatistics(allRunScores, comparableBestForStats);

  console.log(`\n── Stufe 3: Entscheidung ──`);
  console.log(`  ${formatStatisticsOneLiner(statistics)}`);
  console.log(`  Vergleichbare Baseline: ${comparison.comparableBest ?? 'N/A'} (aggregate: ${previousBest ?? 'N/A'})`);
  if (totalFailedRuns > 0) {
    console.log(`  ⚠ ${totalFailedRuns} fehlgeschlagene Benchmark-Runs aus Aggregation ausgeschlossen`);
  }

  // Kept wenn: Median besser/gleich vergleichbare Baseline UND mindestens 75% konsistent
  const MIN_CONSISTENCY = 0.75;
  const kept = comparison.comparableBest !== null
    ? statistics.median <= comparison.comparableBest && statistics.consistencyRate >= MIN_CONSISTENCY
    : true; // Keine vergleichbare Baseline → neue Benchmarks, immer behalten

  if (kept) {
    console.log(`  → ✓ KEPT: Median ${statistics.median} <= ${comparison.comparableBest ?? 'N/A'} und ${(statistics.consistencyRate * 100).toFixed(0)}% konsistent\n`);
    // Bests aktualisieren mit dem Median-Run
    const medianRunIndex = findMedianRunIndex(allRunScores, statistics.median);
    saveBenchmarkBests(updateBenchmarkBests(allResults[medianRunIndex], bests));
  } else if (comparison.comparableBest !== null && statistics.median > comparison.comparableBest) {
    console.log(`  → ✗ DISCARDED: Median ${statistics.median} > ${comparison.comparableBest}\n`);
  } else {
    console.log(`  → ✗ DISCARDED: Konsistenz ${(statistics.consistencyRate * 100).toFixed(0)}% < ${MIN_CONSISTENCY * 100}% Minimum\n`);
  }

  const medianRunIndex = findMedianRunIndex(allRunScores, statistics.median);

  return {
    runNumber, timestamp, hypothesis,
    aggregateScore: statistics.median,
    results: allResults[medianRunIndex],
    kept,
    previousBest,
    statistics,
    allRunScores,
    failedRuns: totalFailedRuns,
  };
}

function findMedianRunIndex(scores: number[], median: number): number {
  let bestIndex = 0;
  let bestDist = Math.abs(scores[0] - median);
  for (let i = 1; i < scores.length; i++) {
    const dist = Math.abs(scores[i] - median);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  }
  return bestIndex;
}

// ── Dashboard: TSV + Progress ───────────────────────────────────────────────

function appendToResultsTsv(summary: ExperimentSummary, changedFile: string): void {
  const header = 'Run#\tTimestamp\tHypothese\tGeänderte_Datei\tScore_vorher\tScore_nachher\tDelta\tKept\tErrors\tWarnings\tBlockingIssues\tFeatures\tTokens\tDuration_ms\tMedian\tStddev\tRuns\tConsistency\tAll_Scores\tFailed_Runs';

  if (!fs.existsSync(RESULTS_FILE)) {
    fs.writeFileSync(RESULTS_FILE, header + '\n', 'utf-8');
  }

  const successfulResults = summary.results.filter(r => r.score !== null);
  const totalErrors = successfulResults.reduce((s, r) => s + r.score!.errorCount, 0);
  const totalWarnings = successfulResults.reduce((s, r) => s + r.score!.warningCount, 0);
  const totalBlocking = successfulResults.reduce((s, r) => s + r.score!.blockingIssueCount, 0);
  const totalFeatures = successfulResults.reduce((s, r) => s + r.score!.featureCount, 0);
  const totalTokens = summary.results.reduce((s, r) => s + r.totalTokens, 0);
  const totalDuration = summary.results.reduce((s, r) => s + r.durationMs, 0);
  const delta = summary.previousBest !== null
    ? (summary.aggregateScore - summary.previousBest).toString()
    : '—';

  const stats = summary.statistics;
  const row = [
    summary.runNumber,
    summary.timestamp,
    summary.hypothesis,
    changedFile || '—',
    summary.previousBest ?? '—',
    summary.aggregateScore,
    delta,
    summary.kept ? '✓' : '✗',
    totalErrors,
    totalWarnings,
    totalBlocking,
    totalFeatures,
    totalTokens,
    totalDuration,
    stats?.median ?? '—',
    stats ? stats.stddev.toFixed(1) : '—',
    summary.allRunScores.length,
    stats ? `${(stats.consistencyRate * 100).toFixed(0)}%` : '—',
    summary.allRunScores.join(','),
    summary.failedRuns,
  ].join('\t');

  fs.appendFileSync(RESULTS_FILE, row + '\n', 'utf-8');
}

function regenerateProgress(summary: ExperimentSummary): void {
  const lines = fs.existsSync(RESULTS_FILE)
    ? fs.readFileSync(RESULTS_FILE, 'utf-8').trim().split('\n').slice(1) // skip header
    : [];

  const keptRuns = lines.filter(l => l.split('\t')[7] === '✓');
  const discardedRuns = lines.filter(l => l.split('\t')[7] === '✗');
  const totalRuns = lines.length;
  const successRate = totalRuns > 0 ? ((keptRuns.length / totalRuns) * 100).toFixed(1) : '0';

  // Find best score
  let bestScore = Infinity;
  let baselineScore = '—';
  for (const line of lines) {
    const cols = line.split('\t');
    const score = parseFloat(cols[5]);
    if (!isNaN(score) && score < bestScore) bestScore = score;
    if (cols[0] === '1') baselineScore = cols[5];
  }

  // Top improvements (kept runs sorted by delta)
  const improvements = keptRuns
    .map(l => {
      const cols = l.split('\t');
      return { run: cols[0], hypothesis: cols[2], delta: parseFloat(cols[6]) || 0, score: cols[5] };
    })
    .filter(r => r.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 5);

  // Last 5 runs
  const recentRuns = lines.slice(-5).reverse();

  const md = `# AutoPRD Progress Dashboard

> Automatisch generiert nach jedem Experiment-Run.

## Übersicht

| Metrik | Wert |
|---|---|
| **Baseline-Score** | ${baselineScore} |
| **Aktueller Best-Score** | ${bestScore === Infinity ? '—' : bestScore} |
| **Runs gesamt** | ${totalRuns} |
| **Kept** | ${keptRuns.length} |
| **Discarded** | ${discardedRuns.length} |
| **Erfolgsquote** | ${successRate}% |

## Top Verbesserungen

| Run | Hypothese | Delta | Score |
|---|---|---|---|
${improvements.length > 0
  ? improvements.map(i => `| ${i.run} | ${i.hypothesis} | ${i.delta} | ${i.score} |`).join('\n')
  : '| — | Noch keine Verbesserungen | — | — |'}

## Letzte 5 Runs

| Run | Timestamp | Hypothese | Score | Delta | Kept |
|---|---|---|---|---|---|
${recentRuns.length > 0
  ? recentRuns.map(l => {
      const c = l.split('\t');
      return `| ${c[0]} | ${c[1]?.slice(0, 19)} | ${c[2]} | ${c[5]} | ${c[6]} | ${c[7]} |`;
    }).join('\n')
  : '| — | — | — | — | — | — |'}

## Statistik (letzter Run)

${summary.statistics
  ? `| Metrik | Wert |
|---|---|
| **Median** | ${summary.statistics.median} |
| **Mean** | ${summary.statistics.mean.toFixed(1)} |
| **Stddev** | ±${summary.statistics.stddev.toFixed(1)} |
| **Min/Max** | ${summary.statistics.min}..${summary.statistics.max} |
| **Runs** | ${summary.statistics.runs} |
| **Konsistenz** | ${(summary.statistics.consistencyRate * 100).toFixed(0)}% |
| **Alle Scores** | ${summary.allRunScores.join(', ')} |
| **Fehlgeschlagene Runs** | ${summary.failedRuns} |`
  : '> Baseline-Run (nur 1 Durchlauf, keine Statistik)'}

## Per-Benchmark Breakdown (Median-Run)

${summary.results.map(r =>
  r.score
    ? `### ${r.inputName}\n${formatScoreOneLiner(r.score)}\nStatus: ${r.qualityStatus} | Tokens: ${r.totalTokens} | Dauer: ${r.durationMs}ms${r.error ? `\n⚠ ${r.error}` : ''}`
    : `### ${r.inputName}\n✗ FAILED (aus Aggregation ausgeschlossen)\nDauer: ${r.durationMs}ms\n⚠ ${r.error ?? 'Unknown error'}`
).join('\n\n')}
`;

  fs.writeFileSync(PROGRESS_FILE, md, 'utf-8');
}

// ── CLI Entry Point ─────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const hypothesisIdx = args.indexOf('--hypothesis');
  const hypothesis = hypothesisIdx >= 0 && args[hypothesisIdx + 1]
    ? args[hypothesisIdx + 1]
    : 'Baseline';

  const changedFileIdx = args.indexOf('--changed-file');
  const changedFile = changedFileIdx >= 0 && args[changedFileIdx + 1]
    ? args[changedFileIdx + 1]
    : '';

  const validationRunsIdx = args.indexOf('--validation-runs');
  const validationRuns = validationRunsIdx >= 0 && args[validationRunsIdx + 1]
    ? parseInt(args[validationRunsIdx + 1], 10)
    : DEFAULT_VALIDATION_RUNS;

  if (isNaN(validationRuns) || validationRuns < 0) {
    console.error('--validation-runs must be a non-negative integer');
    process.exit(2);
  }

  const sequential = args.includes('--sequential');
  const parallel = !sequential;
  const dryRun = args.includes('--dry-run');

  if (dryRun) {
    console.log('DRY RUN — loading benchmark inputs only');
    const inputs = loadBenchmarkInputs();
    console.log(`Found ${inputs.length} benchmarks: ${inputs.map(i => i.name).join(', ')}`);
    const bests = loadBenchmarkBests();
    console.log(`Per-Benchmark Bests: ${Object.keys(bests).length > 0 ? Object.entries(bests).map(([k, v]) => `${k}=${v}`).join(', ') : 'N/A (baseline)'}`);
    console.log(`Aggregate best: ${getPreviousBestAggregate(bests) ?? 'N/A'}`);
    console.log(`Validation runs: ${validationRuns}`);
    console.log(`Parallel: ${parallel}`);
    return;
  }

  const summary = await runAllBenchmarks(hypothesis, validationRuns, parallel);

  // Write dashboard
  appendToResultsTsv(summary, changedFile);
  regenerateProgress(summary);

  console.log(`Results written to: ${RESULTS_FILE}`);
  console.log(`Progress dashboard: ${PROGRESS_FILE}`);

  // Exit codes: 0 = kept (improved), 1 = discarded (no improvement), 2 = invalid (all runs failed)
  if (summary.aggregateScore === INVALID_EXPERIMENT_SCORE) {
    process.exit(2);
  }
  process.exit(summary.kept ? 0 : 1);
}

main().catch(err => {
  console.error('AutoPRD experiment failed:', err);
  process.exit(2);
});
