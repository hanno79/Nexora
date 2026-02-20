import { useEffect, useState } from "react";
import { Sparkles, FileText, Zap, Users, X, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "@/lib/i18n";

interface OnboardingBannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OnboardingDialog({ open, onOpenChange }: OnboardingBannerProps) {
  const [step, setStep] = useState(0);
  const { t } = useTranslation();

  const steps = [
    {
      title: t.onboarding.welcome,
      description: t.onboarding.welcomeDesc,
      icon: Sparkles,
      content: t.onboarding.welcomeContent,
    },
    {
      title: t.onboarding.templatesTitle,
      description: t.onboarding.templatesDesc,
      icon: FileText,
      content: t.onboarding.templatesContent,
    },
    {
      title: t.onboarding.aiTitle,
      description: t.onboarding.aiDesc,
      icon: Zap,
      content: t.onboarding.aiContent,
    },
    {
      title: t.onboarding.collaborateTitle,
      description: t.onboarding.collaborateDesc,
      icon: Users,
      content: t.onboarding.collaborateContent,
    },
  ];

  useEffect(() => {
    if (open) {
      setStep(0);
    }
  }, [open]);

  const currentStep = steps[step];
  const Icon = currentStep.icon;

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      dismiss();
    }
  };

  const dismiss = () => {
    onOpenChange(false);
    localStorage.setItem("onboarding_completed", "true");
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
      >
        <Card className="relative overflow-hidden border-primary/20 bg-gradient-to-r from-primary/5 to-accent/5" data-testid="dialog-onboarding">
          <button
            onClick={dismiss}
            className="absolute top-3 right-3 p-1 rounded-md hover:bg-muted transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>

          <div className="flex items-center gap-4 p-4 sm:p-6">
            <div className="flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-br from-primary to-accent">
              <Icon className="w-6 h-6 text-white" />
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-base">{currentStep.title}</h3>
              <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                {currentStep.content}
              </p>
            </div>

            <div className="flex items-center gap-3 flex-shrink-0">
              {/* Progress dots */}
              <div className="hidden sm:flex items-center gap-1.5">
                {steps.map((_, index) => (
                  <div
                    key={index}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${
                      index === step ? "bg-primary" : "bg-muted-foreground/30"
                    }`}
                  />
                ))}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={dismiss}
                data-testid="button-skip-onboarding"
              >
                {t.onboarding.skip}
              </Button>
              <Button
                size="sm"
                onClick={handleNext}
                className="gap-1"
                data-testid="button-next-onboarding"
              >
                {step === steps.length - 1 ? t.onboarding.getStarted : t.onboarding.next}
                <ChevronRight className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}
