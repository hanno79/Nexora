import { Button } from "@/components/ui/button";
import { Sparkles, Zap, Target, Workflow, ArrowRight } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

export default function Landing() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-accent/5 to-background" />
        <div className="relative container mx-auto px-4 py-20 md:py-32">
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-8">
              <Sparkles className="w-4 h-4" />
              <span className="text-sm font-medium">{t.landing.badge}</span>
            </div>

            <h1 className="text-4xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
              {t.landing.headline}
            </h1>

            <p className="text-xl text-muted-foreground mb-12 max-w-2xl mx-auto">
              {t.landing.subheadline}
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                size="lg"
                className="group"
                onClick={() => window.location.href = '/api/login'}
                data-testid="button-get-started"
              >
                {t.landing.getStarted}
                <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => window.location.href = '/api/login'}
                data-testid="button-login"
              >
                {t.landing.logIn}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="container mx-auto px-4 py-20">
        <div className="grid md:grid-cols-3 gap-8">
          <div className="text-center p-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-6">
              <Zap className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-3">{t.landing.fastTitle}</h3>
            <p className="text-muted-foreground">
              {t.landing.fastDesc}
            </p>
          </div>

          <div className="text-center p-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 mb-6">
              <Target className="w-8 h-8 text-accent" />
            </div>
            <h3 className="text-xl font-semibold mb-3">{t.landing.qualityTitle}</h3>
            <p className="text-muted-foreground">
              {t.landing.qualityDesc}
            </p>
          </div>

          <div className="text-center p-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-green-500/10 mb-6">
              <Workflow className="w-8 h-8 text-green-600 dark:text-green-500" />
            </div>
            <h3 className="text-xl font-semibold mb-3">{t.landing.integrationTitle}</h3>
            <p className="text-muted-foreground">
              {t.landing.integrationDesc}
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t mt-20">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="w-4 h-4 text-primary" />
            <span>{t.landing.footer}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
