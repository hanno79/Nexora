import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { Sparkles, Brain, CheckCircle2, AlertCircle, ArrowRight, ArrowLeft, Zap, MessageSquare, SkipForward } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';

interface GuidedQuestion {
  id: string;
  question: string;
  context: string;
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
}

type Step = 'input' | 'analyzing' | 'questions' | 'processing' | 'finalizing' | 'done';

interface AnswerState {
  [questionId: string]: {
    selectedOptionId: string;
    customText?: string;
  };
}

export function GuidedAiDialog({
  open,
  onOpenChange,
  onContentGenerated,
  initialProjectIdea = ''
}: GuidedAiDialogProps) {
  const [projectIdea, setProjectIdea] = useState(initialProjectIdea);
  const [step, setStep] = useState<Step>('input');
  const [hasAutoStarted, setHasAutoStarted] = useState(false);
  
  // Sync project idea and auto-start when dialog opens with initial value
  useEffect(() => {
    if (open && initialProjectIdea && initialProjectIdea.trim().length >= 10) {
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
  }, [open, initialProjectIdea]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [featureOverview, setFeatureOverview] = useState('');
  const [questions, setQuestions] = useState<GuidedQuestion[]>([]);
  const [answers, setAnswers] = useState<AnswerState>({});
  const [roundNumber, setRoundNumber] = useState(1);
  const [error, setError] = useState('');
  const [refinedPlan, setRefinedPlan] = useState('');
  const [modelsUsed, setModelsUsed] = useState<string[]>([]);

  const resetState = () => {
    setProjectIdea('');
    setStep('input');
    setSessionId(null);
    setFeatureOverview('');
    setQuestions([]);
    setAnswers({});
    setRoundNumber(1);
    setError('');
    setRefinedPlan('');
    setModelsUsed([]);
    setHasAutoStarted(false);
  };

  const handleStartWithIdea = async (idea: string) => {
    if (idea.trim().length < 10) {
      setError('Please provide a more detailed project description (at least 10 characters)');
      return;
    }

    setStep('analyzing');
    setError('');

    try {
      const response = await fetch('/api/ai/guided-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIdea: idea.trim() })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to start guided workflow');
      }

      const data = await response.json();
      setSessionId(data.sessionId);
      setFeatureOverview(data.featureOverview);
      setQuestions(data.questions || []);
      
      if (data.questions && data.questions.length > 0) {
        setStep('questions');
      } else {
        await handleFinalize(data.sessionId);
      }
    } catch (err: any) {
      console.error('Error starting guided workflow:', err);
      setError(err.message || 'Failed to analyze project idea');
      setStep('input');
    }
  };

  const handleStart = async () => {
    if (projectIdea.trim().length < 10) {
      setError('Please provide a more detailed project description (at least 10 characters)');
      return;
    }

    setStep('analyzing');
    setError('');

    try {
      const response = await fetch('/api/ai/guided-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIdea: projectIdea.trim() })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to start guided workflow');
      }

      const data = await response.json();
      setSessionId(data.sessionId);
      setFeatureOverview(data.featureOverview);
      setQuestions(data.questions || []);
      
      if (data.questions && data.questions.length > 0) {
        setStep('questions');
      } else {
        await handleFinalize(data.sessionId);
      }
    } catch (err: any) {
      console.error('Error starting guided workflow:', err);
      setError(err.message || 'Failed to analyze project idea');
      setStep('input');
    }
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

    const answersArray = Object.entries(answers).map(([questionId, answer]) => ({
      questionId,
      selectedOptionId: answer.selectedOptionId,
      customText: answer.selectedOptionId === 'custom' ? answer.customText : undefined,
    }));

    if (answersArray.length === 0) {
      setError('Please answer at least one question');
      return;
    }

    // Validate that custom text is provided when "Other" is selected
    for (const answer of answersArray) {
      if (answer.selectedOptionId === 'custom' && (!answer.customText || answer.customText.trim().length === 0)) {
        setError('Please provide details for your custom answer');
        return;
      }
    }

    setStep('processing');
    setError('');

    try {
      const response = await fetch('/api/ai/guided-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, answers: answersArray, questions })
      });

      if (!response.ok) {
        const errorData = await response.json();
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
        setStep('questions');
      }
    } catch (err: any) {
      console.error('Error processing answers:', err);
      setError(err.message || 'Failed to process answers');
      setStep('questions');
    }
  };

  const handleFinalize = async (sid: string) => {
    setStep('finalizing');

    try {
      const response = await fetch('/api/ai/guided-finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to finalize PRD');
      }

      const data = await response.json();
      setStep('done');
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
      console.error('Error finalizing PRD:', err);
      setError(err.message || 'Failed to generate PRD');
      setStep('questions');
    }
  };

  const handleSkipAll = async () => {
    if (projectIdea.trim().length < 10) {
      setError('Please provide a more detailed project description');
      return;
    }

    setStep('finalizing');
    setError('');

    try {
      const response = await fetch('/api/ai/guided-skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIdea: projectIdea.trim() })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to generate PRD');
      }

      const data = await response.json();
      setStep('done');
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
      console.error('Error in skip-to-finalize:', err);
      setError(err.message || 'Failed to generate PRD');
      setStep('input');
    }
  };

  const updateAnswer = (questionId: string, optionId: string, customText?: string) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: { selectedOptionId: optionId, customText }
    }));
  };

  const getProgressPercentage = () => {
    switch (step) {
      case 'input': return 0;
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
      case 'input': return 'Describe Your Project';
      case 'analyzing': return 'Analyzing Your Idea...';
      case 'questions': return `Clarifying Questions (Round ${roundNumber})`;
      case 'processing': return 'Processing Your Answers...';
      case 'finalizing': return 'Generating Your PRD...';
      case 'done': return 'PRD Generated Successfully!';
      default: return 'Guided PRD Generator';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[700px] h-[90vh] sm:h-auto sm:max-h-[85vh] overflow-hidden flex flex-col p-4 sm:p-6" data-testid="dialog-guided-ai">
        <DialogHeader className="flex-shrink-0 space-y-1 sm:space-y-2">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5 text-primary flex-shrink-0" />
            <span>{getStepTitle()}</span>
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {step === 'input' && 'Describe your project idea and we\'ll help you create a detailed PRD'}
            {step === 'analyzing' && 'AI is analyzing your project idea...'}
            {step === 'questions' && 'Answer these questions to refine your requirements'}
            {step === 'processing' && 'Integrating your feedback...'}
            {step === 'finalizing' && 'Creating your comprehensive PRD...'}
            {step === 'done' && 'Your PRD is ready!'}
          </DialogDescription>
        </DialogHeader>

        <Progress value={getProgressPercentage()} className="h-1.5 sm:h-2 flex-shrink-0" />

        <ScrollArea className="flex-1 min-h-0 pr-2 sm:pr-4 -mr-2 sm:-mr-4">
          <div className="space-y-3 sm:space-y-4 py-2 sm:py-4 pb-16 sm:pb-8">
            {/* Step: Input */}
            {step === 'input' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="project-idea">Project Idea</Label>
                  <Textarea
                    id="project-idea"
                    placeholder="Describe your product idea in detail. What problem does it solve? Who is it for? What are the main features you envision?"
                    value={projectIdea}
                    onChange={(e) => setProjectIdea(e.target.value)}
                    rows={8}
                    data-testid="textarea-project-idea"
                  />
                  <p className="text-xs text-muted-foreground">
                    The more details you provide, the better the AI can understand and help refine your requirements.
                  </p>
                </div>
              </div>
            )}

            {/* Step: Analyzing */}
            {step === 'analyzing' && (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <Brain className="w-12 h-12 text-primary animate-pulse" />
                <p className="text-muted-foreground">Analyzing your project idea...</p>
                <div className="flex gap-2">
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" />
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0.2s' }} />
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0.4s' }} />
                </div>
              </div>
            )}

            {/* Step: Questions */}
            {step === 'questions' && (
              <div className="space-y-3 sm:space-y-4">
                {/* Feature Overview Preview - more compact on mobile */}
                {featureOverview && roundNumber === 1 && (
                  <Card className="bg-muted/50">
                    <CardHeader className="p-3 sm:pb-2 sm:p-4">
                      <CardTitle className="text-xs sm:text-sm flex items-center gap-2">
                        <Sparkles className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
                        Initial Analysis
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 pt-0 sm:p-4 sm:pt-0">
                      <p className="text-xs sm:text-sm text-muted-foreground line-clamp-3 sm:line-clamp-4">
                        {featureOverview.substring(0, 300)}...
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* Questions - compact mobile layout */}
                {questions.map((question, index) => (
                  <Card key={question.id} data-testid={`card-question-${question.id}`}>
                    <CardHeader className="p-3 pb-2 sm:p-4 sm:pb-2">
                      <CardTitle className="text-sm sm:text-base leading-tight">
                        {index + 1}. {question.question}
                      </CardTitle>
                      {question.context && (
                        <CardDescription className="text-xs sm:text-sm mt-1">{question.context}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent className="p-3 pt-0 sm:p-4 sm:pt-0 space-y-2 sm:space-y-3">
                      <RadioGroup
                        value={answers[question.id]?.selectedOptionId || ''}
                        onValueChange={(value) => updateAnswer(question.id, value)}
                        className="space-y-2 sm:space-y-3"
                      >
                        {question.options.map((option) => (
                          <div key={option.id} className="flex items-start space-x-2 sm:space-x-3">
                            <RadioGroupItem 
                              value={option.id} 
                              id={`${question.id}-${option.id}`}
                              data-testid={`radio-${question.id}-${option.id}`}
                              className="mt-0.5 flex-shrink-0"
                            />
                            <div className="grid gap-0.5 flex-1 min-w-0">
                              <Label 
                                htmlFor={`${question.id}-${option.id}`}
                                className="font-medium cursor-pointer text-sm sm:text-base leading-tight"
                              >
                                {option.label}
                              </Label>
                              <p className="text-xs sm:text-sm text-muted-foreground leading-snug">
                                {option.description}
                              </p>
                            </div>
                          </div>
                        ))}
                      </RadioGroup>

                      {/* Custom text input when "Other" is selected */}
                      {answers[question.id]?.selectedOptionId === 'custom' && (
                        <div className="mt-2 sm:mt-3 pl-5 sm:pl-7">
                          <Input
                            placeholder="Please explain your preference..."
                            value={answers[question.id]?.customText || ''}
                            onChange={(e) => updateAnswer(question.id, 'custom', e.target.value)}
                            data-testid={`input-custom-${question.id}`}
                            className="text-sm"
                          />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Step: Processing */}
            {step === 'processing' && (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <Zap className="w-12 h-12 text-amber-500 animate-pulse" />
                <p className="text-muted-foreground">Refining your requirements...</p>
                <div className="flex gap-2">
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" />
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0.2s' }} />
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0.4s' }} />
                </div>
              </div>
            )}

            {/* Step: Finalizing */}
            {step === 'finalizing' && (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <Sparkles className="w-12 h-12 text-primary animate-pulse" />
                <p className="text-muted-foreground">Generating your comprehensive PRD...</p>
                <p className="text-xs text-muted-foreground">This may take a minute...</p>
                <div className="flex gap-2">
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" />
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0.2s' }} />
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0.4s' }} />
                </div>
              </div>
            )}

            {/* Step: Done */}
            {step === 'done' && (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <CheckCircle2 className="w-12 h-12 text-green-500" />
                <p className="font-medium">PRD Generated Successfully!</p>
                <p className="text-sm text-muted-foreground">Your content has been added to the editor</p>
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
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={handleSkipAll}
                disabled={projectIdea.trim().length < 10}
                data-testid="button-skip-all"
              >
                <SkipForward className="w-4 h-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">Skip Questions</span>
                <span className="sm:hidden">Skip</span>
              </Button>
              <Button
                onClick={handleStart}
                disabled={projectIdea.trim().length < 10}
                data-testid="button-start-guided"
              >
                <ArrowRight className="w-4 h-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">Start Guided Generation</span>
                <span className="sm:hidden">Start</span>
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
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={handleSkipQuestions}
                data-testid="button-skip-questions"
              >
                <SkipForward className="w-4 h-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">Skip & Generate</span>
                <span className="sm:hidden">Skip</span>
              </Button>
              <Button
                onClick={handleSubmitAnswers}
                disabled={Object.keys(answers).length === 0}
                data-testid="button-submit-answers"
              >
                <ArrowRight className="w-4 h-4 mr-1 sm:mr-2" />
                Continue
              </Button>
            </>
          )}

          {(step === 'analyzing' || step === 'processing' || step === 'finalizing') && (
            <Button variant="outline" disabled>
              <Brain className="w-4 h-4 mr-2 animate-pulse" />
              Processing...
            </Button>
          )}

          {step === 'done' && (
            <Button variant="outline" disabled>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
