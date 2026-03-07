/*
Author: rahn
Datum: 07.03.2026
Version: 1.0
Beschreibung: Persistiert Smoke-Test-Resultate und Laufmetriken dauerhaft unter documentation/smoke_results.
*/

import fs from 'fs';
import path from 'path';

export interface PersistedSmokeResult {
  template: string;
  method: string;
  valid: boolean;
  featureCount: number;
  qualityScore: number;
  errorIssues: string[];
  warningIssues: string[];
  modelsUsed: string[];
  tokensUsed: number;
  durationMs: number;
  truncatedLikely: boolean;
  error?: string;
}

export interface PersistSmokeReportInput {
  baseDir: string;
  templates: string[];
  methods: string[];
  results: PersistedSmokeResult[];
}

export interface SmokeReportWriteResult {
  reportDir: string;
  timestampedReportPath: string;
  latestReportPath: string;
}

function buildSelectionKey(templates: string[], methods: string[]): string {
  const raw = `${templates.join('_')}__${methods.join('_')}`;
  return raw.replace(/[^a-z0-9_-]+/gi, '-');
}

export function persistSmokeReport(input: PersistSmokeReportInput): SmokeReportWriteResult {
  // ÄNDERUNG 07.03.2026: Smoke-Resultate bewusst unter documentation/ persistieren,
  // damit die Artefakte nicht mehr nur als temporaere `.tmp_*`-Dateien verschwinden.
  const reportDir = path.join(input.baseDir, 'documentation', 'smoke_results');
  fs.mkdirSync(reportDir, { recursive: true });

  const timestamp = new Date().toISOString();
  const timestampToken = timestamp.replace(/[:.]/g, '-');
  const selectionKey = buildSelectionKey(input.templates, input.methods);
  const passedCount = input.results.filter(result => result.valid).length;
  const totalTokensUsed = input.results.reduce((sum, result) => sum + (result.tokensUsed || 0), 0);
  const totalDurationMs = input.results.reduce((sum, result) => sum + (result.durationMs || 0), 0);

  const payload = {
    timestamp,
    selectedTemplates: [...input.templates],
    selectedMethods: [...input.methods],
    expectedResultCount: input.templates.length * input.methods.length,
    resultCount: input.results.length,
    passedCount,
    failedCount: input.results.length - passedCount,
    totalTokensUsed,
    totalDurationMs,
    results: input.results,
  };

  const timestampedReportPath = path.join(reportDir, `smoke_${selectionKey}_${timestampToken}.json`);
  const latestReportPath = path.join(reportDir, `smoke_${selectionKey}_latest.json`);

  fs.writeFileSync(timestampedReportPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(latestReportPath, JSON.stringify(payload, null, 2));

  return {
    reportDir,
    timestampedReportPath,
    latestReportPath,
  };
}