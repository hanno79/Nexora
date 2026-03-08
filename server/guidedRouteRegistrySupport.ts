/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Gemeinsame Guided-Routen-Typen, PRD-Kontextauflösung und Session-Cleanup-Helfer.
*/

// ÄNDERUNG 08.03.2026: Gemeinsame Guided-Routen-Helfer aus `server/guidedRoutes.ts` extrahiert,
// damit die Guided-Routenmodule unter dem 500-Zeilen-Limit bleiben.

import type { Request, Response } from 'express';
import { resolveTemplateCategoryForPrd } from './aiRouteCompilerSupport';
import { getGuidedAiService } from './guidedAiService';
import { logger } from './logger';
import { getOpenRouterConfigError, isOpenRouterConfigured } from './openrouter';
import { requireEditablePrdId } from './prdAccess';
import { storage } from './storage';

export type AuthenticatedRequest = Request & {
  user: {
    claims: {
      sub: string;
    };
  };
};

export type GuidedPrdContext = {
  shouldReturn: boolean;
  editablePrdId: string | null;
  templateCategory?: string;
};

export function ensureGuidedOpenRouterConfigured(res: Response): boolean {
  if (isOpenRouterConfigured()) {
    return true;
  }

  res.status(503).json({
    message: getOpenRouterConfigError(),
  });
  return false;
}

export async function resolveGuidedPrdContext(
  req: AuthenticatedRequest,
  res: Response,
  prdId: unknown,
): Promise<GuidedPrdContext> {
  const editablePrdId = await requireEditablePrdId(storage, req, res, prdId, {
    invalidMessage: 'PRD ID must be a non-empty string',
  });

  if (prdId !== undefined && prdId !== null && !editablePrdId) {
    return {
      shouldReturn: true,
      editablePrdId: null,
    };
  }

  return {
    shouldReturn: false,
    editablePrdId,
    templateCategory: await resolveTemplateCategoryForPrd(editablePrdId),
  };
}

export function registerGuidedSessionCleanup(): void {
  const GUIDED_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
  const guidedCleanupTimer = setInterval(async () => {
    try {
      const removed = await getGuidedAiService().cleanupExpiredSessions();
      if (removed > 0) {
        logger.info(`🧹 Cleaned up ${removed} expired guided sessions`);
      }
    } catch (err) {
      logger.error('Guided session cleanup failed', { error: err });
    }
  }, GUIDED_CLEANUP_INTERVAL_MS);

  const cleanupGuidedInterval = () => {
    clearInterval(guidedCleanupTimer);
    logger.info('🛑 Guided session cleanup interval stopped');
  };

  process.once('SIGTERM', cleanupGuidedInterval);
  process.once('SIGINT', cleanupGuidedInterval);
}
