/**
 * AutoPRD Headless Runner
 *
 * Führt den PRD-Compiler headless auf Benchmark-PRDs aus,
 * sammelt Metriken und berechnet den Composite-Score.
 *
 * Usage:
 *   npx tsx autoresearch/run_experiment.ts [--hypothesis "description"] [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getOpenRouterClient } from '../server/openrouter';
import { generateWithCompilerGates } from '../server/guidedCompilerGates';
import { computeScore, formatScoreOneLiner, type ScoreBreakdown, type SemanticVerdict } from './score';
import type { PrdQualityReport } from '../server/prdCompilerValidation';

// ── Config ──────────────────────────────────────────────────────────────────

const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);
const AUTORESEARCH_DIR = path.resolve(__dirname_esm);
const TEST_INPUTS_DIR = path.join(AUTORESEARCH_DIR, 'test_inputs');
const RESULTS_FILE = path.join(AUTORESEARCH_DIR, 'results.tsv');
const PROGRESS_FILE = path.join(AUTORESEARCH_DIR, 'progress.md');

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
  score: ScoreBreakdown;
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

async function runSingleBenchmark(input: BenchmarkInput): Promise<ExperimentResult> {
  const client = getOpenRouterClient();
  const startedAt = Date.now();

  try {
    const result = await generateWithCompilerGates({
      client,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: input.prompt,
      mode: 'generate',
      contentLanguage: 'de',
    });

    const quality: PrdQualityReport | undefined = result.compilerArtifact?.quality;
    if (!quality) {
      return {
        inputName: input.name,
        score: {
          total: 999, errors: 0, warnings: 0, blockingIssues: 0,
          fallbackSections: 0, missingSections: 0, truncationPenalty: 0,
          invalidPenalty: 999, errorCount: 0, warningCount: 0,
          blockingIssueCount: 0, fallbackSectionCount: 0, missingSectionCount: 0,
          featureCount: 0,
        },
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
      score: {
        total: 999, errors: 0, warnings: 0, blockingIssues: 0,
        fallbackSections: 0, missingSections: 0, truncationPenalty: 0,
        invalidPenalty: 999, errorCount: 0, warningCount: 0,
        blockingIssueCount: 0, fallbackSectionCount: 0, missingSectionCount: 0,
        featureCount: 0,
      },
      qualityStatus: 'failed_runtime',
      modelsUsed: [],
      totalTokens: 0,
      durationMs: Date.now() - startedAt,
      error: err.message?.slice(0, 200),
    };
  }
}

// ── Core: Run all benchmarks ────────────────────────────────────────────────

async function runAllBenchmarks(hypothesis: string): Promise<ExperimentSummary> {
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
  console.log(`Previous best: ${previousBest ?? 'N/A (baseline run)'}\n`);

  const results: ExperimentResult[] = [];
  for (const input of inputs) {
    console.log(`  ▸ Running "${input.name}"...`);
    const result = await runSingleBenchmark(input);
    console.log(`    ${formatScoreOneLiner(result.score)} [${result.durationMs}ms]`);
    if (result.error) console.log(`    ⚠ Error: ${result.error}`);
    results.push(result);
  }

  const aggregateScore = results.reduce((sum, r) => sum + r.score.total, 0);
  const kept = previousBest === null || aggregateScore < previousBest;

  const summary: ExperimentSummary = {
    runNumber,
    timestamp,
    hypothesis,
    aggregateScore,
    results,
    kept,
    previousBest,
  };

  console.log(`\n  ═══ Aggregate Score: ${aggregateScore} (previous best: ${previousBest ?? 'N/A'}) ═══`);
  console.log(`  Decision: ${kept ? '✓ KEPT (improved)' : '✗ DISCARDED (no improvement)'}\n`);

  return summary;
}

// ── Dashboard: TSV + Progress ───────────────────────────────────────────────

function appendToResultsTsv(summary: ExperimentSummary, changedFile: string): void {
  const header = 'Run#\tTimestamp\tHypothese\tGeänderte_Datei\tScore_vorher\tScore_nachher\tDelta\tKept\tErrors\tWarnings\tBlockingIssues\tFeatures\tTokens\tDuration_ms';

  if (!fs.existsSync(RESULTS_FILE)) {
    fs.writeFileSync(RESULTS_FILE, header + '\n', 'utf-8');
  }

  const totalErrors = summary.results.reduce((s, r) => s + r.score.errorCount, 0);
  const totalWarnings = summary.results.reduce((s, r) => s + r.score.warningCount, 0);
  const totalBlocking = summary.results.reduce((s, r) => s + r.score.blockingIssueCount, 0);
  const totalFeatures = summary.results.reduce((s, r) => s + r.score.featureCount, 0);
  const totalTokens = summary.results.reduce((s, r) => s + r.totalTokens, 0);
  const totalDuration = summary.results.reduce((s, r) => s + r.durationMs, 0);
  const delta = summary.previousBest !== null
    ? (summary.aggregateScore - summary.previousBest).toString()
    : '—';

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

## Per-Benchmark Breakdown (letzter Run)

${summary.results.map(r =>
  `### ${r.inputName}\n${formatScoreOneLiner(r.score)}\nStatus: ${r.qualityStatus} | Tokens: ${r.totalTokens} | Dauer: ${r.durationMs}ms${r.error ? `\n⚠ ${r.error}` : ''}`
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

  const dryRun = args.includes('--dry-run');

  if (dryRun) {
    console.log('DRY RUN — loading benchmark inputs only');
    const inputs = loadBenchmarkInputs();
    console.log(`Found ${inputs.length} benchmarks: ${inputs.map(i => i.name).join(', ')}`);
    console.log(`Previous best score: ${getPreviousBestScore() ?? 'N/A'}`);
    return;
  }

  const summary = await runAllBenchmarks(hypothesis);

  // Write dashboard
  appendToResultsTsv(summary, changedFile);
  regenerateProgress(summary);

  console.log(`Results written to: ${RESULTS_FILE}`);
  console.log(`Progress dashboard: ${PROGRESS_FILE}`);

  // Exit with code indicating keep/discard for scripting
  process.exit(summary.kept ? 0 : 1);
}

main().catch(err => {
  console.error('AutoPRD experiment failed:', err);
  process.exit(2);
});
