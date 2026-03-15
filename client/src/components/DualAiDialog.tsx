import { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Sparkles, Brain, CheckCircle2, AlertCircle, Repeat, Zap, MessageSquare, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { GuidedAiDialog } from './GuidedAiDialog';
import { useTranslation } from "@/lib/i18n";
import {
  extractAiRunFinalContent,
  extractAiRunRecord,
  isFailedAiRun,
} from "@/lib/aiRunDiagnostics";
import { hasMeaningfulPrdContent } from "@/lib/prdContentMode";
import { readSSEStream, SsePayloadError } from "@/lib/sseReader";
import { formatElapsedTime } from "@/lib/utils";
import { useElapsedTimer } from "@/hooks/useElapsedTimer";

interface DualAiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentContent: string;
  prdId?: string;
  onContentGenerated: (content: string, response: any) => void;
  onGenerationFailed?: (response: any) => void;
}

type DualAiModelSources = {
  generatorModel?: string | null;
  reviewerModel?: string | null;
  verifierModel?: string | null;
  modelsUsed?: string[] | null;
  compilerDiagnostics?: {
    verifierModelIds?: string[] | null;
  } | null;
  diagnostics?: {
    verifierModelIds?: string[] | null;
  } | null;
};

function getShortModelName(model: string): string {
  return model.split('/')[1] || model;
}

export function DualAiDialog({
  open,
  onOpenChange,
  currentContent,
  prdId,
  onContentGenerated,
  onGenerationFailed,
}: DualAiDialogProps) {
  const { t } = useTranslation();
  const hasRealContent = hasMeaningfulPrdContent(currentContent);
  const [userInput, setUserInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  // ÄNDERUNG 02.03.2026: 'guided-finalizing' als neuer Workflow-Step
  const [currentStep, setCurrentStep] = useState<'idle' | 'generating' | 'reviewing' | 'improving' | 'iterating' | 'guided-finalizing' | 'done'>('idle');
  const [generatorModel, setGeneratorModel] = useState('');
  const [reviewerModel, setReviewerModel] = useState('');
  const [verifierModel, setVerifierModel] = useState('');
  const [semanticRepairModel, setSemanticRepairModel] = useState('');
  const [error, setError] = useState('');
  const [healthStatus, setHealthStatus] = useState<{ healthy: boolean; model: string; error?: string } | null>(null);
  const [healthChecking, setHealthChecking] = useState(false);
  const [runQualityStatus, setRunQualityStatus] = useState<'passed' | 'failed_quality' | 'failed_runtime' | null>(null);
  
  // Workflow-Modus: einfach, iterativ oder geführt (neu)
  const [workflowMode, setWorkflowMode] = useState<'simple' | 'iterative' | 'guided'>('simple');
  const simpleTimeoutMinutes = 30;
  const [iterationCount, setIterationCount] = useState(3);
  const [iterativeTimeoutMinutes, setIterativeTimeoutMinutes] = useState(30);
  const iterationCountMin = 2;
  const iterationCountMax = 5;
  const iterativeTimeoutMinutesMin = 5;
  const iterativeTimeoutMinutesMax = 120;
  const [useFinalReview, setUseFinalReview] = useState(false);
  const [currentIteration, setCurrentIteration] = useState(0);
  const [totalIterations, setTotalIterations] = useState(0);
  const [showGuidedDialog, setShowGuidedDialog] = useState(false);
  const [progressDetail, setProgressDetail] = useState('');
  const [totalTokensSoFar, setTotalTokensSoFar] = useState(0);
  // Fix 0.2: Mode transparency state for displaying effective mode in done step
  const [modeInfo, setModeInfo] = useState<{ effectiveMode?: string; baselineFeatureCount?: number; baselinePartial?: boolean } | null>(null);
  // ÄNDERUNG 02.03.2026: States für Guided Finalisierung
  const [guidedSessionId, setGuidedSessionId] = useState<string | null>(null);
  const [guidedSessionInfo, setGuidedSessionInfo] = useState<{projectIdea: string; answersCount: number} | null>(null);
  const [sessionRestoreChecked, setSessionRestoreChecked] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const { elapsedSeconds, startTimer: startElapsedTimer, stopTimer: stopElapsedTimer, resetTimer: resetElapsedTimer } = useElapsedTimer();

  const resetState = useCallback(() => {
    setUserInput('');
    setIsGenerating(false);
    setCurrentStep('idle');
    setGeneratorModel('');
    setReviewerModel('');
    setVerifierModel('');
    setSemanticRepairModel('');
    setError('');
    setHealthStatus(null);
    setHealthChecking(false);
    setRunQualityStatus(null);
    setWorkflowMode('simple');
    setIterationCount(3);
    setIterativeTimeoutMinutes(30);
    setUseFinalReview(false);
    setCurrentIteration(0);
    setTotalIterations(0);
    setShowGuidedDialog(false);
    setProgressDetail('');
    setTotalTokensSoFar(0);
    setModeInfo(null);
    // ÄNDERUNG 02.03.2026: Guided Session States zurücksetzen
    setGuidedSessionId(null);
    setGuidedSessionInfo(null);
    setSessionRestoreChecked(false);
    setIsFinalizing(false);
    resetElapsedTimer();
  }, [resetElapsedTimer]);

  // Clear stale quality status when workflow mode changes
  useEffect(() => {
    setRunQualityStatus(null);
  }, [workflowMode]);

  const applyResolvedModels = useCallback((sources: DualAiModelSources) => {
    const nextGeneratorModel = sources.generatorModel ?? sources.modelsUsed?.[0];
    const nextReviewerModel =
      sources.reviewerModel
      ?? sources.modelsUsed?.[1]
      ?? nextGeneratorModel
      ?? undefined;
    const nextVerifierModel =
      sources.verifierModel
      ?? sources.compilerDiagnostics?.verifierModelIds?.[0]
      ?? sources.diagnostics?.verifierModelIds?.[0]
      ?? undefined;

    if (nextGeneratorModel) {
      setGeneratorModel(nextGeneratorModel);
    }
    if (nextReviewerModel) {
      setReviewerModel(nextReviewerModel);
    }
    if (nextVerifierModel) {
      setVerifierModel(nextVerifierModel);
    }
  }, []);

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const handleClose = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    resetState();
    onOpenChange(false);
  }, [onOpenChange, resetState]);

  const closeDialogAfter = useCallback((delayMs: number) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      handleClose();
    }, delayMs);
  }, [handleClose]);

  const applyRunPayload = useCallback((payload: any) => {
    const runRecord = extractAiRunRecord(payload);
    applyResolvedModels({
      generatorModel: payload?.generatorResponse?.model ?? payload?.generatorModel,
      reviewerModel:
        payload?.reviewerResponse?.model
        ?? payload?.reviewerModel
        ?? payload?.generatorResponse?.model
        ?? payload?.generatorModel,
      verifierModel: payload?.verifierResponse?.model ?? payload?.verifierModel,
      modelsUsed: payload?.modelsUsed,
      compilerDiagnostics: runRecord.compilerDiagnostics,
      diagnostics: payload?.diagnostics,
    });
    setModeInfo({
      effectiveMode: payload?.effectiveMode,
      baselineFeatureCount: payload?.baselineFeatureCount,
      baselinePartial: payload?.baselinePartial,
    });
    if (runRecord.qualityStatus === 'failed_quality' || runRecord.qualityStatus === 'failed_runtime') {
      setRunQualityStatus(runRecord.qualityStatus);
    } else {
      setRunQualityStatus('passed');
    }
    return runRecord;
  }, [applyResolvedModels]);

  const finalizeRun = useCallback((payload: any, closeDelayMs: number) => {
    try {
      const runRecord = applyRunPayload(payload);
      const finalContent = extractAiRunFinalContent(payload);
      if (!finalContent.trim()) {
        throw new Error('AI returned no content. Please retry.');
      }

      setCurrentStep('done');
      setIsGenerating(false);
      onContentGenerated(finalContent, {
        ...payload,
        compilerDiagnostics: runRecord.compilerDiagnostics ?? payload?.compilerDiagnostics ?? payload?.diagnostics,
        qualityStatus: runRecord.qualityStatus ?? payload?.qualityStatus ?? 'passed',
        degradedResult: runRecord.qualityStatus === 'failed_quality' || runRecord.qualityStatus === 'failed_runtime',
      });
      closeDialogAfter(closeDelayMs);
    } catch (err) {
      setIsGenerating(false);
      setCurrentStep('idle');
      setError(err instanceof Error ? err.message : 'Unknown error during finalization');
      throw err;
    }
  }, [applyRunPayload, closeDialogAfter, onContentGenerated]);

  const cleanupGuidedSessionState = useCallback(() => {
    try {
      localStorage.removeItem('nexora_guided_session_v2');
    } catch (error) {
      console.warn('Failed to clear guided session state:', error);
    }
    setGuidedSessionId(null);
    setGuidedSessionInfo(null);
    setIsFinalizing(false);
  }, []);

  const handleFailedRunPayload = useCallback((payload: any, closeDelayMs: number) => {
    const runRecord = applyRunPayload(payload);
    const finalContent = extractAiRunFinalContent(payload);
    const failedStatus = runRecord.qualityStatus === 'failed_runtime' ? 'failed_runtime' : 'failed_quality';
    const normalizedPayload = {
      ...payload,
      compilerDiagnostics: runRecord.compilerDiagnostics ?? payload?.compilerDiagnostics ?? payload?.diagnostics,
      qualityStatus: failedStatus,
      degradedResult: true,
    };

    cleanupGuidedSessionState();
    setIsGenerating(false);

    if (finalContent.trim()) {
      setCurrentStep('done');
      onContentGenerated(finalContent, normalizedPayload);
      closeDialogAfter(closeDelayMs);
      return true;
    }

    if (onGenerationFailed) {
      setCurrentStep('idle');
      onGenerationFailed(normalizedPayload);
      closeDialogAfter(200);
      return true;
    }

    setCurrentStep('idle');
    setError(runRecord.message || payload?.message || t.dualAi.qualityGateFailed);
    return true;
  }, [applyRunPayload, cleanupGuidedSessionState, closeDialogAfter, onContentGenerated, onGenerationFailed, t.dualAi.qualityGateFailed]);

  // ÄNDERUNG 02.03.2026: Mit useCallback memoisiert für korrekte Dependencies
  // ÄNDERUNG 02.03.2026: AbortController-Support für Cleanup hinzugefügt
  // MUSS vor dem useEffect definiert werden, das es verwendet
  // ÄNDERUNG 02.03.2026: abortSignal Parameter entfernt - wird nicht verwendet
  const handleGuidedFinalization = useCallback(async (sessionId: string) => {
    setIsGenerating(true);
    setCurrentStep('guided-finalizing');
    setProgressDetail(t.dualAi.guidedStartingFinalization);
    setError('');
    setTotalTokensSoFar(0);

    startElapsedTimer();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/ai/guided-finalize-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          sessionId,
          prdId
        }),
        credentials: 'include',
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: any = null;
        try {
          errorData = JSON.parse(errorText);
        } catch {}
        if (errorData && isFailedAiRun(errorData)) {
          handleFailedRunPayload(errorData, 1500);
          return;
        }
        throw new Error(errorData?.message || t.errors.generateFailed);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream') && response.body) {
        // ÄNDERUNG 02.03.2026: SSE Event-Handler bereinigt
        // Nur Events behalten die vom Server tatsächlich gesendet werden
        const data = await readSSEStream(response.body, (event) => {
          switch (event.type) {
            case 'generation_start':
              setProgressDetail(t.dualAi.guidedGenerationStarted);
              break;
            case 'complete':
              setTotalTokensSoFar(event.totalTokens || 0);
              applyResolvedModels({
                modelsUsed: event.modelsUsed,
                compilerDiagnostics: event.compilerDiagnostics,
                diagnostics: event.diagnostics,
              });
              break;
          }
        }, t.errors.generateFailed);

        if (!data) throw new Error('SSE stream ended without result');
        if (isFailedAiRun(data)) {
          handleFailedRunPayload(data, 1500);
          return;
        }
        finalizeRun(data, 2000);

        cleanupGuidedSessionState();
      } else {
        // Fallback: klassische JSON-Antwort
        const data = await response.json();
        if (isFailedAiRun(data)) {
          handleFailedRunPayload(data, 1500);
          return;
        }
        finalizeRun(data, 2000);

        cleanupGuidedSessionState();
      }
    } catch (err: any) {
      if ((err instanceof SsePayloadError || err?.payload) && isFailedAiRun(err.payload)) {
        handleFailedRunPayload(err.payload, 1500);
        return;
      }
      console.error('Guided finalization error:', err);
      if (err?.name === 'AbortError') {
        setError(t.dualAi.timeoutError);
      } else {
        setError(err.message || t.errors.generateFailed);
      }
      // ÄNDERUNG 02.03.2026: Session aus localStorage entfernen bei Fehler um Endlosschleife zu verhindern
      cleanupGuidedSessionState();
      setCurrentStep('idle');
      setIsGenerating(false);
    } finally {
      abortControllerRef.current = null;
      stopElapsedTimer();
    }
    // Dependencies für useCallback - alle verwendeten States und Props
  }, [t, prdId, onContentGenerated, onOpenChange, startElapsedTimer, stopElapsedTimer, resetState, handleFailedRunPayload, finalizeRun, cleanupGuidedSessionState]);

  // ÄNDERUNG 02.03.2026: Lade Guided Session aus localStorage beim Öffnen
  // ÄNDERUNG 02.03.2026: Race Condition behoben - setTimeout mit Closure entfernt
  useEffect(() => {
    if (!open) {
      setSessionRestoreChecked(false);
      return;
    }
     
    const restoreSession = () => {
      setSessionRestoreChecked(false);
      try {
        const stored = localStorage.getItem('nexora_guided_session_v2');
        if (!stored) return;
        
        try {
          const session = JSON.parse(stored);
          // Prüfe ob Session bereit für Finalisierung ist und nicht abgelaufen
          const SESSION_MAX_AGE_MS = 30 * 60 * 1000; // 30 Minuten
          const isExpired = session.timestamp && (Date.now() - session.timestamp > SESSION_MAX_AGE_MS);
          
          if (session.sessionId && session.step === 'finalizing' && !isExpired) {
            setGuidedSessionId(session.sessionId);
            setGuidedSessionInfo({
              projectIdea: session.projectIdea || '',
              answersCount: Object.keys(session.answers || {}).length
            });
            // Automatisch in Guided-Finalisierung wechseln
            setWorkflowMode('guided');
            // Die eigentliche Finalisierung wird durch den useEffect unten ausgeführt
            // sobald die States aktualisiert wurden
          } else if (isExpired) {
            // Abgelaufene Session bereinigen
            localStorage.removeItem('nexora_guided_session_v2');
          }
        } catch (err) {
          console.warn('Failed to parse guided session:', err);
          // Corrupted Daten bereinigen
          localStorage.removeItem('nexora_guided_session_v2');
        }
      } catch (err) {
        console.warn('localStorage access failed:', err);
      } finally {
        setSessionRestoreChecked(true);
      }
    };
     
    restoreSession();
  }, [open]);

  // ÄNDERUNG 02.03.2026: Automatische Finalisierung nach Session-Restore
  // Dieser Effect läuft NACHDEM die States (guidedSessionId, workflowMode) aktualisiert wurden
  // ÄNDERUNG 02.03.2026: Verhindert Race Condition durch setTimeout - nutzt useEffect stattdessen
  // ÄNDERUNG 02.03.2026: isFinalizing State verhindert Doppelausführung
  useEffect(() => {
    if (!open || !guidedSessionId || workflowMode !== 'guided') return;
    if (currentStep !== 'idle' || isFinalizing) return; // Bereits am Laufen
    
    // Prüfe ob wir aus einem Restore kommen (Session ist in localStorage mit step 'finalizing')
    const stored = localStorage.getItem('nexora_guided_session_v2');
    if (!stored) return;
    
    try {
      const session = JSON.parse(stored);
      if (session.step === 'finalizing' && session.sessionId === guidedSessionId) {
        // Markiere Session als "wird verarbeitet" um Doppelausführung zu verhindern
        localStorage.setItem('nexora_guided_session_v2', JSON.stringify({
          ...session,
          step: 'finalizing_in_progress'
        }));
        
        // ÄNDERUNG 02.03.2026: isFinalizing State setzen um Race Condition zu verhindern
        setIsFinalizing(true);
        
        handleGuidedFinalization(guidedSessionId).catch((err) => {
          if (err?.name === 'AbortError') return;
          console.error('Auto-finalization after restore failed:', err);
          setError(t.errors.generateFailed || 'Finalisierung fehlgeschlagen');
          setIsGenerating(false);
          setCurrentStep('idle');
        }).finally(() => {
          setIsFinalizing(false);
        });
      }
    } catch (err) {
      console.warn('Failed to check session state:', err);
    }
    // ÄNDERUNG 02.03.2026: isFinalizing zu Dependencies hinzugefügt
  }, [open, guidedSessionId, workflowMode, currentStep, isFinalizing, handleGuidedFinalization, t.errors.generateFailed]);

  const loadUserSettings = useCallback(async () => {
    if (!sessionRestoreChecked) return;
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

    try {
      const response = await fetch('/api/settings/ai');
      if (response.ok) {
        const settings = await response.json();
        if (settings.iterativeMode !== undefined) {
          setWorkflowMode(settings.iterativeMode ? 'iterative' : 'simple');
        }
        if (typeof settings.iterationCount === 'number') {
          setIterationCount(clamp(settings.iterationCount, iterationCountMin, iterationCountMax));
        }
        if (typeof settings.iterativeTimeoutMinutes === 'number') {
          setIterativeTimeoutMinutes(clamp(settings.iterativeTimeoutMinutes, iterativeTimeoutMinutesMin, iterativeTimeoutMinutesMax));
        }
        if (settings.useFinalReview !== undefined) {
          setUseFinalReview(settings.useFinalReview);
        }
        // Pre-load model names so they appear in the status display immediately
        if (settings.generatorModel) setGeneratorModel(settings.generatorModel);
        if (settings.reviewerModel) setReviewerModel(settings.reviewerModel);
        if (settings.verifierModel) setVerifierModel(settings.verifierModel);
        if (settings.semanticRepairModel) setSemanticRepairModel(settings.semanticRepairModel);
        // After settings are loaded, run health check in background
        setHealthChecking(true);
        fetch('/api/settings/ai/health', { credentials: 'include' })
          .then(res => res.json())
          .then(data => setHealthStatus(data))
          .catch((err) => setHealthStatus({ healthy: false, model: '', error: err?.message || 'Health check failed' }))
          .finally(() => setHealthChecking(false));
      }
    } catch (err) {
      console.error('Failed to load AI settings:', err);
    }
  }, [iterationCountMax, iterationCountMin, iterativeTimeoutMinutesMax, iterativeTimeoutMinutesMin, sessionRestoreChecked]);

  // KI-Benutzereinstellungen laden, um den Standard-Workflow-Modus zu setzen
  // ÄNDERUNG 02.03.2026: Prüfe auf aktive Guided-Session VOR dem Settings-Load
  useEffect(() => {
    if (!open || !sessionRestoreChecked) return;
    // Wenn eine Guided-Session wiederhergestellt wurde, überspringe Settings-Load
    // für den workflowMode, damit 'guided' erhalten bleibt
    if (!guidedSessionId) {
      loadUserSettings();
    }
  }, [open, guidedSessionId, loadUserSettings, sessionRestoreChecked]);

  const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number): Promise<Response> => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  const handleGenerate = async () => {
    if (!userInput.trim() && !hasRealContent) {
      setError(t.dualAi.inputError);
      return;
    }

    setIsGenerating(true);
    setError('');
    setCurrentStep('generating');

    try {
      if (workflowMode === 'simple') {
        await handleSimpleGeneration();
      } else {
        await handleIterativeGeneration();
      }
    } catch (err: any) {
      console.error('AI generation error:', err);
      if (err?.name === 'AbortError') {
        setError(t.dualAi.timeoutError);
      } else {
        setError(err.message || t.errors.generateFailed);
      }
      setCurrentStep('idle');
      setCurrentIteration(0);
      setTotalIterations(0);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSimpleGeneration = async () => {
    startElapsedTimer();
    const releaseAbortController = () => {
      abortControllerRef.current = null;
    };

    try {
      const response = await fetchWithTimeout('/api/ai/generate-dual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userInput: userInput.trim(),
          existingContent: hasRealContent ? currentContent : undefined,
          mode: hasRealContent ? 'improve' : 'generate',
          prdId
        }),
        credentials: 'include',
      }, simpleTimeoutMinutes * 60 * 1000);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        releaseAbortController();

        // Quality-Gate-Fehler mit brauchbarem Content: Nutze den Content mit Warnung
        if (
          isFailedAiRun(errorData)
          || (response.status === 422 && (!!errorData?.finalContent?.trim() || !!errorData?.compilerDiagnostics))
          || (response.status === 500 && (!!errorData?.finalContent?.trim() || !!errorData?.compilerDiagnostics))
        ) {
          console.warn('AI generation passed with quality warnings:', errorData.message);
          handleFailedRunPayload(errorData, 1500);
          return;
        }

        throw new Error(errorData.message || t.errors.generateFailed);
      }

      const data = await response.json();
      releaseAbortController();
      if (isFailedAiRun(data)) {
        handleFailedRunPayload(data, 1500);
        return;
      }
      finalizeRun(data, 1500);
    } catch (error) {
      releaseAbortController();
      throw error;
    } finally {
      stopElapsedTimer();
    }
  };

  const handleIterativeGeneration = async () => {
    setTotalIterations(iterationCount);
    setCurrentIteration(0);
    setTotalTokensSoFar(0);
    setProgressDetail(t.dualAi.startingIterative);
    setCurrentStep('iterating');

    startElapsedTimer();

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const adaptiveTimeoutMinutes = Math.max(
      iterativeTimeoutMinutes,
      (iterationCount * 15) + 10 + (useFinalReview ? 10 : 0)
    );
    const inactivityTimeoutMs = adaptiveTimeoutMinutes * 60 * 1000;
    let inactivityTimeout: ReturnType<typeof setTimeout> | null = null;
    const resetInactivityTimeout = () => {
      if (inactivityTimeout) clearTimeout(inactivityTimeout);
      inactivityTimeout = setTimeout(() => controller.abort(), inactivityTimeoutMs);
    };
    resetInactivityTimeout();

    try {
      const response = await fetch('/api/ai/generate-iterative', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          existingContent: hasRealContent ? currentContent : undefined,
          additionalRequirements: userInput.trim() || undefined,
          mode: hasRealContent ? 'improve' : 'generate',
          iterationCount,
          useFinalReview,
          prdId
        }),
        credentials: 'include',
        signal: controller.signal,
      });
      resetInactivityTimeout();

      if (!response.ok) {
        if (inactivityTimeout) {
          clearTimeout(inactivityTimeout);
          inactivityTimeout = null;
        }
        const errorText = await response.text();
        let errorData: any = null;
        try {
          errorData = JSON.parse(errorText);
        } catch {}
        if (errorData && isFailedAiRun(errorData)) {
          handleFailedRunPayload(errorData, 1500);
          return;
        }
        throw new Error(errorData?.message || t.errors.generateFailed);
      }

      // Prüfen, ob der Server mit SSE geantwortet hat
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream') && response.body) {
        // SSE-Ereignisse als Stream verarbeiten
        const data = await readSSEStream(response.body, (event) => {
          resetInactivityTimeout();
          switch (event.type) {
            case 'iteration_start':
              setCurrentIteration(event.iteration);
              setProgressDetail(t.dualAi.iterationGenerating.replace('{current}', event.iteration).replace('{total}', event.total));
              break;
            case 'generator_done':
              setProgressDetail(t.dualAi.iterationReviewing.replace('{current}', event.iteration));
              setTotalTokensSoFar(prev => prev + (event.tokensUsed || 0));
              if (event.model) setGeneratorModel(event.model);
              break;
            case 'features_expanded':
              setProgressDetail(t.dualAi.featuresExpanded.replace('{count}', event.count));
              setTotalTokensSoFar(prev => prev + (event.tokensUsed || 0));
              break;
            case 'answerer_done':
              setProgressDetail(t.dualAi.iterationReviewerDone.replace('{current}', event.iteration));
              setTotalTokensSoFar(prev => prev + (event.tokensUsed || 0));
              if (event.model) setReviewerModel(event.model);
              break;
            case 'iteration_complete':
              setProgressDetail(t.dualAi.iterationComplete.replace('{current}', event.iteration).replace('{total}', event.total));
              break;
            case 'final_review_start':
              setProgressDetail(t.dualAi.finalReviewInProgress);
              break;
            case 'final_review_done':
              setProgressDetail(t.dualAi.finalReviewComplete);
              setTotalTokensSoFar(prev => prev + (event.tokensUsed || 0));
              break;
            case 'compiler_finalization_start':
              setProgressDetail(t.dualAi.compilerFinalizationStarting);
              break;
            case 'content_review_start':
              setProgressDetail(t.dualAi.contentReviewInProgress);
              break;
            case 'semantic_repair_start':
              setProgressDetail(t.dualAi.semanticRepairInProgress);
              break;
            case 'semantic_repair_done':
              setProgressDetail(
                event.applied
                  ? t.dualAi.semanticRepairComplete
                  : t.dualAi.semanticRepairNoChange
              );
              break;
            case 'semantic_verification_start':
              setProgressDetail(t.dualAi.semanticVerificationInProgress);
              break;
            case 'final_persist_start':
              setProgressDetail(t.dualAi.finalPersistInProgress);
              break;
            case 'complete':
              setTotalTokensSoFar(event.totalTokens || 0);
              break;
          }
        }, t.errors.generateFailed);

        if (!data) throw new Error('SSE stream ended without result');
        if (isFailedAiRun(data)) {
          handleFailedRunPayload(data, 1500);
          return;
        }
        finalizeRun(data, 2000);
      } else {
        // Fallback: klassische JSON-Antwort (kein SSE)
        const data = await response.json();
        if (isFailedAiRun(data)) {
          handleFailedRunPayload(data, 1500);
          return;
        }
        finalizeRun(data, 2000);
      }
    } catch (err: any) {
      if ((err instanceof SsePayloadError || err?.payload) && isFailedAiRun(err.payload)) {
        handleFailedRunPayload(err.payload, 1500);
        return;
      }
      throw err;
    } finally {
      if (inactivityTimeout) {
        clearTimeout(inactivityTimeout);
        inactivityTimeout = null;
      }
      abortControllerRef.current = null;
      stopElapsedTimer();
    }
  };


  // ÄNDERUNG 02.03.2026: Handler für Guided Finalisierung
  const handleGuidedReadyForFinalization = (sessionId: string, projectIdea: string, answersCount: number) => {
    setGuidedSessionId(sessionId);
    setGuidedSessionInfo({ projectIdea, answersCount });
    setWorkflowMode('guided');
    setShowGuidedDialog(false);
    // Starte sofort die Finalisierung
    // Die Finalisierung wird durch den useEffect unten ausgeführt
  };

  const getStepIcon = () => {
    switch (currentStep) {
      case 'generating':
        return <Brain className="w-5 h-5 animate-pulse text-primary" />;
      case 'reviewing':
        return <Sparkles className="w-5 h-5 animate-pulse text-amber-500" />;
      case 'improving':
        return <Brain className="w-5 h-5 animate-pulse text-blue-500" />;
      case 'iterating':
        return <Repeat className="w-5 h-5 animate-spin text-purple-500" />;
      // ÄNDERUNG 02.03.2026: Icon für Guided Finalisierung - FileText statt MessageSquare für bessere Unterscheidung
      case 'guided-finalizing':
        return <FileText className="w-5 h-5 animate-pulse text-indigo-500" />;
      case 'done':
        return runQualityStatus && runQualityStatus !== 'passed'
          ? <AlertCircle className="w-5 h-5 text-amber-500" />
          : <CheckCircle2 className="w-5 h-5 text-green-500" />;
      default:
        return <Sparkles className="w-5 h-5" />;
    }
  };

  const getStepText = () => {
    switch (currentStep) {
      case 'generating':
        return t.dualAi.generating;
      case 'reviewing':
        return t.dualAi.reviewing;
      case 'improving':
        return t.dualAi.improving;
      case 'iterating':
        return progressDetail || `${t.dualAi.iterating}: ${currentIteration}/${totalIterations}`;
      // ÄNDERUNG 02.03.2026: Text für Guided Finalisierung
      case 'guided-finalizing':
        return t.dualAi.guidedFinalizing;
      case 'done':
        return runQualityStatus && runQualityStatus !== 'passed' ? t.dualAi.doneWithWarnings : t.dualAi.done;
      default:
        return t.dualAi.ready;
    }
  };

  const getModeInfoText = () => {
    if (!modeInfo?.effectiveMode || currentStep !== 'done') {
      return null;
    }

    const baseText = modeInfo.effectiveMode === 'improve'
      ? t.dualAi.improvedWithBaseline.replace('{count}', String(modeInfo.baselineFeatureCount ?? 0))
      : t.dualAi.generatedNew;

    return modeInfo.baselinePartial
      ? `${baseText} — ${t.dualAi.existingContentUsedAsContext}`
      : baseText;
  };

  // ÄNDERUNG 08.03.2026: Modusinfo nur einmal berechnen, um Doppelaufrufe im JSX zu vermeiden.
  const modeInfoText = getModeInfoText();

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          handleClose();
          return;
        }
        onOpenChange(true);
      }}
    >
      <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto" data-testid="dialog-dual-ai">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            {t.dualAi.title}
          </DialogTitle>
          <DialogDescription>
            {t.dualAi.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Auswahl des Workflow-Modus */}
          <div className="space-y-3">
            <Label className="text-base font-medium">{t.dualAi.workflowMode}</Label>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant={workflowMode === 'simple' ? 'default' : 'outline'}
                className="flex flex-col h-auto py-3"
                onClick={() => setWorkflowMode('simple')}
                disabled={isGenerating}
                data-testid="button-mode-simple"
              >
                <Sparkles className="w-4 h-4 mb-1" />
                <span className="text-xs">{t.dualAi.simple}</span>
              </Button>
              <Button
                variant={workflowMode === 'iterative' ? 'default' : 'outline'}
                className="flex flex-col h-auto py-3"
                onClick={() => setWorkflowMode('iterative')}
                disabled={isGenerating}
                data-testid="button-mode-iterative"
              >
                <Zap className="w-4 h-4 mb-1" />
                <span className="text-xs">{t.dualAi.iterative}</span>
              </Button>
              <Button
                variant={workflowMode === 'guided' ? 'default' : 'outline'}
                className="flex flex-col h-auto py-3"
                onClick={() => setWorkflowMode('guided')}
                disabled={isGenerating}
                data-testid="button-mode-guided"
              >
                <MessageSquare className="w-4 h-4 mb-1" />
                <span className="text-xs">{t.dualAi.guided}</span>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {workflowMode === 'simple' && t.dualAi.simpleDesc}
              {workflowMode === 'iterative' && t.dualAi.iterativeDesc.replace('{count}', String(iterationCount))}
              {workflowMode === 'guided' && t.dualAi.guidedDesc}
            </p>
          </div>

          {/* Einstellungen für den Iterationsmodus */}
          {workflowMode === 'iterative' && (
            <div className="space-y-4 p-4 rounded-lg border bg-muted/50">
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  {t.dualAi.iterationCount}: {iterationCount}
                </Label>
                <Slider
                  value={[iterationCount]}
                  onValueChange={([value]) => setIterationCount(value)}
                  min={iterationCountMin}
                  max={iterationCountMax}
                  step={1}
                  disabled={isGenerating}
                  className="py-2"
                  data-testid="slider-iteration-count"
                />
                <p className="text-xs text-muted-foreground">
                  {t.dualAi.iterationHint}
                </p>
              </div>

              <Separator />

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="final-review"
                  checked={useFinalReview}
                  onCheckedChange={(checked) => setUseFinalReview(checked === true)}
                  disabled={isGenerating}
                  data-testid="checkbox-final-review"
                />
                <div className="grid gap-1.5 leading-none">
                  <label
                    htmlFor="final-review"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {t.dualAi.finalReview}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {t.dualAi.finalReviewHint}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Statusanzeige */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 p-3 rounded-md bg-muted">
              {getStepIcon()}
              <span className="text-sm font-medium">{getStepText()}</span>
              {/* ÄNDERUNG 02.03.2026: Badge für Guided-Modus */}
              {workflowMode === 'guided' && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  {t.dualAi.guided}
                </Badge>
              )}
              {currentStep !== 'idle' && currentStep !== 'done' && (
                <div className="ml-auto flex gap-2">
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" />
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0.2s' }} />
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0.4s' }} />
                </div>
              )}
            </div>
            {/* Modellinformationen — direkt unter der Statusleiste */}
            {(generatorModel || reviewerModel || verifierModel) && (
              <div className="flex gap-2 flex-wrap px-1">
                {generatorModel && (
                  <Badge variant="outline" className="text-xs">
                    {t.dualAi.generator}: {getShortModelName(generatorModel)}
                  </Badge>
                )}
                {reviewerModel && (
                  <Badge variant="outline" className="text-xs">
                    {t.dualAi.reviewer}: {getShortModelName(reviewerModel)}
                  </Badge>
                )}
                {verifierModel && (
                  <Badge variant="outline" className="text-xs">
                    {t.dualAi.verifier}: {getShortModelName(verifierModel)}
                  </Badge>
                )}
                {semanticRepairModel && (
                  <Badge variant="outline" className="text-xs">
                    {t.dualAi.semanticRepair}: {getShortModelName(semanticRepairModel)}
                  </Badge>
                )}
              </div>
            )}
            {/* Fix 0.2: Mode transparency info line */}
            {modeInfoText && (
              <p className="text-xs text-muted-foreground mt-1 px-1">
                {modeInfoText}
              </p>
            )}
            {/* Live-Statistiken für den Simple Run, Iterationsmodus und Guided Finalisierung */}
            {(currentStep === 'generating' || currentStep === 'iterating' || currentStep === 'guided-finalizing') && (
              <div className="flex items-center gap-4 px-3 text-xs text-muted-foreground">
                {elapsedSeconds > 0 && (
                  <span>{formatElapsedTime(elapsedSeconds)} {t.dualAi.elapsed}</span>
                )}
                {totalTokensSoFar > 0 && (
                  <span>{totalTokensSoFar.toLocaleString()} {t.dualAi.tokens}</span>
                )}
                {currentIteration > 0 && totalIterations > 0 && (
                  <div className="flex-1">
                    <div className="h-1.5 bg-muted-foreground/20 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, (currentIteration / totalIterations) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Benutzereingabe */}
          <div className="space-y-2">
            <Label htmlFor="ai-input">
              {hasRealContent ? t.dualAi.improvementLabel : t.dualAi.descriptionLabel}
            </Label>
            <Textarea
              id="ai-input"
              placeholder={hasRealContent
                ? t.dualAi.improvePlaceholder
                : t.dualAi.generatePlaceholder
              }
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              rows={6}
              disabled={isGenerating}
              data-testid="textarea-dual-ai-input"
            />
          </div>

          {/* Health check warning */}
          {healthChecking && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-muted text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent shrink-0" />
              <p className="text-sm">{t.dualAi.healthChecking}</p>
            </div>
          )}
          {healthStatus && !healthStatus.healthy && !healthChecking && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium">{t.dualAi.modelNotAvailable}</p>
                <p className="mt-1">{healthStatus.error || t.dualAi.modelHealthError}</p>
              </div>
            </div>
          )}

          {/* Fehleranzeige */}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <p className="text-sm">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            data-testid="button-dual-ai-cancel"
          >
            {t.common.cancel}
          </Button>
          {workflowMode === 'guided' ? (
            <Button 
              onClick={() => {
                setShowGuidedDialog(true);
              }}
              disabled={!userInput.trim()}
              data-testid="button-dual-ai-guided"
            >
              <MessageSquare className="w-4 h-4 mr-2" />
              {t.dualAi.startGuided}
            </Button>
          ) : (
            <Button 
              onClick={handleGenerate}
              disabled={isGenerating || (!userInput.trim() && !hasRealContent)}
              data-testid="button-dual-ai-generate"
            >
              {isGenerating ? (
                <>
                  <Brain className="w-4 h-4 mr-2 animate-pulse" />
                  {t.dualAi.generatingBtn}
                </>
              ) : (
                <>
                  {workflowMode === 'iterative' ? (
                    <Repeat className="w-4 h-4 mr-2" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-2" />
                  )}
                  {workflowMode === 'iterative'
                    ? t.dualAi.generateIterative.replace('{count}', String(iterationCount))
                    : (hasRealContent ? t.dualAi.improveBtn : t.dualAi.generateBtn)
                  }
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      {/* Geführter KI-Dialog - wird geöffnet, wenn der geführte Modus ausgewählt ist */}
      {/* ÄNDERUNG 02.03.2026: onReadyForFinalization Callback hinzugefügt */}
      <GuidedAiDialog
        open={showGuidedDialog}
        onOpenChange={(isOpen) => {
          setShowGuidedDialog(isOpen);
          if (!isOpen) {
            // ÄNDERUNG 02.03.2026: Nur zurücksetzen wenn keine Session läuft
            if (!guidedSessionId) {
              handleClose();
            }
          }
        }}
        onContentGenerated={(content, response) => {
          onContentGenerated(content, response);
          setShowGuidedDialog(false);
          handleClose();
        }}
        onReadyForFinalization={handleGuidedReadyForFinalization}
        initialProjectIdea={userInput}
        existingContent={hasRealContent ? currentContent : undefined}
        prdId={prdId}
      />
    </Dialog>
  );
}
