/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Compiler- und Persistenz-Helfer fuer KI-Routen mit Storage-/DB-Kopplung.
*/

import fs from 'fs';
import path from 'path';
import { persistCompilerRunArtifact } from './compilerRunArtifactPersistence';
import { logger } from './logger';
import { compilePrdDocument } from './prdCompiler';
import {
  buildCompilerRunDiagnostics,
  type CompilerRunDiagnostics,
  type PrdQualityStatus,
} from './prdRunQuality';
import type { PRDStructure } from './prdStructure';
import { storage } from './storage';

export async function resolveTemplateCategoryForPrd(prdId?: string | null): Promise<string | undefined> {
  if (!prdId) return undefined;
  const prd = await storage.getPrd(prdId);
  if (!prd?.templateId) return undefined;
  const template = await storage.getTemplate(prd.templateId);
  return template?.category || undefined;
}

export function assessCompilerOutcome(params: {
  content: string;
  mode: 'generate' | 'improve';
  existingContent?: string;
  templateCategory?: string;
  baseDiagnostics?: Record<string, any>;
}) {
  const compiled = compilePrdDocument(params.content, {
    mode: params.mode,
    existingContent: params.existingContent,
    templateCategory: params.templateCategory,
    strictCanonical: true,
    strictLanguageConsistency: true,
    enableFeatureAggregation: true,
  });
  const qualityStatus: PrdQualityStatus = compiled.quality.valid ? 'passed' : 'failed_quality';
  const compilerDiagnostics = buildCompilerRunDiagnostics({
    quality: compiled.quality,
    base: params.baseDiagnostics || {},
  });
  return {
    qualityStatus,
    compiled,
    compilerDiagnostics,
    finalizationStage: 'final' as const,
  };
}

export async function persistCompilerRunArtifactBestEffort(params: {
  workflow: string;
  routeKey: string;
  qualityStatus: PrdQualityStatus;
  finalizationStage: 'final';
  finalContent?: string;
  compiledContent?: string;
  compiledStructure?: PRDStructure | null;
  quality?: ReturnType<typeof compilePrdDocument>['quality'] | null;
  compilerDiagnostics?: CompilerRunDiagnostics | null;
  iterationLog?: string | null;
  modelsUsed?: string[];
  requestContext?: Record<string, unknown>;
  stageData?: Record<string, unknown>;
}) {
  try {
    const written = await persistCompilerRunArtifact({
      baseDir: process.cwd(),
      workflow: params.workflow,
      routeKey: params.routeKey,
      qualityStatus: params.qualityStatus,
      finalizationStage: params.finalizationStage,
      finalContent: params.finalContent,
      compiledContent: params.compiledContent,
      compiledStructure: params.compiledStructure,
      quality: params.quality,
      compilerDiagnostics: params.compilerDiagnostics || null,
      iterationLog: params.iterationLog,
      modelsUsed: params.modelsUsed,
      requestContext: params.requestContext,
      stageData: params.stageData,
    });
    logger.info('Compiler run artifact persisted', {
      workflow: params.workflow,
      routeKey: params.routeKey,
      latestArtifactPath: written.latestArtifactPath,
    });
  } catch (error) {
    logger.error('Compiler run artifact persistence failed', {
      workflow: params.workflow,
      routeKey: params.routeKey,
      error,
    });
    console.error(
      `[COMPILER-ARTIFACT-FAIL] ${params.workflow}/${params.routeKey}: ${error instanceof Error ? error.message : String(error)}`
    );
    // Minimales Fehler-Artefakt als letzte Rettung — damit immer eine Datei auf Disk landet
    try {
      const fallbackDir = path.join(process.cwd(), 'documentation', 'compiler_runs');
      await fs.promises.mkdir(fallbackDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const fallbackPath = path.join(fallbackDir, `compiler_run_error_${ts}.json`);
      await fs.promises.writeFile(fallbackPath, JSON.stringify({
        _error: true,
        timestamp: new Date().toISOString(),
        workflow: params.workflow,
        routeKey: params.routeKey,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        cwd: process.cwd(),
      }, null, 2) + '\n', 'utf8');
    } catch { /* absolute last resort — nothing more we can do */ }
  }
}
