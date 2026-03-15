/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Persistenz- und Usage-Helfer fuer Guided-Routen.
*/

import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';
import type { TokenUsage } from '@shared/schema';
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

export function sumGuidedStageUsage(
  ...stages: Array<{ usage?: Partial<TokenUsage> | null } | null | undefined>
): { promptTokens: number; completionTokens: number } {
  return stages.reduce(
    (acc, stage) => ({
      promptTokens: acc.promptTokens + (stage?.usage?.prompt_tokens || 0),
      completionTokens: acc.completionTokens + (stage?.usage?.completion_tokens || 0),
    }),
    { promptTokens: 0, completionTokens: 0 },
  );
}

/**
 * Logs Guided generation usage using explicit prompt/completion token counts when available.
 */
export async function logGuidedGenerationUsage(
  userId: string,
  modelsUsed: string[],
  promptTokens: number | undefined,
  completionTokens: number | undefined,
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
  const normalizedPromptTokens = promptTokens || 0;
  const normalizedCompletionTokens = completionTokens || 0;

  await logAiUsage(
    userId,
    'generator',
    modelsUsed[0],
    userTier,
    {
      prompt_tokens: normalizedPromptTokens,
      completion_tokens: normalizedCompletionTokens,
      total_tokens: normalizedPromptTokens + normalizedCompletionTokens,
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
    // ÄNDERUNG 15.03.2026: Diagnostics werden IMMER in den Iteration-Log gemergt,
    // auch bei qualityStatus === 'passed'. Ohne den Marker verschwindet der
    // Diagnose-Tab im Editor nach Navigation, weil extractLatestCompilerRunRecord()
    // keinen <!-- compiler-run:{...} --> Kommentar findet.
    const iterationLog = mergeDiagnosticsIntoIterationLog(
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
