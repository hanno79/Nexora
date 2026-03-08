/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Registriert den SSE-Endpunkt fuer Guided-Finalisierung mit Timeout- und Disconnect-Behandlung.
*/

// ÄNDERUNG 08.03.2026: Guided-Finalize-SSE-Route aus `server/guidedRoutes.ts` extrahiert,
// damit der Guided-Routenblock unter dem 500-Zeilen-Limit bleibt.

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
  isGuidedTimeoutError,
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
import { isIterativeClientDisconnected } from './iterativeRequestGuard';
import { logger } from './logger';
import { classifyRunFailure } from './prdRunQuality';

export function registerGuidedFinalizeStreamRoute(
  app: Express,
  isAuthenticated: RequestHandler,
  aiRateLimiter: RequestHandler,
  guidedFinalizeTimeoutMs: number,
): void {
  app.post('/api/ai/guided-finalize-stream', isAuthenticated, aiRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const requestStartedAt = Date.now();
    let editablePrdId: string | null = null;
    let userId = '';
    let templateCategory: string | undefined;
    let sseClosed = false;
    let sseCompleted = false;
    let timeoutId: NodeJS.Timeout | null = null;
    let cleanupSseListeners = () => {};

    const cleanupTimeout = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const isRequestClosed = () => isIterativeClientDisconnected({
      sseClosed,
      reqAborted: req.aborted,
      reqDestroyed: req.destroyed,
      resWritableEnded: res.writableEnded,
      resDestroyed: res.destroyed,
    });

    const safeEndSse = () => {
      cleanupTimeout();
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.end();
        } catch {
          // Keine weitere Aktion noetig.
        }
      }
    };

    try {
      if (!ensureGuidedOpenRouterConfigured(res)) {
        return;
      }

      const { sessionId, prdId } = req.body;
      userId = req.user.claims.sub;
      const prdContext = await resolveGuidedPrdContext(req, res, prdId);
      if (prdContext.shouldReturn) {
        return;
      }

      editablePrdId = prdContext.editablePrdId;
      templateCategory = prdContext.templateCategory;

      if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required' });
      }

      const handleSseDisconnect = () => {
        if (sseClosed) {
          return;
        }
        sseClosed = true;
        cleanupTimeout();
        if (!sseCompleted) {
          logger.warn('Guided finalize SSE client disconnected', { hasPrdId: !!editablePrdId });
        }
        cleanupSseListeners();
        safeEndSse();
      };

      res.on('close', handleSseDisconnect);
      req.on('aborted', handleSseDisconnect);
      cleanupSseListeners = () => {
        res.off('close', handleSseDisconnect);
        req.off('aborted', handleSseDisconnect);
      };

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      if (!isRequestClosed()) {
        res.write(`data: ${JSON.stringify({ type: 'generation_start' })}\n\n`);
      }

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          logger.warn('Guided finalize timeout reached', { hasPrdId: !!editablePrdId });
          reject(new Error('Guided finalize aborted due to timeout'));
        }, guidedFinalizeTimeoutMs);
      });

      const result = await Promise.race([
        getGuidedAiService().finalizePRD(sessionId, userId, { templateCategory }),
        timeoutPromise,
      ]);

      if (isRequestClosed()) {
        logger.debug('Guided finalize request closed before response', { hasPrdId: !!editablePrdId });
        return;
      }

      const assessed = assessCompilerOutcome({
        content: result.prdContent,
        mode: result.workflowMode || 'generate',
        existingContent: result.existingContent,
        templateCategory,
        baseDiagnostics: result.diagnostics,
      });

      await logGuidedGenerationUsage(userId, result.modelsUsed, result.tokensUsed, prdId);

      const payload = {
        finalContent: result.prdContent,
        prdContent: result.prdContent,
        tokensUsed: result.tokensUsed,
        modelsUsed: result.modelsUsed,
        workflowMode: result.workflowMode,
        totalTokens: result.tokensUsed,
        qualityStatus: assessed.qualityStatus,
        compilerDiagnostics: assessed.compilerDiagnostics,
        finalizationStage: assessed.finalizationStage,
        effectiveMode: result.workflowMode || 'generate',
        baselineFeatureCount: assessed.compilerDiagnostics?.totalFeatureCount ?? 0,
        baselinePartial: false,
      };

      if (!isRequestClosed()) {
        if (assessed.qualityStatus === 'passed') {
          res.write(`event: result\ndata: ${JSON.stringify(payload)}\n\n`);
        } else {
          res.write(`event: error\ndata: ${JSON.stringify({
            message: 'Compiler quality gate failed after final verification.',
            status: assessed.qualityStatus,
            ...payload,
          })}\n\n`);
        }
      }
      sseCompleted = true;
      safeEndSse();

      void persistCompilerRunArtifactBestEffort({
        workflow: 'guided',
        routeKey: 'guided-finalize-stream',
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
          templateCategory: templateCategory || null,
          prdId: editablePrdId || null,
          useSSE: true,
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
        editablePrdId,
        userId,
        qualityStatus: assessed.qualityStatus,
        compilerDiagnostics: assessed.compilerDiagnostics,
        content: assessed.qualityStatus === 'passed' ? assessed.compiled.content : undefined,
        structuredContent: assessed.qualityStatus === 'passed' ? assessed.compiled.structure : undefined,
        errorLogMessage: 'Guided finalize SSE persistence failed',
      });
    } catch (error: any) {
      cleanupTimeout();

      if (isGuidedTimeoutError(error)) {
        logger.debug('Guided finalize aborted due to timeout', { hasPrdId: !!editablePrdId });
        const timeoutFailure = classifyRunFailure(error);
        void persistCompilerRunArtifactBestEffort({
          workflow: 'guided',
          routeKey: 'guided-finalize-stream',
          qualityStatus: timeoutFailure.qualityStatus,
          finalizationStage: 'final',
          compilerDiagnostics: timeoutFailure.diagnostics,
          requestContext: {
            prdId: editablePrdId || null,
            templateCategory: templateCategory || null,
            useSSE: true,
          },
          stageData: withArtifactMetrics({
            requestStartedAt,
            stageData: {
              errorMessage: timeoutFailure.message,
              qualityError: error instanceof Error ? error.message : String(error || ''),
            },
          }),
        });

        if (res.headersSent && !res.writableEnded && !res.destroyed) {
          res.write(`event: error\ndata: ${JSON.stringify({
            message: 'Guided finalize aborted due to timeout',
            qualityStatus: 'cancelled',
            finalizationStage: 'final',
            autoSaveRequested: false,
          })}\n\n`);
          res.end();
        }
        return;
      }

      logger.error('Guided finalize SSE error', { error });
      const failure = classifyRunFailure(error);
      void persistCompilerRunArtifactBestEffort({
        workflow: 'guided',
        routeKey: 'guided-finalize-stream',
        qualityStatus: failure.qualityStatus,
        finalizationStage: 'final',
        compilerDiagnostics: failure.diagnostics,
        requestContext: {
          prdId: editablePrdId || null,
          templateCategory: templateCategory || null,
          useSSE: true,
        },
        stageData: withArtifactMetrics({
          requestStartedAt,
          stageData: {
            errorMessage: failure.message,
            qualityError: error instanceof Error ? error.message : String(error || ''),
          },
        }),
      });

      if (res.headersSent && !res.writableEnded && !res.destroyed) {
        res.write(`event: error\ndata: ${JSON.stringify({
          message: failure.message,
          qualityStatus: failure.qualityStatus,
          compilerDiagnostics: failure.diagnostics,
          finalizationStage: 'final',
          autoSaveRequested: false,
        })}\n\n`);
        res.end();
      } else if (!res.headersSent) {
        res.status(qualityStatusHttpCode(failure.qualityStatus)).json({
          message: failure.message,
          qualityStatus: failure.qualityStatus,
          compilerDiagnostics: failure.diagnostics,
          finalizationStage: 'final',
          autoSaveRequested: false,
        });
      }

      void persistGuidedPrdFinalizationBestEffort({
        editablePrdId,
        userId,
        qualityStatus: failure.qualityStatus,
        compilerDiagnostics: failure.diagnostics,
        errorLogMessage: 'Guided finalize SSE failure persistence failed',
      });
    } finally {
      cleanupTimeout();
      cleanupSseListeners();
    }
  }));
}
