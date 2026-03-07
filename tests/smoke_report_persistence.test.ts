/*
Author: rahn
Datum: 07.03.2026
Version: 1.0
Beschreibung: Testet die dauerhafte Persistenz von Smoke-Resultaten und Laufmetriken.
*/

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { persistSmokeReport } from '../e2e/helpers/smoke-report-persistence';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('smoke report persistence', () => {
  it('persistiert timestamped und latest report unter documentation/smoke_results', () => {
    // ÄNDERUNG 07.03.2026: Smoke-Reports muessen fuer spaetere Querschnittsauswertungen
    // an einem dauerhaften Projektpfad mit stabiler latest-Datei abgelegt werden.
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-smoke-report-'));
    tempDirs.push(baseDir);

    const written = persistSmokeReport({
      baseDir,
      templates: ['feature'],
      methods: ['simple'],
      results: [{
        template: 'feature',
        method: 'simple',
        valid: true,
        featureCount: 4,
        qualityScore: 120,
        errorIssues: [],
        warningIssues: [],
        modelsUsed: ['openrouter/google/gemini-2.5-flash:free'],
        tokensUsed: 1234,
        durationMs: 4567,
        truncatedLikely: false,
      }],
    });

    expect(written.reportDir).toContain(path.join('documentation', 'smoke_results'));
    expect(fs.existsSync(written.timestampedReportPath), 'Zeitgestempelter Smoke-Report fehlt').toBe(true);
    expect(fs.existsSync(written.latestReportPath), 'Latest-Smoke-Report fehlt').toBe(true);

    const latest = JSON.parse(fs.readFileSync(written.latestReportPath, 'utf8'));
    expect(latest.selectedTemplates).toEqual(['feature']);
    expect(latest.selectedMethods).toEqual(['simple']);
    expect(latest.expectedResultCount).toBe(1);
    expect(latest.resultCount).toBe(1);
    expect(latest.passedCount).toBe(1);
    expect(latest.failedCount).toBe(0);
    expect(latest.totalTokensUsed).toBe(1234);
    expect(latest.totalDurationMs).toBe(4567);
  });
});