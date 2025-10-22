import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Sparkles, Brain, CheckCircle2, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

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
  const [currentStep, setCurrentStep] = useState<'idle' | 'generating' | 'reviewing' | 'improving' | 'done'>('idle');
  const [generatorModel, setGeneratorModel] = useState('');
  const [reviewerModel, setReviewerModel] = useState('');
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    if (!userInput.trim() && !currentContent) {
      setError('Please provide input or ensure there is existing content');
      return;
    }

    setIsGenerating(true);
    setError('');
    setCurrentStep('generating');

    try {
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
      
      // Pass the result to parent component
      onContentGenerated(data.finalContent, data);
      
      // Close dialog after a short delay
      setTimeout(() => {
        onOpenChange(false);
        resetState();
      }, 1500);
      
    } catch (err: any) {
      console.error('Dual-AI generation error:', err);
      setError(err.message || 'Failed to generate content');
      setCurrentStep('idle');
    } finally {
      setIsGenerating(false);
    }
  };

  const resetState = () => {
    setUserInput('');
    setCurrentStep('idle');
    setGeneratorModel('');
    setReviewerModel('');
    setError('');
  };

  const getStepIcon = () => {
    switch (currentStep) {
      case 'generating':
        return <Brain className="w-5 h-5 animate-pulse text-primary" />;
      case 'reviewing':
        return <Sparkles className="w-5 h-5 animate-pulse text-amber-500" />;
      case 'improving':
        return <Brain className="w-5 h-5 animate-pulse text-blue-500" />;
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
      case 'done':
        return 'Content generated successfully!';
      default:
        return 'Ready to generate';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]" data-testid="dialog-dual-ai">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Dual-AI Assistant
          </DialogTitle>
          <DialogDescription>
            Generate or improve your PRD using two AI models: Generator + Critical Reviewer
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
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
            <div className="flex gap-2">
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
                <Sparkles className="w-4 h-4 mr-2" />
                {currentContent ? 'Improve with Dual-AI' : 'Generate with Dual-AI'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
