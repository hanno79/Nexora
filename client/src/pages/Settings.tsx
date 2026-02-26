import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Save, Check, Link2, Sun, Moon, Monitor, Brain, RefreshCw, Languages, Search, BarChart3, Coins, Zap, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TopBar } from "@/components/TopBar";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { QueryError } from "@/components/QueryError";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useMutationErrorHandler } from "@/hooks/useMutationErrorHandler";
import { useTheme } from "@/components/ThemeProvider";
import { useTranslation } from "@/lib/i18n";
import { useDebounce } from "@/hooks/useDebounce";

export default function Settings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const onMutationError = useMutationErrorHandler();
  
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [uiLanguage, setUiLanguage] = useState("auto");
  const [defaultContentLanguage, setDefaultContentLanguage] = useState("auto");
  const [generatorModel, setGeneratorModel] = useState("google/gemini-2.5-flash");
  const [reviewerModel, setReviewerModel] = useState("anthropic/claude-sonnet-4");
  const [fallbackModel, setFallbackModel] = useState("deepseek/deepseek-r1-0528:free");
  const [aiTier, setAiTier] = useState<"development" | "production" | "premium">("production");
  const [modelFilter, setModelFilter] = useState<'all' | 'free' | 'paid'>('all');
  const [modelSearch, setModelSearch] = useState('');
  const [tierDefaults, setTierDefaults] = useState<{
    development?: { generator?: string; reviewer?: string };
    production?: { generator?: string; reviewer?: string };
    premium?: { generator?: string; reviewer?: string };
  }>({});
  const [savedTierModels, setSavedTierModels] = useState<Record<string, { generatorModel?: string; reviewerModel?: string; fallbackModel?: string }>>({});
  const [iterativeMode, setIterativeMode] = useState(false);
  const [iterationCount, setIterationCount] = useState(3);
  const [iterativeTimeoutMinutes, setIterativeTimeoutMinutes] = useState(30);
  const [useFinalReview, setUseFinalReview] = useState(false);
  const [guidedQuestionRounds, setGuidedQuestionRounds] = useState(3);

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || "");
      setLastName(user.lastName || "");
      setCompany(user.company || "");
      setRole(user.role || "");
      setUiLanguage(user.uiLanguage || "auto");
      setDefaultContentLanguage(user.defaultContentLanguage || "auto");
    }
  }, [user]);

  const { data: linearStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/linear/status"],
  });

  const { data: dartStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/dart/status"],
  });

  const { data: openRouterData, isLoading: modelsLoading, error: modelsError, refetch: refetchModels } = useQuery<{
    models: Array<{
      id: string;
      name: string;
      pricing: { prompt: string; completion: string };
      context_length: number;
      isFree: boolean;
      provider: string;
    }>;
    tierDefaults: {
      development: { generator: string; reviewer: string; cost: string };
      production: { generator: string; reviewer: string; cost: string };
      premium: { generator: string; reviewer: string; cost: string };
    };
  }>({
    queryKey: ["/api/openrouter/models"],
  });

  const { data: aiPreferences } = useQuery<{
    generatorModel?: string;
    reviewerModel?: string;
    fallbackModel?: string;
    tier?: "development" | "production" | "premium";
    tierModels?: Record<string, { generatorModel?: string; reviewerModel?: string; fallbackModel?: string }>;
    tierDefaults?: {
      development?: { generator?: string; reviewer?: string };
      production?: { generator?: string; reviewer?: string };
      premium?: { generator?: string; reviewer?: string };
    };
    iterativeMode?: boolean;
    iterationCount?: number;
    iterativeTimeoutMinutes?: number;
    useFinalReview?: boolean;
    guidedQuestionRounds?: number;
  }>({
    queryKey: ["/api/settings/ai"],
  });

  const lastSavedModelKeyRef = useRef<string>('');
  const aiPrefsLoadedRef = useRef(false);

  useEffect(() => {
    if (aiPreferences) {
      const tm = aiPreferences.tierModels || {};
      setSavedTierModels(tm);
      setGeneratorModel(aiPreferences.generatorModel || "google/gemini-2.5-flash");
      setReviewerModel(aiPreferences.reviewerModel || "anthropic/claude-sonnet-4");
      setFallbackModel(aiPreferences.fallbackModel || "deepseek/deepseek-r1-0528:free");
      setAiTier(aiPreferences.tier || "production");
      setTierDefaults(aiPreferences.tierDefaults || {});
      setIterativeMode(aiPreferences.iterativeMode || false);
      setIterationCount(aiPreferences.iterationCount || 3);
      setIterativeTimeoutMinutes(aiPreferences.iterativeTimeoutMinutes || 30);
      setUseFinalReview(aiPreferences.useFinalReview || false);
      setGuidedQuestionRounds(aiPreferences.guidedQuestionRounds || 3);

      // Snapshot the loaded state so auto-save doesn't fire on initial load
      lastSavedModelKeyRef.current = JSON.stringify({
        generatorModel: aiPreferences.generatorModel || "google/gemini-2.5-flash",
        reviewerModel: aiPreferences.reviewerModel || "anthropic/claude-sonnet-4",
        fallbackModel: aiPreferences.fallbackModel || "deepseek/deepseek-r1-0528:free",
        aiTier: aiPreferences.tier || "production",
      });
      aiPrefsLoadedRef.current = true;
    }
  }, [aiPreferences]);

  // Auto-save AI model settings with debounce
  const aiModelSettingsKey = JSON.stringify({ generatorModel, reviewerModel, fallbackModel, aiTier });
  const debouncedModelSettings = useDebounce(aiModelSettingsKey, 1500);

  const filteredModels = (openRouterData?.models || []).filter(m => {
    const matchesFilter = modelFilter === 'all' || 
      (modelFilter === 'free' && m.isFree) || 
      (modelFilter === 'paid' && !m.isFree);
    const matchesSearch = !modelSearch || 
      m.name.toLowerCase().includes(modelSearch.toLowerCase()) || 
      m.id.toLowerCase().includes(modelSearch.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const tierFallbackDefaults: Record<string, string> = {
    development: "meta-llama/llama-3.3-70b-instruct:free",
    production: "deepseek/deepseek-r1-0528:free",
    premium: "deepseek/deepseek-r1-0528:free",
  };

  const handleTierChange = (value: "development" | "production" | "premium") => {
    const nextSaved = {
      ...savedTierModels,
      [aiTier]: { generatorModel, reviewerModel, fallbackModel },
    };
    setSavedTierModels(nextSaved);

    setAiTier(value);

    const saved = nextSaved[value];
    if (saved?.generatorModel || saved?.reviewerModel || saved?.fallbackModel) {
      if (saved.generatorModel) setGeneratorModel(saved.generatorModel);
      if (saved.reviewerModel) setReviewerModel(saved.reviewerModel);
      if (saved.fallbackModel) setFallbackModel(saved.fallbackModel);
    } else {
      const systemDefaults = openRouterData?.tierDefaults?.[value];
      if (systemDefaults?.generator) setGeneratorModel(systemDefaults.generator);
      if (systemDefaults?.reviewer) setReviewerModel(systemDefaults.reviewer);
      setFallbackModel(tierFallbackDefaults[value] || "deepseek/deepseek-r1-0528:free");
    }
  };

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PATCH", "/api/auth/user", {
        firstName,
        lastName,
        company,
        role,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: t.common.success,
        description: t.settings.profileUpdated,
      });
    },
    onError: onMutationError,
  });

  const updateLanguageSettingsMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PATCH", "/api/settings/language", {
        uiLanguage,
        defaultContentLanguage,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: t.settings.changesSaved,
        description: t.settings.changesSaved,
      });
      // Reload to apply UI language change
      setTimeout(() => window.location.reload(), 500);
    },
    onError: onMutationError,
  });

  const updateAiSettingsMutation = useMutation({
    mutationFn: async (modelSettingsKey?: string) => {
      const modelSettings = modelSettingsKey
        ? JSON.parse(modelSettingsKey) as {
            generatorModel?: string;
            reviewerModel?: string;
            fallbackModel?: string;
            aiTier?: "development" | "production" | "premium";
          }
        : {};
      const generatorModelToSave = modelSettings.generatorModel || generatorModel;
      const reviewerModelToSave = modelSettings.reviewerModel || reviewerModel;
      const fallbackModelToSave = modelSettings.fallbackModel || fallbackModel;
      const tierToSave = modelSettings.aiTier || aiTier;
      const currentTierModels = {
        ...savedTierModels,
        [tierToSave]: {
          generatorModel: generatorModelToSave,
          reviewerModel: reviewerModelToSave,
          fallbackModel: fallbackModelToSave,
        },
      };
      return await apiRequest("PATCH", "/api/settings/ai", {
        generatorModel: generatorModelToSave,
        reviewerModel: reviewerModelToSave,
        fallbackModel: fallbackModelToSave,
        tier: tierToSave,
        tierModels: currentTierModels,
        tierDefaults,
        iterativeMode,
        iterationCount: Math.min(5, Math.max(2, iterationCount)),
        iterativeTimeoutMinutes: Math.min(120, Math.max(5, iterativeTimeoutMinutes)),
        useFinalReview,
        guidedQuestionRounds: Math.min(10, Math.max(1, guidedQuestionRounds)),
      });
    },
    onSuccess: () => {
      setSavedTierModels(prev => ({
        ...prev,
        [aiTier]: { generatorModel, reviewerModel, fallbackModel },
      }));
      queryClient.invalidateQueries({ queryKey: ["/api/settings/ai"] });
      toast({
        title: t.common.success,
        description: t.settings.aiPreferencesSaved,
      });
    },
    onError: onMutationError,
  });
  const { mutateAsync } = updateAiSettingsMutation;

  useEffect(() => {
    if (!aiPrefsLoadedRef.current) return;
    if (debouncedModelSettings === lastSavedModelKeyRef.current) return;
    void mutateAsync(debouncedModelSettings, {
      onSuccess: () => {
        lastSavedModelKeyRef.current = debouncedModelSettings;
      },
      onError: () => {
        // Keep ref unchanged so next debounce can retry.
      },
    });
  }, [debouncedModelSettings, mutateAsync]);

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      
      <div className="container max-w-4xl mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 md:py-8">
        <h1 className="text-2xl sm:text-3xl font-semibold mb-6 sm:mb-8">{t.settings.title}</h1>

        <div className="space-y-4 sm:space-y-6">
          {/* Profileinstellungen */}
          <Card>
            <CardHeader>
              <CardTitle>{t.settings.profileInformation}</CardTitle>
              <CardDescription>
                {t.settings.profileDesc}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">{t.settings.firstName}</Label>
                  <Input
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    maxLength={100}
                    data-testid="input-first-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">{t.settings.lastName}</Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    maxLength={100}
                    data-testid="input-last-name"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">{t.settings.email}</Label>
                <Input
                  id="email"
                  value={user?.email || ""}
                  disabled
                  className="bg-muted"
                  data-testid="input-email"
                />
                <p className="text-xs text-muted-foreground">
                  {t.settings.emailCannotChange}
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="company">{t.settings.company}</Label>
                  <Input
                    id="company"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    maxLength={200}
                    placeholder={t.settings.companyPlaceholder}
                    data-testid="input-company"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">{t.settings.role}</Label>
                  <Input
                    id="role"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    maxLength={100}
                    placeholder={t.settings.rolePlaceholder}
                    data-testid="input-role"
                  />
                </div>
              </div>

              <Button
                onClick={() => updateProfileMutation.mutate()}
                disabled={updateProfileMutation.isPending}
                data-testid="button-save-profile"
              >
                <Save className="w-4 h-4 mr-2" />
                {updateProfileMutation.isPending ? t.settings.saving : t.settings.saveProfile}
              </Button>
            </CardContent>
          </Card>

          {/* Erscheinungsbild */}
          <Card>
            <CardHeader>
              <CardTitle>{t.settings.appearance}</CardTitle>
              <CardDescription>
                {t.settings.appearanceDesc}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <Label>{t.settings.theme}</Label>
                <RadioGroup 
                  value={theme} 
                  onValueChange={(value) => setTheme(value as "light" | "dark" | "system")}
                  className="grid grid-cols-3 gap-4"
                >
                  <div>
                    <RadioGroupItem
                      value="light"
                      id="theme-light"
                      className="peer sr-only"
                      data-testid="radio-theme-light"
                    />
                    <Label
                      htmlFor="theme-light"
                      className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover-elevate peer-data-[state=checked]:border-primary cursor-pointer"
                      data-testid="label-theme-light"
                    >
                      <Sun className="mb-3 h-6 w-6" />
                      <span className="text-sm font-medium">{t.settings.light}</span>
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem
                      value="dark"
                      id="theme-dark"
                      className="peer sr-only"
                      data-testid="radio-theme-dark"
                    />
                    <Label
                      htmlFor="theme-dark"
                      className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover-elevate peer-data-[state=checked]:border-primary cursor-pointer"
                      data-testid="label-theme-dark"
                    >
                      <Moon className="mb-3 h-6 w-6" />
                      <span className="text-sm font-medium">{t.settings.dark}</span>
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem
                      value="system"
                      id="theme-system"
                      className="peer sr-only"
                      data-testid="radio-theme-system"
                    />
                    <Label
                      htmlFor="theme-system"
                      className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover-elevate peer-data-[state=checked]:border-primary cursor-pointer"
                      data-testid="label-theme-system"
                    >
                      <Monitor className="mb-3 h-6 w-6" />
                      <span className="text-sm font-medium">{t.settings.system}</span>
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            </CardContent>
          </Card>

          {/* Spracheinstellungen */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Languages className="w-5 h-5" />
                {t.settings.language}
              </CardTitle>
              <CardDescription>
                {t.settings.languageSettingsDesc}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="ui-language">{t.settings.uiLanguage}</Label>
                  <Select value={uiLanguage} onValueChange={setUiLanguage}>
                    <SelectTrigger id="ui-language" data-testid="select-ui-language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">{t.languages.auto}</SelectItem>
                      <SelectItem value="en">{t.languages.en}</SelectItem>
                      <SelectItem value="de">{t.languages.de}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t.settings.uiLanguageDesc}
                  </p>
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label htmlFor="content-language">{t.settings.contentLanguage}</Label>
                  <Select value={defaultContentLanguage} onValueChange={setDefaultContentLanguage}>
                    <SelectTrigger id="content-language" data-testid="select-content-language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">{t.languages.auto}</SelectItem>
                      <SelectItem value="en">{t.languages.en}</SelectItem>
                      <SelectItem value="de">{t.languages.de}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t.settings.contentLanguageDesc}
                  </p>
                </div>
              </div>

              <Button
                onClick={() => updateLanguageSettingsMutation.mutate()}
                disabled={updateLanguageSettingsMutation.isPending}
                data-testid="button-save-language-settings"
              >
                <Save className="w-4 h-4 mr-2" />
                {updateLanguageSettingsMutation.isPending ? t.settings.saving : t.settings.saveChanges}
              </Button>
            </CardContent>
          </Card>

          {/* KI-Modellpräferenzen */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5" />
                {t.settings.aiModelPreferences}
              </CardTitle>
              <CardDescription>
                {t.settings.aiModelPreferencesDesc}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {modelsError ? (
                <QueryError message={t.settings.aiModelsFailed} onRetry={() => refetchModels()} />
              ) : (<>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{t.settings.modelFilter}</Label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant={modelFilter === 'all' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setModelFilter('all')}
                      data-testid="button-filter-all"
                    >
                      {t.settings.allModels}
                    </Button>
                    <Button
                      variant={modelFilter === 'free' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setModelFilter('free')}
                      data-testid="button-filter-free"
                    >
                      {t.settings.freeOnly}
                    </Button>
                    <Button
                      variant={modelFilter === 'paid' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setModelFilter('paid')}
                      data-testid="button-filter-paid"
                    >
                      {t.settings.paidOnly}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="model-search">{t.settings.searchModels}</Label>
                  <Input
                    id="model-search"
                    placeholder={t.settings.searchModelsPlaceholder}
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    data-testid="input-model-search"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="generator-model">{t.settings.generatorModel}</Label>
                  <Select value={generatorModel} onValueChange={setGeneratorModel}>
                    <SelectTrigger id="generator-model" data-testid="select-generator-model">
                      <SelectValue placeholder={modelsLoading ? t.settings.loadingModels : t.settings.selectModel} />
                    </SelectTrigger>
                    <SelectContent>
                      {modelsLoading ? (
                        <SelectItem value="loading" disabled>{t.settings.loadingModels}</SelectItem>
                      ) : filteredModels.length === 0 ? (
                        <SelectItem value="none" disabled>{t.settings.noModelsFound}</SelectItem>
                      ) : (
                        filteredModels.map(m => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}{m.isFree ? ' (Free)' : ''}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t.settings.generatorModelDesc}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reviewer-model">{t.settings.reviewerModel}</Label>
                  <Select value={reviewerModel} onValueChange={setReviewerModel}>
                    <SelectTrigger id="reviewer-model" data-testid="select-reviewer-model">
                      <SelectValue placeholder={modelsLoading ? t.settings.loadingModels : t.settings.selectModel} />
                    </SelectTrigger>
                    <SelectContent>
                      {modelsLoading ? (
                        <SelectItem value="loading" disabled>{t.settings.loadingModels}</SelectItem>
                      ) : filteredModels.length === 0 ? (
                        <SelectItem value="none" disabled>{t.settings.noModelsFound}</SelectItem>
                      ) : (
                        filteredModels.map(m => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}{m.isFree ? ' (Free)' : ''}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t.settings.reviewerModelDesc}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fallback-model">{t.settings.fallbackModel}</Label>
                  <Select value={fallbackModel} onValueChange={setFallbackModel}>
                    <SelectTrigger id="fallback-model" data-testid="select-fallback-model">
                      <SelectValue placeholder={modelsLoading ? t.settings.loadingModels : t.settings.selectModel} />
                    </SelectTrigger>
                    <SelectContent>
                      {modelsLoading ? (
                        <SelectItem value="loading" disabled>{t.settings.loadingModels}</SelectItem>
                      ) : filteredModels.length === 0 ? (
                        <SelectItem value="none" disabled>{t.settings.noModelsFound}</SelectItem>
                      ) : (
                        filteredModels.map(m => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}{m.isFree ? ' (Free)' : ''}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t.settings.fallbackModelDescFull}
                  </p>
                </div>

                <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
                  <p className="text-sm font-medium">{t.settings.howFallbackWorks}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.settings.howFallbackWorksDesc}
                  </p>
                </div>

                <Separator className="my-4" />

                <div className="space-y-2">
                  <Label htmlFor="ai-tier">{t.settings.qualityTier}</Label>
                  <Select value={aiTier} onValueChange={handleTierChange}>
                    <SelectTrigger id="ai-tier" data-testid="select-ai-tier">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="development">{t.settings.tierDevelopment}</SelectItem>
                      <SelectItem value="production">{t.settings.tierProduction}</SelectItem>
                      <SelectItem value="premium">{t.settings.tierPremium}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t.settings.qualityTierDesc}
                  </p>
                </div>
              </div>

              <Separator className="my-6" />

              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4" />
                      <Label htmlFor="iterative-mode" className="text-base cursor-pointer">
                        {t.settings.iterativeWorkflow}
                      </Label>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t.settings.iterativeWorkflowDesc}
                    </p>
                  </div>
                  <Switch
                    id="iterative-mode"
                    checked={iterativeMode}
                    onCheckedChange={setIterativeMode}
                    data-testid="switch-iterative-mode"
                  />
                </div>

                {iterativeMode && (
                  <div className="space-y-4 pl-6 border-l-2 border-primary/20">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="iteration-count">
                          {t.settings.iterationCountLabel}: {iterationCount}
                        </Label>
                      </div>
                      <Slider
                        id="iteration-count"
                        min={2}
                        max={5}
                        step={1}
                        value={[iterationCount]}
                        onValueChange={(value) => setIterationCount(value[0])}
                        className="w-full"
                        data-testid="slider-iteration-count"
                      />
                      <p className="text-xs text-muted-foreground">
                        {t.settings.iterationCountDesc}
                      </p>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="iterative-timeout-minutes">
                          {t.settings.iterativeTimeoutLabel}: {iterativeTimeoutMinutes} min
                        </Label>
                      </div>
                      <Slider
                        id="iterative-timeout-minutes"
                        min={5}
                        max={120}
                        step={5}
                        value={[iterativeTimeoutMinutes]}
                        onValueChange={(value) => setIterativeTimeoutMinutes(value[0])}
                        className="w-full"
                        data-testid="slider-iterative-timeout"
                      />
                      <p className="text-xs text-muted-foreground">
                        {t.settings.iterativeTimeoutDesc}
                      </p>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="final-review" className="cursor-pointer">
                          {t.settings.finalReviewLabel}
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          {t.settings.finalReviewDesc}
                        </p>
                      </div>
                      <Switch
                        id="final-review"
                        checked={useFinalReview}
                        onCheckedChange={setUseFinalReview}
                        data-testid="switch-final-review"
                      />
                    </div>
                  </div>
                )}

                <Separator className="my-4" />

                {/* Einstellungen für den geführten Modus */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4" />
                    <Label className="text-base">{t.settings.guidedModeSettings}</Label>
                  </div>
                  <div className="space-y-3 pl-6 border-l-2 border-primary/20">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="guided-question-rounds">
                        {t.settings.questionRoundsLabel}: {guidedQuestionRounds}
                      </Label>
                    </div>
                    <Slider
                      id="guided-question-rounds"
                      min={1}
                      max={10}
                      step={1}
                      value={[guidedQuestionRounds]}
                      onValueChange={(value) => setGuidedQuestionRounds(value[0])}
                      className="w-full"
                      data-testid="slider-guided-question-rounds"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t.settings.questionRoundsDesc}
                    </p>
                  </div>
                </div>
              </div>

              <Button
                onClick={() => updateAiSettingsMutation.mutate(undefined)}
                disabled={updateAiSettingsMutation.isPending}
                data-testid="button-save-ai-settings"
              >
                <Save className="w-4 h-4 mr-2" />
                {updateAiSettingsMutation.isPending ? t.settings.saving : t.settings.saveAiPreferences}
              </Button>
              </>)}
            </CardContent>
          </Card>

          {/* KI-Nutzung & Kosten */}
          <AiUsageSection />

          {/* Linear-Integration */}
          <Card>
            <CardHeader>
              <CardTitle>{t.integrations.linear.title}</CardTitle>
              <CardDescription>
                {t.integrations.linear.description}
              </CardDescription>
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
              <CardDescription>
                {t.integrations.dart.description}
              </CardDescription>
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

interface UsageStats {
  totalCost: string;
  totalCalls: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byTier: Record<string, { calls: number; tokens: number; cost: number }>;
  byModel: Record<string, { calls: number; tokens: number; cost: number }>;
  recentCalls: Array<{
    id: string;
    model: string;
    modelType: string;
    tier: string;
    inputTokens: number;
    outputTokens: number;
    totalCost: string;
    prdId: string | null;
    createdAt: string | null;
  }>;
}

function AiUsageSection() {
  const { t } = useTranslation();
  const [usagePeriod, setUsagePeriod] = useState<string>('all');

  const getSinceDate = (period: string): string | null => {
    if (period === 'all') return null;
    const now = new Date();
    if (period === 'today') {
      now.setHours(0, 0, 0, 0);
      return now.toISOString();
    }
    if (period === '7d') {
      now.setDate(now.getDate() - 7);
      return now.toISOString();
    }
    if (period === '30d') {
      now.setDate(now.getDate() - 30);
      return now.toISOString();
    }
    return null;
  };

  const sinceDate = getSinceDate(usagePeriod);
  const queryUrl = sinceDate ? `/api/ai/usage?since=${encodeURIComponent(sinceDate)}` : '/api/ai/usage';

  const { data: stats, isLoading, error, refetch } = useQuery<UsageStats>({
    queryKey: ['/api/ai/usage', usagePeriod],
    queryFn: async () => {
      const res = await apiRequest("GET", queryUrl);
      return res.json();
    },
  });

  const periodButtons = [
    { value: 'all', label: t.settings.allTime },
    { value: 'today', label: t.settings.today },
    { value: '7d', label: t.settings.last7Days },
    { value: '30d', label: t.settings.last30Days },
  ];

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  const formatDate = (d: string | null) => {
    if (!d) return '-';
    const date = new Date(d);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const tierColor = (tier: string) => {
    switch (tier) {
      case 'development': return 'bg-green-500/10 text-green-700 dark:text-green-400';
      case 'production': return 'bg-blue-500/10 text-blue-700 dark:text-blue-400';
      case 'premium': return 'bg-purple-500/10 text-purple-700 dark:text-purple-400';
      default: return '';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          {t.settings.aiUsage}
        </CardTitle>
        <CardDescription>
          {t.settings.aiUsageDesc}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Zeitraumfilter */}
        <div className="flex flex-wrap gap-1">
          {periodButtons.map((btn) => (
            <Button
              key={btn.value}
              variant={usagePeriod === btn.value ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setUsagePeriod(btn.value)}
              data-testid={`usage-filter-${btn.value}`}
            >
              {btn.label}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t.settings.loadingUsage}</div>
        ) : error ? (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{t.settings.failedLoadUsage}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              data-testid="button-retry-usage"
            >
              {t.settings.retry}
            </Button>
          </div>
        ) : !stats || stats.totalCalls === 0 ? (
          <div className="text-sm text-muted-foreground">
            {usagePeriod === 'all' ? t.settings.noUsageAll : t.settings.noUsagePeriod}
          </div>
        ) : (
          <>
            {/* Zusammenfassungskarten */}
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4 text-amber-500" />
                  <span className="text-xs text-muted-foreground">{t.settings.totalCalls}</span>
                </div>
                <p className="text-2xl font-bold">{stats.totalCalls}</p>
              </div>
              <div className="p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="w-4 h-4 text-blue-500" />
                  <span className="text-xs text-muted-foreground">{t.settings.totalTokens}</span>
                </div>
                <p className="text-2xl font-bold">{formatTokens(stats.totalTokens)}</p>
              </div>
              <div className="p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-2 mb-1">
                  <Coins className="w-4 h-4 text-green-500" />
                  <span className="text-xs text-muted-foreground">{t.settings.estimatedCost}</span>
                </div>
                <p className="text-2xl font-bold">${parseFloat(stats.totalCost).toFixed(2)}</p>
              </div>
            </div>

            {/* Aufschlüsselung nach Tarifstufe */}
            <div>
              <h4 className="text-sm font-medium mb-2">{t.settings.byTier}</h4>
              <div className="flex flex-wrap gap-2">
                {Object.entries(stats.byTier).map(([tier, data]) => (
                  <div key={tier} className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium ${tierColor(tier)}`}>
                    <span className="capitalize">{tier}</span>
                    <span className="opacity-70">{data.calls} {t.settings.calls}</span>
                    <span className="opacity-70">{formatTokens(data.tokens)} {t.settings.tokens}</span>
                    {data.cost > 0 && <span className="opacity-70">${data.cost.toFixed(2)}</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Tabelle der letzten Aufrufe */}
            <div>
              <h4 className="text-sm font-medium mb-2">{t.settings.recentCalls}</h4>
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">{t.settings.tableDate}</TableHead>
                      <TableHead className="text-xs">{t.settings.tableModel}</TableHead>
                      <TableHead className="text-xs">{t.settings.tableType}</TableHead>
                      <TableHead className="text-xs">{t.settings.tableTier}</TableHead>
                      <TableHead className="text-xs text-right">{t.settings.tableTokens}</TableHead>
                      <TableHead className="text-xs text-right">{t.settings.tableCost}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.recentCalls.map((call) => (
                      <TableRow key={call.id}>
                        <TableCell className="text-xs text-muted-foreground">{formatDate(call.createdAt)}</TableCell>
                        <TableCell className="text-xs font-mono">
                          {(call.model || 'unknown').split('/').pop()}
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {call.modelType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${tierColor(call.tier)}`}>
                            {call.tier}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono">
                          {formatTokens(call.inputTokens + call.outputTokens)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono">
                          ${parseFloat(call.totalCost || '0').toFixed(4)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
