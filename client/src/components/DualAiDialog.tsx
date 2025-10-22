import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Sparkles, Brain, CheckCircle2, AlertCircle, Repeat, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';

interface DualAiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentContent: string;
  onContentGenerated: (content: string, response: any) => void;
}

export function DualAiDialog({
  open,
  onOpenChange,
  currentContent,
  onContentGenerated
}: DualAiDialogProps) {
  const [userInput, setUserInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStep, setCurrentStep] = useState<'idle' | 'generating' | 'reviewing' | 'improving' | 'iterating' | 'done'>('idle');
  const [generatorModel, setGeneratorModel] = useState('');
  const [reviewerModel, setReviewerModel] = useState('');
  const [error, setError] = useState('');
  
  // Iterative mode settings
  const [workflowMode, setWorkflowMode] = useState<'simple' | 'iterative'>('simple');
  const [iterationCount, setIterationCount] = useState(3);
  const [useFinalReview, setUseFinalReview] = useState(false);
  const [currentIteration, setCurrentIteration] = useState(0);
  const [totalIterations, setTotalIterations] = useState(0);

  // Load user AI preferences to set default workflow mode
  useEffect(() => {
    if (open) {
      loadUserSettings();
    }
  }, [open]);

  const loadUserSettings = async () => {
    try {
      const response = await fetch('/api/settings/ai');
      if (response.ok) {
        const settings = await response.json();
        if (settings.iterativeMode !== undefined) {
          setWorkflowMode(settings.iterativeMode ? 'iterative' : 'simple');
        }
        if (settings.iterationCount) {
          setIterationCount(settings.iterationCount);
        }
        if (settings.useFinalReview !== undefined) {
          setUseFinalReview(settings.useFinalReview);
        }
      }
    } catch (err) {
      console.error('Failed to load AI settings:', err);
    }
  };

  const handleGenerate = async () => {
    if (!userInput.trim() && !currentContent) {
      setError('Please provide input or ensure there is existing content');
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
      setError(err.message || 'Failed to generate content');
      setCurrentStep('idle');
      setCurrentIteration(0);
      setTotalIterations(0);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSimpleGeneration = async () => {
    const response = await fetch('/api/ai/generate-dual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userInput: userInput.trim(),
        existingContent: currentContent || undefined,
        mode: currentContent ? 'improve' : 'generate'
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to generate content');
    }

    const data = await response.json();
    
    setGeneratorModel(data.generatorResponse.model);
    setReviewerModel(data.reviewerResponse.model);
    setCurrentStep('done');
    
    onContentGenerated(data.finalContent, data);
    
    setTimeout(() => {
      onOpenChange(false);
      resetState();
    }, 1500);
  };

  const handleIterativeGeneration = async () => {
    setTotalIterations(iterationCount);
    setCurrentIteration(0);
    
    // Priority: userInput first, then currentContent as fallback
    const initialInput = userInput.trim() || currentContent || '';
    
    const response = await fetch('/api/ai/generate-iterative', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initialContent: initialInput,
        iterationCount,
        useFinalReview
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to generate content');
    }

    const data = await response.json();
    
    setCurrentStep('iterating');
    
    // Simulate iteration progress for better UX
    for (let i = 1; i <= iterationCount; i++) {
      setCurrentIteration(i);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    if (data.modelsUsed && data.modelsUsed.length > 0) {
      setGeneratorModel(data.modelsUsed[0]);
      setReviewerModel(data.modelsUsed[1] || data.modelsUsed[0]);
    }
    
    setCurrentStep('done');
    onContentGenerated(data.finalContent, data);
    
    setTimeout(() => {
      onOpenChange(false);
      resetState();
    }, 2000);
  };

  const resetState = () => {
    setUserInput('');
    setCurrentStep('idle');
    setGeneratorModel('');
    setReviewerModel('');
    setError('');
    setCurrentIteration(0);
    setTotalIterations(0);
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
        return 'AI Generator creating PRD...';
      case 'reviewing':
        return 'AI Reviewer analyzing content...';
      case 'improving':
        return 'Improving based on feedback...';
      case 'iterating':
        return `Iterative refinement: ${currentIteration}/${totalIterations}`;
      case 'done':
        return 'Content generated successfully!';
      default:
        return 'Ready to generate';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto" data-testid="dialog-dual-ai">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Dual-AI Assistant
          </DialogTitle>
          <DialogDescription>
            Generate or improve your PRD using advanced AI workflows
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Workflow Mode Toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Label htmlFor="workflow-mode" className="text-base font-medium">Workflow Mode</Label>
                {workflowMode === 'iterative' && (
                  <Badge variant="secondary" className="text-xs">
                    <Zap className="w-3 h-3 mr-1" />
                    Advanced
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {workflowMode === 'simple' 
                  ? 'Simple: Generator → Reviewer → Improvement' 
                  : `Iterative: ${iterationCount}x Q&A refinement cycles`
                }
              </p>
            </div>
            <Switch
              id="workflow-mode"
              checked={workflowMode === 'iterative'}
              onCheckedChange={(checked) => setWorkflowMode(checked ? 'iterative' : 'simple')}
              disabled={isGenerating}
              data-testid="switch-workflow-mode"
            />
          </div>

          {/* Iterative Mode Settings */}
          {workflowMode === 'iterative' && (
            <div className="space-y-4 p-4 rounded-lg border bg-muted/50">
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  Iteration Count: {iterationCount}
                </Label>
                <Slider
                  value={[iterationCount]}
                  onValueChange={([value]) => setIterationCount(value)}
                  min={2}
                  max={5}
                  step={1}
                  disabled={isGenerating}
                  className="py-2"
                  data-testid="slider-iteration-count"
                />
                <p className="text-xs text-muted-foreground">
                  More iterations = deeper refinement (but slower and more expensive)
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
                    Final Review
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Add a final quality check after all iterations
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Status Display */}
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

          {/* Model Info */}
          {(generatorModel || reviewerModel) && (
            <div className="flex gap-2 flex-wrap">
              {generatorModel && (
                <Badge variant="outline" className="text-xs">
                  Generator: {generatorModel.split('/')[1] || generatorModel}
                </Badge>
              )}
              {reviewerModel && (
                <Badge variant="outline" className="text-xs">
                  Reviewer: {reviewerModel.split('/')[1] || reviewerModel}
                </Badge>
              )}
            </div>
          )}

          {/* User Input */}
          <div className="space-y-2">
            <Label htmlFor="ai-input">
              {currentContent ? 'Improvement Instructions' : 'PRD Description'}
            </Label>
            <Textarea
              id="ai-input"
              placeholder={currentContent 
                ? "Describe what you want to improve or add..."
                : "Describe your product idea, features, and requirements..."
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
              onOpenChange(false);
              resetState();
            }}
            disabled={isGenerating}
            data-testid="button-dual-ai-cancel"
          >
            Cancel
          </Button>
          <Button 
            onClick={handleGenerate}
            disabled={isGenerating || (!userInput.trim() && !currentContent)}
            data-testid="button-dual-ai-generate"
          >
            {isGenerating ? (
              <>
                <Brain className="w-4 h-4 mr-2 animate-pulse" />
                Generating...
              </>
            ) : (
              <>
                {workflowMode === 'iterative' ? (
                  <Repeat className="w-4 h-4 mr-2" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-2" />
                )}
                {workflowMode === 'iterative' 
                  ? `Generate (${iterationCount}x iterations)` 
                  : (currentContent ? 'Improve with Dual-AI' : 'Generate with Dual-AI')
                }
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
