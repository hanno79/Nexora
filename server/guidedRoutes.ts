/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Registriert Guided-Workflow-Routen inklusive Finalisierung, SSE-Endpunkt und Session-Cleanup.
*/

// ÄNDERUNG 08.03.2026: Guided-Routen aus `server/routes.ts` extrahiert,
// um den Guided-Workflow konservativ zu modularisieren und `server/routes.ts` deutlich zu verkleinern.

import type { Express, RequestHandler } from 'express';
import { asyncHandler } from './asyncHandler';
import { getGuidedAiService } from './guidedAiService';
import { registerGuidedFinalizeRoutes } from './guidedFinalizeRoutes';
import { registerGuidedFinalizeStreamRoute } from './guidedFinalizeStreamRoute';
import { normalizeGuidedRequestInput } from './guidedRouteSupport';
import {
  AuthenticatedRequest,
  ensureGuidedOpenRouterConfigured,
  registerGuidedSessionCleanup,
  resolveGuidedPrdContext,
} from './guidedRouteRegistrySupport';

export async function registerGuidedRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
  aiRateLimiter: RequestHandler,
  guidedFinalizeTimeoutMs: number,
): Promise<void> {
  app.post('/api/ai/guided-start', isAuthenticated, aiRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!ensureGuidedOpenRouterConfigured(res)) {
      return;
    }

    const { projectIdea, existingContent, mode, prdId } = req.body;
    const userId = req.user.claims.sub;
    const prdContext = await resolveGuidedPrdContext(req, res, prdId);
    if (prdContext.shouldReturn) {
      return;
    }

    const normalized = normalizeGuidedRequestInput(projectIdea, existingContent);
    if (normalized.validationMessage) {
      return res.status(400).json({ message: normalized.validationMessage });
    }

    const result = await getGuidedAiService().startGuidedWorkflow(normalized.normalizedIdea, userId, {
      existingContent: normalized.hasExistingContent ? normalized.normalizedExistingContent : undefined,
      mode: mode === 'improve' ? 'improve' : 'generate',
      templateCategory: prdContext.templateCategory,
    });

    res.json(result);
  }));

  app.post('/api/ai/guided-resume', isAuthenticated, aiRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { sessionId } = req.body;
    const userId = req.user.claims.sub;

    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ message: 'Session ID is required' });
    }

    try {
      const context = await getGuidedAiService().getSessionState(sessionId, userId);
      if (!context) {
        return res.status(404).json({ message: 'Session not found or expired' });
      }

      res.json({
        sessionId,
        roundNumber: context.roundNumber,
        featureOverview: context.featureOverview,
        workflowMode: context.workflowMode,
        hasAnswers: context.answers.length > 0,
        canFinalize: true,
      });
    } catch (error: any) {
      if (error?.message?.includes('Forbidden')) {
        return res.status(403).json({ message: 'You do not have access to this session' });
      }
      throw error;
    }
  }));

  app.post('/api/ai/guided-answer', isAuthenticated, aiRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!ensureGuidedOpenRouterConfigured(res)) {
      return;
    }

    const { sessionId, answers, questions } = req.body;
    const userId = req.user.claims.sub;

    if (!sessionId) {
      return res.status(400).json({ message: 'Session ID is required' });
    }

    if (!answers || !Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ message: 'At least one answer is required' });
    }

    if (!questions || !Array.isArray(questions)) {
      return res.status(400).json({ message: 'Questions array is required for context' });
    }

    const result = await getGuidedAiService().processAnswers(sessionId, answers, questions, userId);
    res.json(result);
  }));

  registerGuidedFinalizeRoutes(app, isAuthenticated, aiRateLimiter);
  registerGuidedFinalizeStreamRoute(app, isAuthenticated, aiRateLimiter, guidedFinalizeTimeoutMs);
  registerGuidedSessionCleanup();
}