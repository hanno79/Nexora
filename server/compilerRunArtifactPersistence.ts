/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Persistiert Compiler-Run-Artefakte dauerhaft unter documentation/compiler_runs.
*/

import fs from 'fs';
import path from 'path';
import type { PrdQualityReport } from './prdCompiler';
import type { PRDStructure } from './prdStructure';
import type { CompilerRunDiagnostics, PrdFinalizationStage, PrdQualityStatus } from './prdRunQuality';

export interface PersistCompilerRunArtifactInput {
  baseDir: string;
  workflow: string;
  routeKey: string;
  qualityStatus: PrdQualityStatus;
  finalizationStage: PrdFinalizationStage;
  finalContent?: string;
  compiledContent?: string;
  compiledStructure?: PRDStructure | null;
  quality?: PrdQualityReport | null;
  compilerDiagnostics?: CompilerRunDiagnostics | null;
  iterationLog?: string | null;
  modelsUsed?: string[];
  requestContext?: Record<string, unknown>;
  stageData?: Record<string, unknown>;
}

export interface CompilerRunArtifactWriteResult {
  reportDir: string;
  timestampedArtifactPath: string;
  latestArtifactPath: string;
}

function sanitizeKey(value: string): string {
  return String(value || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';
}

export async function persistCompilerRunArtifact(
  input: PersistCompilerRunArtifactInput
): Promise<CompilerRunArtifactWriteResult> {
  const reportDir = path.join(input.baseDir, 'documentation', 'compiler_runs');
  await fs.promises.mkdir(reportDir, { recursive: true });

  const timestamp = new Date().toISOString();
  const timestampToken = timestamp.replace(/[:.]/g, '-');
  const workflowKey = sanitizeKey(input.workflow);
  const routeKey = sanitizeKey(input.routeKey);
  const fileKey = `${workflowKey}__${routeKey}`;

  const payload = {
    timestamp,
    workflow: input.workflow,
    routeKey: input.routeKey,
    qualityStatus: input.qualityStatus,
    finalizationStage: input.finalizationStage,
    finalContent: input.finalContent || '',
    compiled: {
      content: input.compiledContent || input.finalContent || '',
      structure: input.compiledStructure || null,
      quality: input.quality || null,
    },
    iterationLog: input.iterationLog || null,
    modelsUsed: input.modelsUsed || [],
    compilerDiagnostics: input.compilerDiagnostics || null,
    requestContext: input.requestContext || {},
    stageData: input.stageData || {},
  };

  const timestampedArtifactPath = path.join(reportDir, `compiler_run_${fileKey}_${timestampToken}.json`);
  const latestArtifactPath = path.join(reportDir, `compiler_run_${fileKey}_latest.json`);
  let serialized: string;
  try {
    serialized = JSON.stringify(payload, null, 2) + '\n';
  } catch {
    // Fallback: stageData weglassen (haeufigste Quelle fuer zirkulaere Referenzen)
    const safePayload = { ...payload, stageData: { _serializationFailed: true } };
    serialized = JSON.stringify(safePayload, null, 2) + '\n';
  }

  await fs.promises.writeFile(timestampedArtifactPath, serialized, 'utf8');
  await fs.promises.writeFile(latestArtifactPath, serialized, 'utf8');

  return {
    reportDir,
    timestampedArtifactPath,
    latestArtifactPath,
  };
}
