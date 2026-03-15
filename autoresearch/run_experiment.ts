/**
 * AutoPRD Headless Runner
 *
 * Führt den PRD-Compiler headless auf Benchmark-PRDs aus,
 * sammelt Metriken und berechnet den Composite-Score.
 *
 * Usage:
 *   npx tsx autoresearch/run_experiment.ts [--hypothesis "description"] [--validation-runs N] [--dry-run]
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
const DEFAULT_VALIDATION_RUNS = 3; // Zusätzliche Runs zur Validierung nach positivem Schnell-Check
const BENCHMARK_TIMEOUT_MS = 5 * 60 * 1000; // 5 Minuten Timeout pro Benchmark-Run
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

function getPreviousBestScore(): number | null {
  if (!fs.existsSync(RESULTS_FILE)) return null;
  const lines = fs.readFileSync(RESULTS_FILE, 'utf-8').trim().split('\n');
  if (lines.length <= 1) return null;

  let best: number | null = null;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const kept = cols[7]; // "Kept" column
    if (kept !== '✓') continue;
    const score = parseFloat(cols[5]); // "Score_nachher" column
    if (!isNaN(score) && (best === null || score < best)) {
      best = score;
    }
  }
  return best;
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

async function runBenchmarkPass(inputs: BenchmarkInput[], passLabel: string): Promise<{ results: ExperimentResult[]; aggregateScore: number | null; failedCount: number }> {
  const results: ExperimentResult[] = [];
  let failedCount = 0;
  for (const input of inputs) {
    console.log(`  ▸ [${passLabel}] Running "${input.name}"...`);
    const result = await runSingleBenchmark(input);
    if (result.score) {
      console.log(`    ${formatScoreOneLiner(result.score)} [${result.durationMs}ms]`);
    } else {
      console.log(`    ✗ FAILED [${result.durationMs}ms]`);
      failedCount++;
    }
    if (result.error) console.log(`    ⚠ Error: ${result.error}`);
    results.push(result);
  }
  const successfulScores = results.filter(r => r.score !== null);
  // Wenn alle fehlschlagen, ist der Pass ungültig
  const aggregateScore = successfulScores.length > 0
    ? successfulScores.reduce((sum, r) => sum + r.score!.total, 0)
    : null;
  return { results, aggregateScore, failedCount };
}

// ── Core: Gestufter Multi-Run Experiment-Loop ───────────────────────────────

async function runAllBenchmarks(hypothesis: string, validationRuns: number): Promise<ExperimentSummary> {
  const inputs = loadBenchmarkInputs();
  if (inputs.length === 0) {
    throw new Error(`No benchmark inputs found in ${TEST_INPUTS_DIR}`);
  }

  const runNumber = getNextRunNumber();
  const previousBest = getPreviousBestScore();
  const timestamp = new Date().toISOString();

  console.log(`\n═══ AutoPRD Experiment #${runNumber} ═══`);
  console.log(`Hypothesis: ${hypothesis}`);
  console.log(`Benchmarks: ${inputs.map(i => i.name).join(', ')}`);
  console.log(`Validation runs: ${validationRuns}`);
  console.log(`Previous best: ${previousBest ?? 'N/A (baseline run)'}\n`);

  // ── Stufe 1: Schnell-Check (1 Run) ──
  console.log(`── Stufe 1: Schnell-Check ──`);
  const firstPass = await runBenchmarkPass(inputs, 'Schnell-Check');
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

  const allRunScores: number[] = [firstPass.aggregateScore];
  console.log(`\n  Schnell-Check Score: ${firstPass.aggregateScore} (previous best: ${previousBest ?? 'N/A'})${firstPass.failedCount > 0 ? ` [${firstPass.failedCount} failed benchmarks excluded]` : ''}`);

  // Baseline-Run (kein previousBest): immer nur 1 Run, direkt behalten
  if (previousBest === null) {
    console.log(`  → Baseline-Run, wird direkt übernommen.\n`);
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

  // Keine Validierungsruns: Einzelrun-Entscheidung (Backward-kompatibel)
  if (validationRuns === 0) {
    const kept = firstPass.aggregateScore < previousBest;
    console.log(`  → Einzelrun-Modus: ${kept ? '✓ KEPT' : '✗ DISCARDED'}\n`);
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

  // Deutlich schlechter (>20% über Baseline): sofort verwerfen
  const rejectThreshold = previousBest * 1.2;
  if (firstPass.aggregateScore > rejectThreshold) {
    console.log(`  → Deutlich schlechter als Baseline (>${rejectThreshold.toFixed(0)}), sofort verworfen.\n`);
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

  // ── Stufe 2: Validierung (N zusätzliche Runs) ──
  console.log(`\n── Stufe 2: Validierung (${validationRuns} zusätzliche Runs) ──`);
  const allResults: ExperimentResult[][] = [firstPass.results];

  for (let i = 0; i < validationRuns; i++) {
    const pass = await runBenchmarkPass(inputs, `Validierung ${i + 1}/${validationRuns}`);
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

  const statistics = computeRunStatistics(allRunScores, previousBest);

  console.log(`\n── Stufe 3: Entscheidung ──`);
  console.log(`  ${formatStatisticsOneLiner(statistics)}`);
  console.log(`  Previous best: ${previousBest}`);
  if (totalFailedRuns > 0) {
    console.log(`  ⚠ ${totalFailedRuns} fehlgeschlagene Benchmark-Runs aus Aggregation ausgeschlossen`);
  }

  // Kept wenn: Median besser als Baseline UND mindestens 75% der Runs besser
  const MIN_CONSISTENCY = 0.75;
  const kept = statistics.median < previousBest && statistics.consistencyRate >= MIN_CONSISTENCY;

  if (kept) {
    console.log(`  → ✓ KEPT: Median ${statistics.median} < ${previousBest} und ${(statistics.consistencyRate * 100).toFixed(0)}% konsistent\n`);
  } else if (statistics.median >= previousBest) {
    console.log(`  → ✗ DISCARDED: Median ${statistics.median} >= ${previousBest}\n`);
  } else {
    console.log(`  → ✗ DISCARDED: Konsistenz ${(statistics.consistencyRate * 100).toFixed(0)}% < ${MIN_CONSISTENCY * 100}% Minimum\n`);
  }

  // Verwende die Ergebnisse des Median-nächsten Runs für die Detail-Anzeige
  const medianRunIndex = findMedianRunIndex(allRunScores, statistics.median);

  return {
    runNumber, timestamp, hypothesis,
    aggregateScore: statistics.median, // Median statt einzelner Score
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

  const dryRun = args.includes('--dry-run');

  if (dryRun) {
    console.log('DRY RUN — loading benchmark inputs only');
    const inputs = loadBenchmarkInputs();
    console.log(`Found ${inputs.length} benchmarks: ${inputs.map(i => i.name).join(', ')}`);
    console.log(`Previous best score: ${getPreviousBestScore() ?? 'N/A'}`);
    console.log(`Validation runs: ${validationRuns}`);
    return;
  }

  const summary = await runAllBenchmarks(hypothesis, validationRuns);

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
