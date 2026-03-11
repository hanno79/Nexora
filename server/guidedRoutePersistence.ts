/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Persistenz- und Usage-Helfer fuer Guided-Routen.
*/

import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';
import type { PRDStructure } from './prdStructure';
import { logAiUsage } from './aiUsageLogger';
import { db } from './db';
import { logger } from './logger';
import { resolveModelTier } from './openrouter';
import {
  buildCompilerRunDiagnostics,
  mergeDiagnosticsIntoIterationLog,
  type CompilerRunDiagnostics,
  type PrdQualityStatus,
} from './prdRunQuality';
import { storage } from './storage';

export async function logGuidedGenerationUsage(
  userId: string,
  modelsUsed: string[],
  tokensUsed: number | undefined,
  prdId?: string | null,
): Promise<void> {
  if (!modelsUsed.length) {
    return;
  }

  const [userRow] = await db
    .select({ aiPreferences: users.aiPreferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const userTier = resolveModelTier((userRow?.aiPreferences as any)?.tier);

  await logAiUsage(
    userId,
    'generator',
    modelsUsed[0],
    userTier,
    {
      prompt_tokens: 0,
      completion_tokens: tokensUsed || 0,
      total_tokens: tokensUsed || 0,
    },
    prdId || undefined,
  );
}

export async function persistGuidedPrdFinalizationBestEffort(params: {
  editablePrdId: string | null;
  userId: string;
  qualityStatus: PrdQualityStatus;
  compilerDiagnostics?: CompilerRunDiagnostics | null;
  content?: string;
  structuredContent?: PRDStructure | null;
  sourceIterationLog?: string | null;
  errorLogMessage: string;
}): Promise<void> {
  if (!params.editablePrdId) {
    return;
  }

  try {
    const existingPrd = await storage.getPrd(params.editablePrdId);
    if (!existingPrd) {
      return;
    }

    const baseIterationLog = params.sourceIterationLog ?? existingPrd.iterationLog;
    const iterationLog = params.qualityStatus === 'passed'
      ? (baseIterationLog || null)
      : mergeDiagnosticsIntoIterationLog(
          baseIterationLog,
          params.qualityStatus,
          params.compilerDiagnostics || buildCompilerRunDiagnostics({ quality: null, repairAttempts: 0 }),
        );

    await storage.persistPrdRunFinalization({
      prdId: params.editablePrdId,
      userId: params.userId,
      qualityStatus: params.qualityStatus,
      finalizationStage: 'final',
      content: params.qualityStatus !== 'cancelled' ? params.content : undefined,
      structuredContent: params.qualityStatus !== 'cancelled'
        ? (params.structuredContent ?? null)
        : undefined,
      iterationLog,
      compilerDiagnostics: params.compilerDiagnostics,
    });
  } catch (error) {
    logger.error(params.errorLogMessage, { error });
  }
}
