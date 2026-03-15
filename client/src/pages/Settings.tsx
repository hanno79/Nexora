/**
 * Author: rahn
 * Datum: 03.03.2026
 * Version: 2.0
 * Beschreibung: Settings Page - Refactored in kleinere Komponenten
 * 
 * ÄNDERUNG 03.03.2026: Datei aufgeteilt in kleinere Sektions-Komponenten
 * um das 500-Zeilen-Limit einzuhalten (Regel 1)
 */

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link2, Check, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { TopBar } from "@/components/TopBar";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import type { AIProvider } from "@/components/ProviderFilter";

// Settings Sektions-Komponenten
import {
  ProfileSettingsSection,
  AppearanceSettingsSection,
  LanguageSettingsSection,
  AiModelSettingsSection,
  ProviderFilterSection,
  AiUsageSection,
  CompilerRunMetricsSection,
  ModelAnalyticsSection,
} from "@/components/settings";

export default function Settings() {
  const { t } = useTranslation();
  const { user } = useAuth();

  // Provider-Filter State
  const [selectedProviders, setSelectedProviders] = useState<AIProvider[]>(['openrouter', 'groq', 'cerebras', 'nvidia', 'abacus']);

  // Fetch provider data
  const { data: providersData } = useQuery<{
    providers: Array<{
      id: AIProvider;
      name: string;
      displayName: string;
      icon: string;
      color: string;
      configured: boolean;
      apiKeyEnv: string;
    }>;
  }>({
    queryKey: ["/api/providers"],
  });

  // Fetch all models data for provider filter section
  const { data: allModelsData, isLoading: allModelsLoading } = useQuery<{
    models: Array<{
      id: string;
      name: string;
      provider: AIProvider;
      contextLength: number;
      isFree: boolean;
      pricing: { input: number; output: number };
      capabilities: string[];
      description?: string;
    }>;
    providers: AIProvider[];
    totalCount: number;
    freeCount: number;
  }>({
    queryKey: ["/api/models", selectedProviders.join(',')],
    queryFn: async () => {
      const providersParam = selectedProviders.join(',');
      const res = await apiRequest("GET", `/api/models?providers=${providersParam}`);
      return res.json();
    },
  });

  // Fetch integration statuses
  const { data: linearStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/linear/status"],
  });

  const { data: dartStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/dart/status"],
  });

  return (
    <div className="min-h-screen bg-background">
      <TopBar />

      <div className="container max-w-4xl mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 md:py-8">
        <h1 className="text-2xl sm:text-3xl font-semibold mb-6 sm:mb-8">{t.settings.title}</h1>

        <div className="space-y-4 sm:space-y-6">
          {/* Profileinstellungen */}
          <ProfileSettingsSection user={user} />

          {/* Erscheinungsbild */}
          <AppearanceSettingsSection />

          {/* Spracheinstellungen */}
          <LanguageSettingsSection
            initialUiLanguage={user?.uiLanguage || "auto"}
            initialContentLanguage={user?.defaultContentLanguage || "auto"}
          />

          {/* KI-Modellpräferenzen */}
          <AiModelSettingsSection
            providers={providersData?.providers || []}
            selectedProviders={selectedProviders}
          />

          {/* AI Provider Filter */}
          <ProviderFilterSection
            providers={providersData?.providers || []}
            selectedProviders={selectedProviders}
            onChange={setSelectedProviders}
            isLoading={allModelsLoading}
            totalCount={allModelsData?.totalCount}
            freeCount={allModelsData?.freeCount}
          />

          {/* KI-Nutzung & Kosten */}
          <AiUsageSection />

          {/* Compiler-Run-Metriken */}
          <CompilerRunMetricsSection />

          {/* Modell-Analytik */}
          <ModelAnalyticsSection />

          {/* Linear-Integration */}
          <Card>
            <CardHeader>
              <CardTitle>{t.integrations.linear.title}</CardTitle>
              <CardDescription>{t.integrations.linear.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                    <Link2 className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{t.integrations.linear.workspace}</p>
                    <p className="text-sm text-muted-foreground">
                      {linearStatus?.connected ? t.integrations.linear.connected : t.integrations.linear.notConnected}
                    </p>
                  </div>
                </div>
                {linearStatus?.connected ? (
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-500">
                    <Check className="w-5 h-5" />
                    <span className="text-sm font-medium">{t.integrations.linear.connected}</span>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" disabled data-testid="button-connect-linear">
                    {t.integrations.linear.configure}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t.integrations.linear.helpText}
              </p>
            </CardContent>
          </Card>

          {/* Dart-AI-Integration */}
          <Card>
            <CardHeader>
              <CardTitle>{t.integrations.dart.title}</CardTitle>
              <CardDescription>{t.integrations.dart.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                    <Brain className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{t.integrations.dart.workspace}</p>
                    <p className="text-sm text-muted-foreground">
                      {dartStatus?.connected ? t.integrations.dart.connected : t.integrations.dart.notConnected}
                    </p>
                  </div>
                </div>
                {dartStatus?.connected ? (
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-500">
                    <Check className="w-5 h-5" />
                    <span className="text-sm font-medium">{t.integrations.dart.connected}</span>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" disabled data-testid="button-connect-dart">
                    {t.integrations.dart.configure}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t.integrations.dart.helpText}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
