import { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Sparkles, Brain, CheckCircle2, AlertCircle, ArrowRight, Zap, MessageSquare, SkipForward, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTranslation } from "@/lib/i18n";
import { formatElapsedTime } from "@/lib/utils";
import { useElapsedTimer } from "@/hooks/useElapsedTimer";
import { QuestionCard } from './QuestionCard';

interface GuidedQuestion {
  id: string;
  question: string;
  context: string;
  selectionMode?: 'single' | 'multiple';
  options: {
    id: string;
    label: string;
    description: string;
  }[];
}

interface GuidedAiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContentGenerated: (content: string, response: any) => void;
  initialProjectIdea?: string;
  existingContent?: string;
  prdId?: string;
  // ÄNDERUNG 02.03.2025: Callback für Übergabe an DualAiDialog nach letzter Frage
  onReadyForFinalization?: (sessionId: string, projectIdea: string, answersCount: number) => void;
}

type Step = 'input' | 'resuming' | 'analyzing' | 'questions' | 'processing' | 'finalizing' | 'done';

interface AnswerState {
  [questionId: string]: {
    selectedOptionIds: string[];
    customText?: string;
  };
}

const GUIDED_SESSION_STORAGE_KEY = 'nexora_guided_session_v2';
const GUIDED_SESSION_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

interface GuidedSessionStorageState {
  sessionId: string;
  timestamp: number;
  step: Step;
  roundNumber: number;
  currentQuestionIndex: number;
  questions: GuidedQuestion[];
  answers: AnswerState;
  featureOverview: string;
  projectIdea: string;
  error?: string;
}

function saveSessionToStorage(state: GuidedSessionStorageState) {
  try {
    localStorage.setItem(GUIDED_SESSION_STORAGE_KEY, JSON.stringify(state));
  } catch { /* localStorage unavailable */ }
}

function loadSessionFromStorage(): GuidedSessionStorageState | null {
  try {
    const raw = localStorage.getItem(GUIDED_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as GuidedSessionStorageState;
    if (Date.now() - state.timestamp > GUIDED_SESSION_MAX_AGE_MS) {
      localStorage.removeItem(GUIDED_SESSION_STORAGE_KEY);
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

function clearSessionFromStorage() {
  try { localStorage.removeItem(GUIDED_SESSION_STORAGE_KEY); } catch { /* noop */ }
}

export function GuidedAiDialog({
  open,
  onOpenChange,
  onContentGenerated,
  initialProjectIdea = '',
  existingContent,
  prdId,
  // ÄNDERUNG 02.03.2025: Callback für Übergabe an DualAiDialog nach letzter Frage
  onReadyForFinalization,
}: GuidedAiDialogProps) {
  const { t } = useTranslation();
  const [projectIdea, setProjectIdea] = useState(initialProjectIdea);
  const [step, setStep] = useState<Step>('input');
  const abortControllerRef = useRef<AbortController | null>(null);
  const [hasAutoStarted, setHasAutoStarted] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [featureOverview, setFeatureOverview] = useState('');
  const [questions, setQuestions] = useState<GuidedQuestion[]>([]);
  const [answers, setAnswers] = useState<AnswerState>({});
  const [roundNumber, setRoundNumber] = useState(1);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [error, setError] = useState('');
  const [refinedPlan, setRefinedPlan] = useState('');
  const [modelsUsed, setModelsUsed] = useState<string[]>([]);
  const [resumableState, setResumableState] = useState<GuidedSessionStorageState | null>(null);
  const { elapsedSeconds, startTimer: startElapsedTimer, stopTimer: stopElapsedTimer, resetTimer: resetElapsedTimer } = useElapsedTimer();
  const hasExistingContent = typeof existingContent === 'string' && existingContent.trim().length > 0;
  const minimumIdeaLength = hasExistingContent ? 3 : 10;
  const effectiveProjectIdea = (projectIdea.trim().length > 0 ? projectIdea : initialProjectIdea).trim();
  const minLengthError = hasExistingContent
    ? t.guidedAi.minLengthErrorExistingContent
    : t.guidedAi.minLengthError;

  const createAbortSignal = (): AbortSignal => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    return controller.signal;
  };

  const resetState = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setProjectIdea('');
    setStep('input');
    setSessionId(null);
    setFeatureOverview('');
    setQuestions([]);
    setAnswers({});
    setRoundNumber(1);
    setCurrentQuestionIndex(0);
    setError('');
    setRefinedPlan('');
    setModelsUsed([]);
    setHasAutoStarted(false);
    setResumableState(null);
    resetElapsedTimer();
    clearSessionFromStorage();
  };

  const executeStart = async (idea: string) => {
    setStep('analyzing');
    setError('');

    // Timer für die verstrichene Zeit starten
    startElapsedTimer();

    try {
      const signal = createAbortSignal();
      const response = await fetch('/api/ai/guided-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectIdea: idea.trim(),
          existingContent: hasExistingContent ? existingContent : undefined,
          mode: hasExistingContent ? 'improve' : 'generate',
          prdId,
        }),
        signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to start guided workflow');
      }

      const data = await response.json();
      setSessionId(data.sessionId);
      setFeatureOverview(data.featureOverview);
      setQuestions(data.questions || []);
      setCurrentQuestionIndex(0);
      
      // Save initial session state
      saveSessionToStorage({
        sessionId: data.sessionId,
        timestamp: Date.now(),
        step: 'questions',
        roundNumber: 1,
        currentQuestionIndex: 0,
        questions: data.questions || [],
        answers: {},
        featureOverview: data.featureOverview,
        projectIdea: idea.trim()
      });

      if (data.questions && data.questions.length > 0) {
        setStep('questions');
      } else {
        await handleFinalize(data.sessionId);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error starting guided workflow:', err);
      setError(err.message || 'Failed to analyze project idea');
      setStep('input');
      // Timer nur bei Fehler stoppen - läuft sonst bis Workflow-Ende
      stopElapsedTimer();
    }
    // Timer läuft weiter für processing/finalizing steps
  };

  const handleStartWithIdea = useCallback(async (idea: string) => {
    if (idea.trim().length < minimumIdeaLength) {
      setError(minLengthError);
      return;
    }
    await executeStart(idea);
  }, [minimumIdeaLength, minLengthError, hasExistingContent, existingContent]);

  // Check for resumable session when dialog opens
  useEffect(() => {
    if (open && step === 'input' && !hasAutoStarted) {
      const storedState = loadSessionFromStorage();
      if (storedState) {
        setResumableState(storedState);
        setStep('resuming');
        return;
      }
    }
    if (!open) {
      setResumableState(null);
    }
  }, [open]);

  const handleResumeSession = () => {
    if (!resumableState) return;
    setError('');
    
    // Restore UI state from storage
    setSessionId(resumableState.sessionId);
    setStep(resumableState.step);
    setRoundNumber(resumableState.roundNumber);
    setCurrentQuestionIndex(resumableState.currentQuestionIndex);
    setQuestions(resumableState.questions);
    setAnswers(resumableState.answers);
    setFeatureOverview(resumableState.featureOverview);
    setProjectIdea(resumableState.projectIdea);
    if (resumableState.error) setError(resumableState.error);
    
    setResumableState(null);
  };

  const handleDismissResume = () => {
    clearSessionFromStorage();
    setResumableState(null);
    setStep('input');
  };

  // ÄNDERUNG 02.03.2025: Debounce für saveSessionToStorage implementiert (Issue 5)
  // Verhindert excessive writes bei rapid input durch 300ms Debounce
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    if (sessionId && step !== 'input' && step !== 'done' && step !== 'resuming') {
      // Clear vorherigen Timer
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      
      // Neuer Debounced Save
      saveTimeoutRef.current = setTimeout(() => {
        saveSessionToStorage({
          sessionId,
          timestamp: Date.now(),
          step,
          roundNumber,
          currentQuestionIndex,
          questions,
          answers,
          featureOverview,
          projectIdea: effectiveProjectIdea,
          error: error || undefined
        });
      }, 300);
    }
    
    // Cleanup: Timer löschen bei unmount oder erneutem Effect-Run
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [sessionId, step, roundNumber, currentQuestionIndex, questions, answers, featureOverview, effectiveProjectIdea, error]);

  // Sync project idea and auto-start when dialog opens with initial value
  useEffect(() => {
    if (open && initialProjectIdea && initialProjectIdea.trim().length >= minimumIdeaLength) {
      setProjectIdea(initialProjectIdea);
      // Auto-start if we have a valid initial idea and haven't started yet
      if (!hasAutoStarted && step === 'input') {
        setHasAutoStarted(true);
        handleStartWithIdea(initialProjectIdea);
      }
    }
    if (!open) {
      setHasAutoStarted(false);
    }
  }, [open, initialProjectIdea, hasAutoStarted, step, minimumIdeaLength, handleStartWithIdea]);

  const handleStart = async () => {
    if (effectiveProjectIdea.length < minimumIdeaLength) {
      setError(minLengthError);
      return;
    }
    await executeStart(effectiveProjectIdea);
  };

  const handleSkipQuestions = async () => {
    if (!sessionId) {
      setError('Session not found');
      return;
    }

    setStep('finalizing');
    await handleFinalize(sessionId);
  };

  const handleSubmitAnswers = async () => {
    if (!sessionId) {
      setError('Session not found');
      return;
    }

    // ÄNDERUNG 02.03.2025: Gruppierte Datenstruktur für Mehrfachauswahl
    // Statt flache Liste mit einem Eintrag pro Option wird jetzt
    // ein Eintrag pro Frage mit allen selectedOptionIds gesendet
    // ÄNDERUNG 02.03.2025: Custom-Text wird bereinigt wenn 'custom' nicht ausgewählt ist
    const answersArray = Object.entries(answers).map(([questionId, answer]) => ({
      questionId,
      selectedOptionIds: answer.selectedOptionIds,
      // Nur customText senden wenn 'custom' tatsächlich ausgewählt ist UND Text vorhanden
      customText: answer.selectedOptionIds.includes('custom') && answer.customText?.trim()
        ? answer.customText.trim()
        : undefined,
    }));

    if (answersArray.length === 0) {
      setError(t.guidedAi.answerOneQuestion);
      return;
    }

    // Validate that custom text is provided when "Other" is selected
    // ÄNDERUNG 02.03.2025: Angepasst für neue Datenstruktur mit selectedOptionIds Array
    for (const answer of answersArray) {
      if (answer.selectedOptionIds.includes('custom') && (!answer.customText || answer.customText.trim().length === 0)) {
        setError(t.guidedAi.customAnswerRequired);
        return;
      }
    }

    setStep('processing');
    setError('');

    try {
      const signal = createAbortSignal();
      const response = await fetch('/api/ai/guided-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, answers: answersArray, questions }),
        signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to process answers');
      }

      const data = await response.json();
      setRefinedPlan(data.refinedPlan);
      setRoundNumber(data.roundNumber);

      if (data.isComplete || !data.followUpQuestions || data.followUpQuestions.length === 0) {
        await handleFinalize(sessionId);
      } else {
        setQuestions(data.followUpQuestions);
        setAnswers({});
        setCurrentQuestionIndex(0);
        setStep('questions');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error processing answers:', err);
      setError(err.message || 'Failed to process answers');
      setStep('questions');
    }
  };

  const handleFinalize = async (sid: string) => {
    // ÄNDERUNG 02.03.2025: Wenn onReadyForFinalization existiert, übergib an Parent
    if (onReadyForFinalization) {
      // Speichere Session-Status für Wiederherstellung
      saveSessionToStorage({
        sessionId: sid,
        timestamp: Date.now(),
        step: 'finalizing',
        roundNumber,
        currentQuestionIndex,
        questions,
        answers,
        featureOverview,
        projectIdea: effectiveProjectIdea,
        error: error || undefined
      });
      // Callback an Parent (DualAiDialog) - übergibt auch die Anzahl der Antworten
      const answersCount = Object.keys(answers).length;
      onReadyForFinalization(sid, effectiveProjectIdea, answersCount);
      // Schliesse diesen Dialog
      onOpenChange(false);
      return;
    }

    // Fallback: Legacy-Verhalten - direkte Finalisierung
    setStep('finalizing');

    try {
      const signal = createAbortSignal();
      const response = await fetch('/api/ai/guided-finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, prdId }),
        signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to finalize PRD');
      }

      const data = await response.json();
      setStep('done');
      stopElapsedTimer();
      clearSessionFromStorage();
      if (data.modelsUsed) setModelsUsed(data.modelsUsed);

      onContentGenerated(data.prdContent, {
        guided: true,
        tokensUsed: data.tokensUsed,
        modelsUsed: data.modelsUsed,
      });

      setTimeout(() => {
        onOpenChange(false);
        resetState();
      }, 1500);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error finalizing PRD:', err);
      setError(err.message || 'Failed to generate PRD');
      setStep('questions');
    }
  };

  const handleSkipAll = async () => {
    if (effectiveProjectIdea.length < minimumIdeaLength) {
      setError(minLengthError);
      return;
    }

    setStep('finalizing');
    setError('');

    try {
      const signal = createAbortSignal();
      const response = await fetch('/api/ai/guided-skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectIdea: effectiveProjectIdea,
          existingContent: hasExistingContent ? existingContent : undefined,
          mode: hasExistingContent ? 'improve' : 'generate',
          prdId,
        }),
        signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to generate PRD');
      }

      const data = await response.json();
      setStep('done');
      stopElapsedTimer();
      if (data.modelsUsed) setModelsUsed(data.modelsUsed);
      
      onContentGenerated(data.prdContent, {
        guided: false,
        skipped: true,
        tokensUsed: data.tokensUsed,
        modelsUsed: data.modelsUsed,
      });

      setTimeout(() => {
        onOpenChange(false);
        resetState();
      }, 1500);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error in skip-to-finalize:', err);
      setError(err.message || 'Failed to generate PRD');
      setStep('input');
    }
  };

  // Update answer for single choice (radio)
  const updateSingleAnswer = (questionId: string, optionId: string) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: { 
        selectedOptionIds: [optionId],
        customText: prev[questionId]?.customText 
      }
    }));
  };

  // Update answer for multiple choice (checkbox)
  const updateMultiAnswer = (questionId: string, optionId: string, checked: boolean) => {
    setAnswers(prev => {
      const current = prev[questionId]?.selectedOptionIds || [];
      const newSelectedIds = checked
        ? [...current, optionId]
        : current.filter(id => id !== optionId);

      // ÄNDERUNG 02.03.2025: Custom-Text bereinigen wenn 'custom' abgewählt wird
      const newCustomText = (!checked && optionId === 'custom')
        ? undefined
        : prev[questionId]?.customText;

      return {
        ...prev,
        [questionId]: {
          selectedOptionIds: newSelectedIds,
          customText: newCustomText
        }
      };
    });
  };

  // Update custom text for a question
  const updateCustomText = (questionId: string, customText: string) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: {
        selectedOptionIds: prev[questionId]?.selectedOptionIds || [],
        customText
      }
    }));
  };

  const getProgressPercentage = () => {
    switch (step) {
      case 'input': return 0;
      case 'resuming': return 10;
      case 'analyzing': return 20;
      case 'questions': return 40 + (roundNumber - 1) * 15;
      case 'processing': return 70;
      case 'finalizing': return 90;
      case 'done': return 100;
      default: return 0;
    }
  };

  const getStepTitle = () => {
    switch (step) {
      case 'input': return t.guidedAi.describeProject;
      case 'resuming': return t.guidedAi.resumeSession;
      case 'analyzing': return t.guidedAi.analyzing;
      case 'questions': return `${t.guidedAi.clarifyingQuestions} (${t.guidedAi.round} ${roundNumber})`;
      case 'processing': return t.guidedAi.processingAnswers;
      case 'finalizing': return t.guidedAi.generatingPrd;
      case 'done': return t.guidedAi.prdGenerated;
      default: return t.guidedAi.guidedGenerator;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[700px] h-[90vh] sm:h-auto sm:max-h-[85vh] overflow-auto flex flex-col p-4 sm:p-6" data-testid="dialog-guided-ai">
        <DialogHeader className="flex-shrink-0 space-y-1 sm:space-y-2">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5 text-primary flex-shrink-0" />
            <span>{getStepTitle()}</span>
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {step === 'input' && t.guidedAi.describeHint}
            {step === 'resuming' && t.guidedAi.resumeHint}
            {step === 'analyzing' && t.guidedAi.analyzingHint}
            {step === 'questions' && t.guidedAi.questionsHint}
            {step === 'processing' && t.guidedAi.processingHint}
            {step === 'finalizing' && t.guidedAi.finalizingHint}
            {step === 'done' && t.guidedAi.doneHint}
          </DialogDescription>
        </DialogHeader>

        <Progress value={getProgressPercentage()} className="h-1.5 sm:h-2 flex-shrink-0" />

        <ScrollArea className="flex-1 min-h-0 pr-2 sm:pr-4 -mr-2 sm:-mr-4">
          <div className="space-y-3 sm:space-y-4 py-2 sm:py-4 pb-16 sm:pb-8">
            {/* Step: Input */}
            {step === 'input' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="project-idea">{t.guidedAi.projectIdea}</Label>
                  <Textarea
                    id="project-idea"
                    placeholder={t.guidedAi.placeholder}
                    value={projectIdea}
                    onChange={(e) => setProjectIdea(e.target.value)}
                    rows={8}
                    data-testid="textarea-project-idea"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t.guidedAi.detailHint}
                  </p>
                </div>
              </div>
            )}

            {/* Step: Resume existing session */}
            {step === 'resuming' && (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <RotateCcw className="w-12 h-12 text-primary" />
                <p className="text-muted-foreground text-center">{t.guidedAi.resumeHint}</p>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={handleDismissResume} data-testid="button-start-new">
                    {t.guidedAi.startNew}
                  </Button>
                  <Button onClick={handleResumeSession} data-testid="button-resume-session">
                    <RotateCcw className="w-4 h-4 mr-2" />
                    {t.guidedAi.resumeButton}
                  </Button>
                </div>
              </div>
            )}

            {/* Step: Analyzing */}
            {step === 'analyzing' && (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <Brain className="w-12 h-12 text-primary animate-pulse" />
                <p className="text-muted-foreground">{t.guidedAi.analyzingProject}</p>
                <div className="flex gap-2">
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" />
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0.2s' }} />
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0.4s' }} />
                </div>
                {elapsedSeconds > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {formatElapsedTime(elapsedSeconds)} {t.guidedAi.elapsed}
                  </p>
                )}
              </div>
            )}

            {/* Step: Questions */}
            {step === 'questions' && questions.length > 0 && (
              <div className="space-y-3 sm:space-y-4">
                {/* Feature Overview Preview - more compact on mobile */}
                {featureOverview && roundNumber === 1 && (
                  <Card className="bg-muted/50">
                    <CardHeader className="p-3 sm:pb-2 sm:p-4">
                      <CardTitle className="text-xs sm:text-sm flex items-center gap-2">
                        <Sparkles className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
                        {t.guidedAi.initialAnalysis}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 pt-0 sm:p-4 sm:pt-0">
                      <p className="text-xs sm:text-sm text-muted-foreground line-clamp-3 sm:line-clamp-4">
                        {featureOverview.substring(0, 300)}...
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* ÄNDERUNG 02.03.2025: QuestionCard Komponente extrahiert (Issue 7)
                    IIFE durch separate Komponente ersetzt für bessere Lesbarkeit */}
                <QuestionCard
                  question={questions[currentQuestionIndex]}
                  answers={answers}
                  updateSingleAnswer={updateSingleAnswer}
                  updateMultiAnswer={updateMultiAnswer}
                  updateCustomText={updateCustomText}
                  t={{
                    guidedAi: {
                      questionCounter: t.guidedAi.questionCounter,
                      multipleChoiceHint: t.guidedAi.multipleChoiceHint,
                      explainPreference: t.guidedAi.explainPreference,
                    },
                    common: {
                      back: t.common.back,
                      next: t.common.next,
                    },
                  }}
                  currentQuestionIndex={currentQuestionIndex}
                  questionsLength={questions.length}
                  onPrevious={() => setCurrentQuestionIndex(i => Math.max(0, i - 1))}
                  onNext={() => setCurrentQuestionIndex(i => Math.min(questions.length - 1, i + 1))}
                />
              </div>
            )}

            {/* Step: Processing */}
            {step === 'processing' && (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <Zap className="w-12 h-12 text-amber-500 animate-pulse" />
                <p className="text-muted-foreground">{t.guidedAi.refiningRequirements}</p>
                <div className="flex gap-2">
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" />
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0.2s' }} />
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0.4s' }} />
                </div>
                {elapsedSeconds > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {formatElapsedTime(elapsedSeconds)} {t.guidedAi.elapsed}
                  </p>
                )}
              </div>
            )}

            {/* Step: Finalizing */}
            {step === 'finalizing' && (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <Sparkles className="w-12 h-12 text-primary animate-pulse" />
                <p className="text-muted-foreground">{t.guidedAi.generatingComprehensive}</p>
                <p className="text-xs text-muted-foreground">{t.guidedAi.mayTakeMinute}</p>
                <div className="flex gap-2">
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" />
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0.2s' }} />
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0.4s' }} />
                </div>
                {elapsedSeconds > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {formatElapsedTime(elapsedSeconds)} {t.guidedAi.elapsed}
                  </p>
                )}
              </div>
            )}

            {/* Step: Done */}
            {step === 'done' && (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <CheckCircle2 className="w-12 h-12 text-green-500" />
                <p className="font-medium">{t.guidedAi.prdGenerated}</p>
                <p className="text-sm text-muted-foreground">{t.guidedAi.contentAdded}</p>
                {modelsUsed.length > 0 && (
                  <div className="flex flex-wrap items-center justify-center gap-1 mt-2" data-testid="text-models-used">
                    {modelsUsed.map((m, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {m.split('/')[1] || m}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <p className="text-sm">{error}</p>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-shrink-0 gap-2 pt-2 sm:pt-4 flex-wrap justify-end">
          {step === 'input' && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  resetState();
                }}
                data-testid="button-cancel"
              >
                {t.common.cancel}
              </Button>
              <Button
                variant="outline"
                onClick={handleSkipAll}
                disabled={effectiveProjectIdea.length < minimumIdeaLength}
                data-testid="button-skip-all"
              >
                <SkipForward className="w-4 h-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">{t.guidedAi.skipQuestions}</span>
                <span className="sm:hidden">{t.guidedAi.skip}</span>
              </Button>
              <Button
                onClick={handleStart}
                disabled={effectiveProjectIdea.length < minimumIdeaLength}
                data-testid="button-start-guided"
              >
                <ArrowRight className="w-4 h-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">{t.guidedAi.startGuidedGeneration}</span>
                <span className="sm:hidden">{t.guidedAi.start}</span>
              </Button>
            </>
          )}

          {step === 'questions' && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  resetState();
                }}
                data-testid="button-cancel-questions"
              >
                {t.common.cancel}
              </Button>
              {currentQuestionIndex === questions.length - 1 ? (
                // Letzte Frage: Zeige "Überspringen & Generieren" und "Antworten absenden"
                <>
                  <Button
                    variant="outline"
                    onClick={handleSkipQuestions}
                    data-testid="button-skip-questions"
                  >
                    <SkipForward className="w-4 h-4 mr-1 sm:mr-2" />
                    <span className="hidden sm:inline">{t.guidedAi.skipGenerate}</span>
                    <span className="sm:hidden">{t.guidedAi.skip}</span>
                  </Button>
                  <Button
                    onClick={handleSubmitAnswers}
                    disabled={Object.keys(answers).length === 0}
                    data-testid="button-submit-answers"
                  >
                    <ArrowRight className="w-4 h-4 mr-1 sm:mr-2" />
                    {t.guidedAi.continue}
                  </Button>
                </>
              ) : (
                // Nicht die letzte Frage: Zeige "Nächste Frage" Button
                <Button
                  onClick={() => setCurrentQuestionIndex(i => Math.min(questions.length - 1, i + 1))}
                  disabled={!answers[questions[currentQuestionIndex]?.id]?.selectedOptionIds?.length}
                  data-testid="button-next-question"
                >
                  <ArrowRight className="w-4 h-4 mr-1 sm:mr-2" />
                  {t.common.next}
                </Button>
              )}
            </>
          )}

          {(step === 'analyzing' || step === 'processing' || step === 'finalizing' || step === 'resuming') && (
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                resetState();
              }}
              data-testid="button-cancel-processing"
            >
              {t.common.cancel}
            </Button>
          )}

          {step === 'done' && (
            <Button variant="outline" disabled>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              {t.guidedAi.done}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
