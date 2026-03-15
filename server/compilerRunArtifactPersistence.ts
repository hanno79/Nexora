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
import { logger } from './logger';

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
  timestampedWritten: boolean;
  latestWritten: boolean;
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
  } catch (error) {
    logger.error('Compiler run artifact payload serialization failed', {
      workflow: input.workflow,
      routeKey: input.routeKey,
      error,
    });
    // Fallback: stageData weglassen (haeufigste Quelle fuer zirkulaere Referenzen)
    const safePayload = { ...payload, stageData: { _serializationFailed: true } };
    try {
      serialized = JSON.stringify(safePayload, null, 2) + '\n';
    } catch (safeError) {
      logger.error('Compiler run artifact safe payload serialization failed', {
        workflow: input.workflow,
        routeKey: input.routeKey,
        error: safeError,
      });
      serialized = JSON.stringify({
        timestamp,
        workflow: input.workflow,
        routeKey: input.routeKey,
        qualityStatus: input.qualityStatus,
        finalizationStage: input.finalizationStage,
        _serializationFailed: true,
      }, null, 2) + '\n';
    }
  }

  let timestampedWritten = false;
  let latestWritten = false;
  let timestampedWriteError: unknown = null;
  let latestWriteError: unknown = null;

  try {
    await fs.promises.writeFile(timestampedArtifactPath, serialized, 'utf8');
    timestampedWritten = true;
  } catch (writeError) {
    timestampedWriteError = writeError;
    logger.error('Compiler run artifact timestamped write failed', {
      path: timestampedArtifactPath,
      error: writeError,
    });
  }
  try {
    await fs.promises.writeFile(latestArtifactPath, serialized, 'utf8');
    latestWritten = true;
  } catch (writeError) {
    latestWriteError = writeError;
    logger.error('Compiler run artifact latest write failed', {
      path: latestArtifactPath,
      error: writeError,
    });
  }

  if (!timestampedWritten && !latestWritten) {
    throw new Error(
      `Failed to persist compiler run artifact at ${timestampedArtifactPath} and ${latestArtifactPath}: `
      + `timestamped=${String(timestampedWriteError)}, latest=${String(latestWriteError)}`
    );
  }

  return {
    reportDir,
    timestampedArtifactPath,
    latestArtifactPath,
    timestampedWritten,
    latestWritten,
  };
}
