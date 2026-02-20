import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Sparkles, Brain, CheckCircle2, AlertCircle, Repeat, Zap, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { GuidedAiDialog } from './GuidedAiDialog';
import { useTranslation } from "@/lib/i18n";

function isScaffoldOnly(content: string): boolean {
  if (!content || content.trim().length === 0) return true;

  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return true;

  const nonHeadingLines = lines.filter(l => !l.startsWith('#'));
  if (nonHeadingLines.length === 0) return true;

  const scaffoldPhrases = [
    'brief description', 'what we aim', 'as a [user]', 'i want [goal]',
    'how we measure', 'key milestones', 'functional and non-functional',
    'high-level overview', 'long-term vision', 'strategic alignment',
    'what\'s included', 'breakdown of individual', 'team and technical',
    'kpis and success', 'phased delivery', 'technical problem',
    'technical approach', 'system design', 'detailed technical',
    'how we\'ll validate', 'scalability and optimization', 'deployment strategy',
    'what we\'re launching', 'who we\'re building', 'unique value',
    'complete feature list', 'marketing and launch', 'launch kpis',
    'launch schedule', 'potential issues and solutions',
    'default section content', 'section content placeholder',
  ];

  const substantiveLines = nonHeadingLines.filter(line => {
    const lower = line.toLowerCase();
    return !scaffoldPhrases.some(phrase => lower.includes(phrase));
  });

  return substantiveLines.length === 0;
}

interface DualAiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentContent: string;
  prdId?: string;
  onContentGenerated: (content: string, response: any) => void;
}

export function DualAiDialog({
  open,
  onOpenChange,
  currentContent,
  prdId,
  onContentGenerated
}: DualAiDialogProps) {
  const { t } = useTranslation();
  const hasRealContent = !isScaffoldOnly(currentContent);
  const [userInput, setUserInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [currentStep, setCurrentStep] = useState<'idle' | 'generating' | 'reviewing' | 'improving' | 'iterating' | 'done'>('idle');
  const [generatorModel, setGeneratorModel] = useState('');
  const [reviewerModel, setReviewerModel] = useState('');
  const [error, setError] = useState('');
  
  // Workflow mode: simple, iterative, or guided (new)
  const [workflowMode, setWorkflowMode] = useState<'simple' | 'iterative' | 'guided'>('simple');
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
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [totalTokensSoFar, setTotalTokensSoFar] = useState(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load user AI preferences to set default workflow mode
  useEffect(() => {
    if (open) {
      loadUserSettings();
    }
  }, [open]);

  const loadUserSettings = async () => {
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
      }
    } catch (err) {
      console.error('Failed to load AI settings:', err);
    }
  };

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
      abortControllerRef.current = null;
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
        setError(err.message || 'Failed to generate content');
      }
      setCurrentStep('idle');
      setCurrentIteration(0);
      setTotalIterations(0);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSimpleGeneration = async () => {
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
    }, iterativeTimeoutMinutes * 60 * 1000);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to generate content');
    }

    const data = await response.json();
    const finalContent = data.finalContent || data.mergedPRD || '';
    if (!finalContent || !finalContent.trim()) {
      throw new Error('AI returned no content. Please retry.');
    }
    
    setGeneratorModel(data.generatorResponse.model);
    setReviewerModel(data.reviewerResponse.model);
    setCurrentStep('done');
    
    onContentGenerated(finalContent, data);
    
    setTimeout(() => {
      onOpenChange(false);
      resetState();
    }, 1500);
  };

  const handleIterativeGeneration = async () => {
    setTotalIterations(iterationCount);
    setCurrentIteration(0);
    setTotalTokensSoFar(0);
    setProgressDetail(t.dualAi.startingIterative);
    setCurrentStep('iterating');

    // Start elapsed timer
    const startTime = Date.now();
    setElapsedSeconds(0);
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), iterativeTimeoutMinutes * 60 * 1000);

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

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        let msg = 'Failed to generate content';
        try { msg = JSON.parse(errorText).message || msg; } catch {}
        throw new Error(msg);
      }

      // Check if server responded with SSE
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream') && response.body) {
        // Stream SSE events
        const data = await readSSEStream(response.body, (event) => {
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
            case 'complete':
              setTotalTokensSoFar(event.totalTokens || 0);
              break;
          }
        });

        if (!data) throw new Error('SSE stream ended without result');
        const finalContent = data.finalContent || data.mergedPRD || '';
        if (!finalContent.trim()) throw new Error('AI returned no content. Please retry.');

        if (data.modelsUsed?.length > 0) {
          setGeneratorModel(data.modelsUsed[0]);
          setReviewerModel(data.modelsUsed[1] || data.modelsUsed[0]);
        }

        setCurrentStep('done');
        onContentGenerated(finalContent, data);
      } else {
        // Fallback: traditional JSON response (non-SSE)
        const data = await response.json();
        const finalContent = data.finalContent || data.mergedPRD || '';
        if (!finalContent.trim()) throw new Error('AI returned no content. Please retry.');

        if (data.modelsUsed?.length > 0) {
          setGeneratorModel(data.modelsUsed[0]);
          setReviewerModel(data.modelsUsed[1] || data.modelsUsed[0]);
        }

        setCurrentStep('done');
        onContentGenerated(finalContent, data);
      }

      setTimeout(() => {
        onOpenChange(false);
        resetState();
      }, 2000);
    } finally {
      clearTimeout(timeout);
      abortControllerRef.current = null;
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    }
  };

  /** Reads an SSE stream, calling onEvent for progress events. Returns the final result payload. */
  const readSSEStream = async (
    body: ReadableStream<Uint8Array>,
    onEvent: (event: any) => void
  ): Promise<any | null> => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: any = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE messages (delimited by double newline)
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const lines = part.split('\n');
        let eventType = '';
        let data = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7).trim();
          else if (line.startsWith('data: ')) data += line.slice(6);
          else if (line.startsWith('data:')) data += line.slice(5);
        }
        if (!data) continue;
        let isErrorEvent = false;
        try {
          const parsed = JSON.parse(data);
          if (eventType === 'result') {
            result = parsed;
          } else if (eventType === 'error') {
            isErrorEvent = true;
            throw new Error(parsed.message || 'Server error during generation');
          } else {
            onEvent(parsed);
          }
        } catch (e: any) {
          if (isErrorEvent) throw e;
          if (e.message?.includes('Server error')) throw e;
          console.warn('SSE parse error:', e);
        }
      }
    }
    return result;
  };

  const resetState = () => {
    setUserInput('');
    setCurrentStep('idle');
    setGeneratorModel('');
    setReviewerModel('');
    setError('');
    setCurrentIteration(0);
    setTotalIterations(0);
    setProgressDetail('');
    setElapsedSeconds(0);
    setTotalTokensSoFar(0);
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
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
      case 'done':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
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
      case 'done':
        return t.dualAi.done;
      default:
        return t.dualAi.ready;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          {/* Workflow Mode Selection */}
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

          {/* Iterative Mode Settings */}
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

          {/* Status Display */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 p-3 rounded-md bg-muted">
              {getStepIcon()}
              <span className="text-sm font-medium">{getStepText()}</span>
              {currentStep !== 'idle' && currentStep !== 'done' && (
                <div className="ml-auto flex gap-2">
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" />
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0.2s' }} />
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0.4s' }} />
                </div>
              )}
            </div>
            {/* Live stats for iterative mode */}
            {currentStep === 'iterating' && (
              <div className="flex items-center gap-4 px-3 text-xs text-muted-foreground">
                {elapsedSeconds > 0 && (
                  <span>{Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')} {t.dualAi.elapsed}</span>
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

          {/* Model Info */}
          {(generatorModel || reviewerModel) && (
            <div className="flex gap-2 flex-wrap">
              {generatorModel && (
                <Badge variant="outline" className="text-xs">
                  {t.dualAi.generator}: {generatorModel.split('/')[1] || generatorModel}
                </Badge>
              )}
              {reviewerModel && (
                <Badge variant="outline" className="text-xs">
                  {t.dualAi.reviewer}: {reviewerModel.split('/')[1] || reviewerModel}
                </Badge>
              )}
            </div>
          )}

          {/* User Input */}
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

          {/* Error Display */}
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
            onClick={() => {
              if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
              }
              onOpenChange(false);
              resetState();
            }}
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

      {/* Guided AI Dialog - opened when guided mode is selected */}
      <GuidedAiDialog
        open={showGuidedDialog}
        onOpenChange={(isOpen) => {
          setShowGuidedDialog(isOpen);
          if (!isOpen) {
            onOpenChange(false);
            resetState();
          }
        }}
        onContentGenerated={(content, response) => {
          onContentGenerated(content, response);
          setShowGuidedDialog(false);
          onOpenChange(false);
          resetState();
        }}
        initialProjectIdea={userInput}
      />
    </Dialog>
  );
}
