/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Registriert Guided-Finalize- und Guided-Skip-Routen mit konservativer Artefakt- und Persistenzlogik.
*/

// ÄNDERUNG 08.03.2026: Guided-Finalize- und Skip-Routen aus `server/guidedRoutes.ts` extrahiert,
// damit die Guided-Routen modular und unter dem 500-Zeilen-Limit bleiben.

import type { Express, RequestHandler } from 'express';
import { asyncHandler } from './asyncHandler';
import {
  assessCompilerOutcome,
  persistCompilerRunArtifactBestEffort,
} from './aiRouteCompilerSupport';
import {
  qualityStatusHttpCode,
  withArtifactMetrics,
} from './aiRouteSupport';
import { getGuidedAiService } from './guidedAiService';
import {
  buildGuidedResponsePayload,
  normalizeGuidedRequestInput,
} from './guidedRouteSupport';
import {
  logGuidedGenerationUsage,
  persistGuidedPrdFinalizationBestEffort,
} from './guidedRoutePersistence';
import {
  AuthenticatedRequest,
  ensureGuidedOpenRouterConfigured,
  resolveGuidedPrdContext,
} from './guidedRouteRegistrySupport';
import { classifyRunFailure } from './prdRunQuality';

export function registerGuidedFinalizeRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
  aiRateLimiter: RequestHandler,
): void {
  app.post('/api/ai/guided-finalize', isAuthenticated, aiRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!ensureGuidedOpenRouterConfigured(res)) {
      return;
    }

    const requestStartedAt = Date.now();
    const { sessionId, prdId } = req.body;
    const userId = req.user.claims.sub;
    const prdContext = await resolveGuidedPrdContext(req, res, prdId);
    if (prdContext.shouldReturn) {
      return;
    }

    if (!sessionId) {
      return res.status(400).json({ message: 'Session ID is required' });
    }

    try {
      const result = await getGuidedAiService().finalizePRD(sessionId, userId, {
        templateCategory: prdContext.templateCategory,
      });
      const assessed = assessCompilerOutcome({
        content: result.prdContent,
        mode: result.workflowMode || 'generate',
        existingContent: result.existingContent,
        templateCategory: prdContext.templateCategory,
        baseDiagnostics: result.diagnostics,
      });
      const saveRequested = !!(prdContext.editablePrdId && assessed.qualityStatus === 'passed');

      await logGuidedGenerationUsage(userId, result.modelsUsed, result.tokensUsed, prdId);

      const payload = buildGuidedResponsePayload({
        result,
        assessed,
        saveRequested,
        fallbackMode: 'generate',
      });

      if (assessed.qualityStatus !== 'passed') {
        res.status(qualityStatusHttpCode(assessed.qualityStatus)).json(payload);
      } else {
        res.json(payload);
      }

      void persistCompilerRunArtifactBestEffort({
        workflow: 'guided',
        routeKey: 'guided-finalize',
        qualityStatus: assessed.qualityStatus,
        finalizationStage: assessed.finalizationStage,
        finalContent: result.prdContent,
        compiledContent: assessed.compiled.content,
        compiledStructure: assessed.compiled.structure,
        quality: assessed.compiled.quality,
        compilerDiagnostics: assessed.compilerDiagnostics,
        modelsUsed: result.modelsUsed,
        requestContext: {
          workflowMode: result.workflowMode || 'generate',
          templateCategory: prdContext.templateCategory || null,
          prdId: prdContext.editablePrdId || null,
          hasExistingContent: !!result.existingContent,
        },
        stageData: withArtifactMetrics({
          requestStartedAt,
          timings: result.timings || null,
          totalTokens: result.tokensUsed,
          stageData: {
            analysisStage: result.analysisStage || null,
            generationStage: result.generationStage || null,
            compilerArtifact: result.compilerArtifact || null,
          },
        }),
      });

      void persistGuidedPrdFinalizationBestEffort({
        editablePrdId: prdContext.editablePrdId,
        userId,
        qualityStatus: assessed.qualityStatus,
        compilerDiagnostics: assessed.compilerDiagnostics,
        content: assessed.qualityStatus === 'passed' ? assessed.compiled.content : undefined,
        structuredContent: assessed.qualityStatus === 'passed' ? assessed.compiled.structure : undefined,
        errorLogMessage: 'Guided finalize persistence failed',
      });
    } catch (error: any) {
      const failure = classifyRunFailure(error);
      void persistCompilerRunArtifactBestEffort({
        workflow: 'guided',
        routeKey: 'guided-finalize',
        qualityStatus: failure.qualityStatus,
        finalizationStage: 'final',
        compilerDiagnostics: failure.diagnostics,
        requestContext: {
          prdId: prdContext.editablePrdId || null,
          templateCategory: prdContext.templateCategory || null,
        },
        stageData: withArtifactMetrics({
          requestStartedAt,
          stageData: {
            errorMessage: failure.message,
            qualityError: error instanceof Error ? error.message : String(error || ''),
          },
        }),
      });

      void persistGuidedPrdFinalizationBestEffort({
        editablePrdId: prdContext.editablePrdId,
        userId,
        qualityStatus: failure.qualityStatus,
        compilerDiagnostics: failure.diagnostics,
        errorLogMessage: 'Guided finalize failure diagnostics persistence failed',
      });

      res.status(qualityStatusHttpCode(failure.qualityStatus)).json({
        message: failure.message,
        qualityStatus: failure.qualityStatus,
        compilerDiagnostics: failure.diagnostics,
        finalizationStage: 'final',
        autoSaveRequested: false,
      });
    }
  }));

  app.post('/api/ai/guided-skip', isAuthenticated, aiRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!ensureGuidedOpenRouterConfigured(res)) {
      return;
    }

    const requestStartedAt = Date.now();
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

    try {
      const requestedMode: 'improve' | 'generate' = mode === 'improve' ? 'improve' : 'generate';
      const result = await getGuidedAiService().skipToFinalize(normalized.normalizedIdea, userId, {
        existingContent: normalized.hasExistingContent ? normalized.normalizedExistingContent : undefined,
        mode: requestedMode,
        templateCategory: prdContext.templateCategory,
      });
      const assessed = assessCompilerOutcome({
        content: result.prdContent,
        mode: result.workflowMode || requestedMode,
        existingContent: result.existingContent,
        templateCategory: prdContext.templateCategory,
        baseDiagnostics: result.diagnostics,
      });
      const saveRequested = !!(prdContext.editablePrdId && assessed.qualityStatus === 'passed');

      await logGuidedGenerationUsage(userId, result.modelsUsed, result.tokensUsed, prdId);

      const payload = buildGuidedResponsePayload({
        result,
        assessed,
        saveRequested,
        fallbackMode: requestedMode,
      });

      if (assessed.qualityStatus !== 'passed') {
        res.status(qualityStatusHttpCode(assessed.qualityStatus)).json(payload);
      } else {
        res.json(payload);
      }

      void persistCompilerRunArtifactBestEffort({
        workflow: 'guided',
        routeKey: 'guided-skip',
        qualityStatus: assessed.qualityStatus,
        finalizationStage: assessed.finalizationStage,
        finalContent: result.prdContent,
        compiledContent: assessed.compiled.content,
        compiledStructure: assessed.compiled.structure,
        quality: assessed.compiled.quality,
        compilerDiagnostics: assessed.compilerDiagnostics,
        modelsUsed: result.modelsUsed,
        requestContext: {
          workflowMode: result.workflowMode || requestedMode,
          templateCategory: prdContext.templateCategory || null,
          prdId: prdContext.editablePrdId || null,
          hasExistingContent: !!result.existingContent,
        },
        stageData: withArtifactMetrics({
          requestStartedAt,
          timings: result.timings || null,
          totalTokens: result.tokensUsed,
          stageData: {
            analysisStage: result.analysisStage || null,
            generationStage: result.generationStage || null,
            compilerArtifact: result.compilerArtifact || null,
          },
        }),
      });

      void persistGuidedPrdFinalizationBestEffort({
        editablePrdId: prdContext.editablePrdId,
        userId,
        qualityStatus: assessed.qualityStatus,
        compilerDiagnostics: assessed.compilerDiagnostics,
        content: assessed.qualityStatus === 'passed' ? assessed.compiled.content : undefined,
        structuredContent: assessed.qualityStatus === 'passed' ? assessed.compiled.structure : undefined,
        errorLogMessage: 'Guided skip persistence failed',
      });
    } catch (error: any) {
      const failure = classifyRunFailure(error);
      void persistCompilerRunArtifactBestEffort({
        workflow: 'guided',
        routeKey: 'guided-skip',
        qualityStatus: failure.qualityStatus,
        finalizationStage: 'final',
        compilerDiagnostics: failure.diagnostics,
        requestContext: {
          prdId: prdContext.editablePrdId || null,
          templateCategory: prdContext.templateCategory || null,
        },
        stageData: withArtifactMetrics({
          requestStartedAt,
          stageData: {
            errorMessage: failure.message,
            qualityError: error instanceof Error ? error.message : String(error || ''),
          },
        }),
      });

      void persistGuidedPrdFinalizationBestEffort({
        editablePrdId: prdContext.editablePrdId,
        userId,
        qualityStatus: failure.qualityStatus,
        compilerDiagnostics: failure.diagnostics,
        errorLogMessage: 'Guided skip failure diagnostics persistence failed',
      });

      res.status(qualityStatusHttpCode(failure.qualityStatus)).json({
        message: failure.message,
        qualityStatus: failure.qualityStatus,
        compilerDiagnostics: failure.diagnostics,
        finalizationStage: 'final',
        autoSaveRequested: false,
      });
    }
  }));
}
