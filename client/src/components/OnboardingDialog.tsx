import { useState } from "react";
import { Sparkles, FileText, Zap, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface OnboardingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OnboardingDialog({ open, onOpenChange }: OnboardingDialogProps) {
  const [step, setStep] = useState(0);

  const steps = [
    {
      title: "Welcome to NEXORA",
      description: "Create professional Product Requirement Documents 10x faster with AI assistance",
      icon: Sparkles,
      content: "NEXORA combines intelligent AI content generation with powerful collaboration tools to streamline your PRD creation process.",
    },
    {
      title: "Start with Templates",
      description: "Choose from pre-built templates or create your own",
      icon: FileText,
      content: "We provide templates for Features, Epics, Technical Specs, and Product Launches. Each template is optimized for its specific use case.",
    },
    {
      title: "AI-Powered Assistance",
      description: "Let Claude AI help you write better PRDs",
      icon: Zap,
      content: "Use AI Assist to generate professional content, improve clarity, and ensure completeness. The AI understands product management best practices.",
    },
    {
      title: "Collaborate & Export",
      description: "Share with your team and export to your favorite tools",
      icon: Users,
      content: "Share PRDs with team members, export to Linear, Markdown, or PDF. Keep your entire team aligned with version control.",
    },
  ];

  const currentStep = steps[step];
  const Icon = currentStep.icon;

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      onOpenChange(false);
      localStorage.setItem("onboarding_completed", "true");
    }
  };

  const handleSkip = () => {
    onOpenChange(false);
    localStorage.setItem("onboarding_completed", "true");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="dialog-onboarding">
        <DialogHeader>
          <div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-primary to-accent">
            <Icon className="w-8 h-8 text-white" />
          </div>
          <DialogTitle className="text-center text-2xl">{currentStep.title}</DialogTitle>
          <DialogDescription className="text-center text-base pt-2">
            {currentStep.description}
          </DialogDescription>
        </DialogHeader>

        <div className="py-6">
          <p className="text-center text-muted-foreground">
            {currentStep.content}
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 pb-4">
          {steps.map((_, index) => (
            <div
              key={index}
              className={`w-2 h-2 rounded-full transition-colors ${
                index === step ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={handleSkip}
            className="flex-1"
            data-testid="button-skip-onboarding"
          >
            Skip
          </Button>
          <Button
            onClick={handleNext}
            className="flex-1"
            data-testid="button-next-onboarding"
          >
            {step === steps.length - 1 ? "Get Started" : "Next"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
