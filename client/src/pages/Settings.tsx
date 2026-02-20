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
import { isUnauthorizedError } from "@/lib/authUtils";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/components/ThemeProvider";
import { useTranslation } from "@/lib/i18n";
import { useDebounce } from "@/hooks/useDebounce";

export default function Settings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  
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
        title: "Success",
        description: "Profile updated successfully",
      });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: error.message || "Failed to update profile",
        variant: "destructive",
      });
    },
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
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: t.common.error,
        description: error.message || t.settings.changesFailed,
        variant: "destructive",
      });
    },
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
        iterationCount,
        iterativeTimeoutMinutes,
        useFinalReview,
        guidedQuestionRounds,
      });
    },
    onSuccess: () => {
      setSavedTierModels(prev => ({
        ...prev,
        [aiTier]: { generatorModel, reviewerModel, fallbackModel },
      }));
      queryClient.invalidateQueries({ queryKey: ["/api/settings/ai"] });
      toast({
        title: "Success",
        description: "AI preferences saved successfully",
      });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: error.message || "Failed to update AI preferences",
        variant: "destructive",
      });
    },
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
        <h1 className="text-2xl sm:text-3xl font-semibold mb-6 sm:mb-8">Settings</h1>

        <div className="space-y-4 sm:space-y-6">
          {/* Profile Settings */}
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>
                Update your personal information and preferences
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    data-testid="input-first-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    data-testid="input-last-name"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  value={user?.email || ""}
                  disabled
                  className="bg-muted"
                  data-testid="input-email"
                />
                <p className="text-xs text-muted-foreground">
                  Email cannot be changed
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="company">Company</Label>
                  <Input
                    id="company"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Optional"
                    data-testid="input-company"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <Input
                    id="role"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder="e.g., Product Manager"
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
                {updateProfileMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </CardContent>
          </Card>

          {/* Appearance */}
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>
                Customize how NEXORA looks on your device
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <Label>Theme</Label>
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
                      <span className="text-sm font-medium">Light</span>
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
                      <span className="text-sm font-medium">Dark</span>
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
                      <span className="text-sm font-medium">System</span>
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            </CardContent>
          </Card>

          {/* Language Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Languages className="w-5 h-5" />
                {t.settings.language}
              </CardTitle>
              <CardDescription>
                Configure interface and content languages separately
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
                {updateLanguageSettingsMutation.isPending ? "Saving..." : t.settings.saveChanges}
              </Button>
            </CardContent>
          </Card>

          {/* AI Model Preferences */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5" />
                AI Model Preferences
              </CardTitle>
              <CardDescription>
                Configure which AI models are used for PRD generation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {modelsError ? (
                <QueryError message="Failed to load AI models." onRetry={() => refetchModels()} />
              ) : (<>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Model Filter</Label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant={modelFilter === 'all' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setModelFilter('all')}
                      data-testid="button-filter-all"
                    >
                      All Models
                    </Button>
                    <Button
                      variant={modelFilter === 'free' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setModelFilter('free')}
                      data-testid="button-filter-free"
                    >
                      Free Only
                    </Button>
                    <Button
                      variant={modelFilter === 'paid' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setModelFilter('paid')}
                      data-testid="button-filter-paid"
                    >
                      Paid Only
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="model-search">Search Models</Label>
                  <Input
                    id="model-search"
                    placeholder="Search by model name or ID..."
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    data-testid="input-model-search"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="generator-model">Generator Model</Label>
                  <Select value={generatorModel} onValueChange={setGeneratorModel}>
                    <SelectTrigger id="generator-model" data-testid="select-generator-model">
                      <SelectValue placeholder={modelsLoading ? "Loading models..." : "Select a model"} />
                    </SelectTrigger>
                    <SelectContent>
                      {modelsLoading ? (
                        <SelectItem value="loading" disabled>Loading models...</SelectItem>
                      ) : filteredModels.length === 0 ? (
                        <SelectItem value="none" disabled>No models found</SelectItem>
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
                    The model that generates initial PRD content
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reviewer-model">Reviewer Model</Label>
                  <Select value={reviewerModel} onValueChange={setReviewerModel}>
                    <SelectTrigger id="reviewer-model" data-testid="select-reviewer-model">
                      <SelectValue placeholder={modelsLoading ? "Loading models..." : "Select a model"} />
                    </SelectTrigger>
                    <SelectContent>
                      {modelsLoading ? (
                        <SelectItem value="loading" disabled>Loading models...</SelectItem>
                      ) : filteredModels.length === 0 ? (
                        <SelectItem value="none" disabled>No models found</SelectItem>
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
                    The model that critically reviews and improves content
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fallback-model">Fallback Model</Label>
                  <Select value={fallbackModel} onValueChange={setFallbackModel}>
                    <SelectTrigger id="fallback-model" data-testid="select-fallback-model">
                      <SelectValue placeholder={modelsLoading ? "Loading models..." : "Select a model"} />
                    </SelectTrigger>
                    <SelectContent>
                      {modelsLoading ? (
                        <SelectItem value="loading" disabled>Loading models...</SelectItem>
                      ) : filteredModels.length === 0 ? (
                        <SelectItem value="none" disabled>No models found</SelectItem>
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
                    Last resort if both Generator and Reviewer models fail. A free model is recommended here.
                  </p>
                </div>

                <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
                  <p className="text-sm font-medium">How fallback works</p>
                  <p className="text-xs text-muted-foreground">
                    If the primary model for the current role fails, the system tries the configured Fallback model, then the tier default for that same role. Cross-role fallback is disabled by default. If all options fail, you get a clear error message with the tried models.
                  </p>
                </div>

                <Separator className="my-4" />

                <div className="space-y-2">
                  <Label htmlFor="ai-tier">Quality Tier (Preset)</Label>
                  <Select value={aiTier} onValueChange={handleTierChange}>
                    <SelectTrigger id="ai-tier" data-testid="select-ai-tier">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="development">Development (Free/Low-cost)</SelectItem>
                      <SelectItem value="production">Production (Balanced)</SelectItem>
                      <SelectItem value="premium">Premium (Highest Quality)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Selecting a tier fills all 3 model slots with recommended defaults for that quality level.
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
                        Iterative Workflow Mode
                      </Label>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      AI #1 asks questions, AI #2 answers with best practices
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
                          Iteration Count: {iterationCount}
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
                        Number of Q&A cycles between AI #1 and AI #2 (2-5 iterations)
                      </p>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="iterative-timeout-minutes">
                          Iterative Timeout: {iterativeTimeoutMinutes} min
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
                        Maximum wait time in the UI for iterative generation (5-120 minutes)
                      </p>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="final-review" className="cursor-pointer">
                          Final Review (AI #3)
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          Optional final quality check and polish
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

                {/* Guided Mode Settings */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4" />
                    <Label className="text-base">Guided Mode Settings</Label>
                  </div>
                  <div className="space-y-3 pl-6 border-l-2 border-primary/20">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="guided-question-rounds">
                        Question Rounds: {guidedQuestionRounds}
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
                      Maximum number of question rounds in Guided Mode (1-10 rounds)
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
                {updateAiSettingsMutation.isPending ? "Saving..." : "Save AI Preferences"}
              </Button>
              </>)}
            </CardContent>
          </Card>

          {/* AI Usage & Costs */}
          <AiUsageSection />

          {/* Linear Integration */}
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

          {/* Dart AI Integration */}
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

  const { data: stats, isLoading } = useQuery<UsageStats>({
    queryKey: ['/api/ai/usage', usagePeriod],
    queryFn: async () => {
      const res = await apiRequest("GET", queryUrl);
      return res.json();
    },
  });

  const periodButtons = [
    { value: 'all', label: 'All Time' },
    { value: 'today', label: 'Today' },
    { value: '7d', label: 'Last 7 Days' },
    { value: '30d', label: 'Last 30 Days' },
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
          AI Usage & Costs
        </CardTitle>
        <CardDescription>
          Track your AI model usage, token consumption, and estimated costs
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Time Period Filter */}
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
          <div className="text-sm text-muted-foreground">Loading usage data...</div>
        ) : !stats || stats.totalCalls === 0 ? (
          <div className="text-sm text-muted-foreground">
            {usagePeriod === 'all' ? 'No AI usage recorded yet.' : 'No usage data for this period.'}
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4 text-amber-500" />
                  <span className="text-xs text-muted-foreground">Total Calls</span>
                </div>
                <p className="text-2xl font-bold">{stats.totalCalls}</p>
              </div>
              <div className="p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="w-4 h-4 text-blue-500" />
                  <span className="text-xs text-muted-foreground">Total Tokens</span>
                </div>
                <p className="text-2xl font-bold">{formatTokens(stats.totalTokens)}</p>
              </div>
              <div className="p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-2 mb-1">
                  <Coins className="w-4 h-4 text-green-500" />
                  <span className="text-xs text-muted-foreground">Est. Cost</span>
                </div>
                <p className="text-2xl font-bold">${parseFloat(stats.totalCost).toFixed(2)}</p>
              </div>
            </div>

            {/* Tier Breakdown */}
            <div>
              <h4 className="text-sm font-medium mb-2">By Tier</h4>
              <div className="flex flex-wrap gap-2">
                {Object.entries(stats.byTier).map(([tier, data]) => (
                  <div key={tier} className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium ${tierColor(tier)}`}>
                    <span className="capitalize">{tier}</span>
                    <span className="opacity-70">{data.calls} calls</span>
                    <span className="opacity-70">{formatTokens(data.tokens)} tokens</span>
                    {data.cost > 0 && <span className="opacity-70">${data.cost.toFixed(2)}</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Calls Table */}
            <div>
              <h4 className="text-sm font-medium mb-2">Recent Calls</h4>
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Date</TableHead>
                      <TableHead className="text-xs">Model</TableHead>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs">Tier</TableHead>
                      <TableHead className="text-xs text-right">Tokens</TableHead>
                      <TableHead className="text-xs text-right">Cost</TableHead>
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
