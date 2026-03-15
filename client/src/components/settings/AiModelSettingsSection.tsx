/**
 * Author: rahn
 * Datum: 03.03.2026
 * Version: 1.0
 * Beschreibung: AI Modell Einstellungen Sektion
 */

import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Save, Brain, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { apiRequest } from "@/lib/queryClient";
import { QueryError } from "@/components/QueryError";
import { useToast } from "@/hooks/use-toast";
import { useMutationErrorHandler } from "@/hooks/useMutationErrorHandler";
import { useTranslation } from "@/lib/i18n";
import { useDebounce } from "@/hooks/useDebounce";
import type { AIProvider } from "@/components/ProviderFilter";
import { AiModelDisplayLabel } from "./AiModelDisplayLabel";
import {
  buildAiModelSettingsKey,
  buildAiSettingsPayload,
  buildTierModelSelection,
  DEFAULT_FALLBACK_CHAIN,
  DEFAULT_GENERATOR_MODEL,
  DEFAULT_REVIEWER_MODEL,
  DEFAULT_VERIFIER_MODEL,
  DEFAULT_SEMANTIC_REPAIR_MODEL,
  resolveInitialAiModelSettingsState,
  resolveTierModelSelection,
  type AiPreferencesResponse,
  type AiTier,
  type TierDefaults,
  type TierModelSelection,
} from "./aiModelSettingsHelpers";

interface AiModelSettingsSectionProps {
  providers: Array<{
    id: AIProvider;
    displayName: string;
    color: string;
  }>;
  selectedProviders: AIProvider[];
}

type AvailableModel = {
  id: string;
  name: string;
  provider: AIProvider;
  contextLength: number;
  isFree: boolean;
  pricing: { input: number; output: number };
  capabilities: string[];
  description?: string;
};

const blockedModelIds = new Set(['deepseek/deepseek-r1-0528:free']);

export function AiModelSettingsSection({ providers, selectedProviders }: AiModelSettingsSectionProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const onMutationError = useMutationErrorHandler();

  // Model states
  const [generatorModel, setGeneratorModel] = useState(DEFAULT_GENERATOR_MODEL);
  const [reviewerModel, setReviewerModel] = useState(DEFAULT_REVIEWER_MODEL);
  const [verifierModel, setVerifierModel] = useState(DEFAULT_VERIFIER_MODEL);
  const [semanticRepairModel, setSemanticRepairModel] = useState(DEFAULT_SEMANTIC_REPAIR_MODEL);
  const [fallbackChain, setFallbackChain] = useState<string[]>([DEFAULT_FALLBACK_CHAIN[0]]);
  const [aiTier, setAiTier] = useState<AiTier>("development");
  const [modelFilter, setModelFilter] = useState<'all' | 'free' | 'paid'>('all');
  const [providerFilter, setProviderFilter] = useState<AIProvider | 'all'>('all');
  const [modelSearch, setModelSearch] = useState('');
  const [tierDefaults, setTierDefaults] = useState<TierDefaults>({});
  const [savedTierModels, setSavedTierModels] = useState<Record<string, TierModelSelection>>({});

  // Feature states
  const [iterativeMode, setIterativeMode] = useState(false);
  const [iterationCount, setIterationCount] = useState(3);
  const [iterativeTimeoutMinutes, setIterativeTimeoutMinutes] = useState(30);
  const [useFinalReview, setUseFinalReview] = useState(false);
  const [guidedQuestionRounds, setGuidedQuestionRounds] = useState(3);

  // Refs for auto-save
  const lastSavedModelKeyRef = useRef<string>('');
  const aiPrefsLoadedRef = useRef(false);
  const flushPendingSaveRef = useRef<() => void>(() => {});

  // Fetch AI preferences
  const { data: aiPreferences } = useQuery<AiPreferencesResponse>({
    queryKey: ["/api/settings/ai"],
    staleTime: 0,
  });

  // Fetch all models
  const { data: allModelsData, isLoading: allModelsLoading, error: modelsError, refetch: refetchModels } = useQuery<{
    models: AvailableModel[];
  }>({
    queryKey: ["/api/models", selectedProviders.join(',')],
    queryFn: async () => {
      const providersParam = selectedProviders.join(',');
      const res = await apiRequest("GET", `/api/models?providers=${providersParam}`);
      return res.json();
    },
  });

  // Fetch model status
  const { data: modelStatusData } = useQuery<{
    modelStatus: Record<string, {
      status: 'ok' | 'cooldown';
      cooldownSecondsLeft?: number;
      reason?: string;
    }>;
  }>({
    queryKey: ["/api/openrouter/model-status"],
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Initialize from preferences
  useEffect(() => {
    if (aiPreferences) {
      const resolvedState = resolveInitialAiModelSettingsState(aiPreferences);
      setSavedTierModels(resolvedState.tierModels);
      setGeneratorModel(resolvedState.generatorModel);
      setReviewerModel(resolvedState.reviewerModel);
      setVerifierModel(resolvedState.verifierModel);
      setSemanticRepairModel(resolvedState.semanticRepairModel);
      setFallbackChain(resolvedState.fallbackChain);
      setAiTier(resolvedState.aiTier);
      setTierDefaults(resolvedState.tierDefaults);
      setIterativeMode(resolvedState.iterativeMode);
      setIterationCount(resolvedState.iterationCount);
      setIterativeTimeoutMinutes(resolvedState.iterativeTimeoutMinutes);
      setUseFinalReview(resolvedState.useFinalReview);
      setGuidedQuestionRounds(resolvedState.guidedQuestionRounds);

      lastSavedModelKeyRef.current = buildAiModelSettingsKey({
        generatorModel: resolvedState.generatorModel,
        reviewerModel: resolvedState.reviewerModel,
        verifierModel: resolvedState.verifierModel,
        semanticRepairModel: resolvedState.semanticRepairModel,
        fallbackChain: resolvedState.fallbackChain,
        aiTier: resolvedState.aiTier,
        iterativeMode: resolvedState.iterativeMode,
        iterationCount: resolvedState.iterationCount,
        iterativeTimeoutMinutes: resolvedState.iterativeTimeoutMinutes,
        useFinalReview: resolvedState.useFinalReview,
        guidedQuestionRounds: resolvedState.guidedQuestionRounds,
      });
      aiPrefsLoadedRef.current = true;
    }
  }, [aiPreferences]);

  // Filter models
  const allAvailableModels = allModelsData?.models || [];
  const filteredModels = allAvailableModels.filter(m => {
    if (blockedModelIds.has(m.id)) return false;
    const matchesFilter = modelFilter === 'all' ||
      (modelFilter === 'free' && m.isFree) ||
      (modelFilter === 'paid' && !m.isFree);
    const matchesProvider = providerFilter === 'all' || m.provider === providerFilter;
    const matchesSearch = !modelSearch ||
      m.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
      m.id.toLowerCase().includes(modelSearch.toLowerCase());
    return matchesFilter && matchesProvider && matchesSearch;
  });

  // Provider info map
  const providerInfoMap = providers.reduce((acc, p) => {
    acc[p.id] = p;
    return acc;
  }, {} as Record<AIProvider, typeof providers[0]>);
  const modelMetaMap = new Map(allAvailableModels.map((model) => [model.id, model]));

  // Debounced settings key
  const aiModelSettingsKey = buildAiModelSettingsKey({
    generatorModel,
    reviewerModel,
    verifierModel,
    semanticRepairModel,
    fallbackChain,
    aiTier,
    iterativeMode,
    iterationCount,
    iterativeTimeoutMinutes,
    useFinalReview,
    guidedQuestionRounds,
  });
  const debouncedModelSettings = useDebounce(aiModelSettingsKey, 1500);

  // Update mutation
  const updateAiSettingsMutation = useMutation({
    mutationFn: async (modelSettingsKey?: string) => {
      const modelSettings = modelSettingsKey
        ? JSON.parse(modelSettingsKey) as {
            generatorModel?: string;
            reviewerModel?: string;
            verifierModel?: string;
            semanticRepairModel?: string;
            fallbackChain?: string[];
            aiTier?: AiTier;
            iterativeMode?: boolean;
            iterationCount?: number;
            iterativeTimeoutMinutes?: number;
            useFinalReview?: boolean;
            guidedQuestionRounds?: number;
          }
        : {};
      const generatorModelToSave = modelSettings.generatorModel || generatorModel;
      const reviewerModelToSave = modelSettings.reviewerModel || reviewerModel;
      const verifierModelToSave = modelSettings.verifierModel || verifierModel;
      const semanticRepairModelToSave = modelSettings.semanticRepairModel || semanticRepairModel;
      const fallbackChainToSave = modelSettings.fallbackChain || fallbackChain;
      const tierToSave = modelSettings.aiTier || aiTier;
      const iterativeModeToSave = modelSettings.iterativeMode ?? iterativeMode;
      const iterationCountToSave = modelSettings.iterationCount ?? iterationCount;
      const iterativeTimeoutMinutesToSave = modelSettings.iterativeTimeoutMinutes ?? iterativeTimeoutMinutes;
      const useFinalReviewToSave = modelSettings.useFinalReview ?? useFinalReview;
      const guidedQuestionRoundsToSave = modelSettings.guidedQuestionRounds ?? guidedQuestionRounds;

      return await apiRequest("PATCH", "/api/settings/ai", buildAiSettingsPayload({
        savedTierModels,
        generatorModel: generatorModelToSave,
        reviewerModel: reviewerModelToSave,
        verifierModel: verifierModelToSave,
        semanticRepairModel: semanticRepairModelToSave,
        fallbackChain: fallbackChainToSave,
        aiTier: tierToSave,
        tierDefaults,
        iterativeMode: iterativeModeToSave,
        iterationCount: iterationCountToSave,
        iterativeTimeoutMinutes: iterativeTimeoutMinutesToSave,
        useFinalReview: useFinalReviewToSave,
        guidedQuestionRounds: guidedQuestionRoundsToSave,
      }));
    },
    onSuccess: () => {
      setSavedTierModels(prev => ({
        ...prev,
        [aiTier]: buildTierModelSelection({
          generatorModel,
          reviewerModel,
          verifierModel,
          semanticRepairModel,
          fallbackChain,
        }),
      }));
      toast({
        title: t.common.success,
        description: t.settings.aiPreferencesSaved,
      });
    },
    onError: onMutationError,
  });
  const { mutateAsync } = updateAiSettingsMutation;

  // Auto-save
  useEffect(() => {
    if (!aiPrefsLoadedRef.current) return;
    if (debouncedModelSettings === lastSavedModelKeyRef.current) return;
    void mutateAsync(debouncedModelSettings, {
      onSuccess: () => {
        lastSavedModelKeyRef.current = debouncedModelSettings;
      },
    });
  }, [debouncedModelSettings, mutateAsync]);

  // Flush pending save
  flushPendingSaveRef.current = () => {
    const currentKey = buildAiModelSettingsKey({
      generatorModel,
      reviewerModel,
      verifierModel,
      semanticRepairModel,
      fallbackChain,
      aiTier,
      iterativeMode,
      iterationCount,
      iterativeTimeoutMinutes,
      useFinalReview,
      guidedQuestionRounds,
    });
    if (currentKey === lastSavedModelKeyRef.current) return;
    if (!aiPrefsLoadedRef.current) return;
    const payload = buildAiSettingsPayload({
      savedTierModels,
      generatorModel,
      reviewerModel,
      verifierModel,
      semanticRepairModel,
      fallbackChain,
      aiTier,
      tierDefaults,
      iterativeMode,
      iterationCount,
      iterativeTimeoutMinutes,
      useFinalReview,
      guidedQuestionRounds,
    });
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const queued = navigator.sendBeacon('/api/settings/ai', blob);
    if (!queued) {
      fetch('/api/settings/ai', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
      }).catch(() => {});
    }
  };

  // beforeunload + unmount flush
  useEffect(() => {
    const handleBeforeUnload = () => flushPendingSaveRef.current();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      flushPendingSaveRef.current();
    };
  }, []);

  // Tier change handler
  const handleTierChange = (value: AiTier) => {
    const nextSaved = {
      ...savedTierModels,
      [aiTier]: buildTierModelSelection({
        generatorModel,
        reviewerModel,
        verifierModel,
        semanticRepairModel,
        fallbackChain,
      }),
    };
    setSavedTierModels(nextSaved);
    setAiTier(value);

    const nextSelection = resolveTierModelSelection({
      savedTierModels: nextSaved,
      tier: value,
      tierDefaults,
    });

    if (nextSelection.generatorModel) setGeneratorModel(nextSelection.generatorModel);
    if (nextSelection.reviewerModel) setReviewerModel(nextSelection.reviewerModel);
    if (nextSelection.verifierModel) setVerifierModel(nextSelection.verifierModel);
    if (nextSelection.semanticRepairModel) setSemanticRepairModel(nextSelection.semanticRepairModel);
    setFallbackChain(nextSelection.fallbackChain);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5" />
          {t.settings.aiModelPreferences}
        </CardTitle>
        <CardDescription>{t.settings.aiModelPreferencesDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {modelsError ? (
          <QueryError message={t.settings.aiModelsFailed} onRetry={() => refetchModels()} />
        ) : (<>
          <div className="space-y-4">
            {/* Filter Buttons */}
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

            {/* Provider Filter */}
            <div className="space-y-2">
              <Label>Provider</Label>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant={providerFilter === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setProviderFilter('all')}
                >
                  Alle Provider
                </Button>
                {providers.map(p => (
                  <Button
                    key={p.id}
                    variant={providerFilter === p.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setProviderFilter(p.id)}
                    style={providerFilter === p.id ? { backgroundColor: p.color, borderColor: p.color, color: '#fff' } : undefined}
                  >
                    {p.displayName}
                  </Button>
                ))}
              </div>
            </div>

            {/* Search */}
            <div className="space-y-2">
              <Label htmlFor="model-search">{t.settings.searchModels}</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="model-search"
                  placeholder={t.settings.searchModelsPlaceholder}
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  data-testid="input-model-search"
                  className="pl-10"
                />
              </div>
            </div>

            {/* Generator Model */}
            <div className="space-y-2">
              <Label htmlFor="generator-model">{t.settings.generatorModel}</Label>
              <Select value={generatorModel} onValueChange={setGeneratorModel}>
                <SelectTrigger id="generator-model" data-testid="select-generator-model">
                  <SelectValue placeholder={allModelsLoading ? t.settings.loadingModels : t.settings.selectModel} />
                </SelectTrigger>
                <SelectContent>
                  {allModelsLoading ? (
                    <SelectItem value="loading" disabled>{t.settings.loadingModels}</SelectItem>
                  ) : filteredModels.length === 0 ? (
                    <SelectItem value="none" disabled>{t.settings.noModelsFound}</SelectItem>
                  ) : (
                    filteredModels.map(m => {
                      const provider = providerInfoMap?.[m.provider];
                      return (
                        <SelectItem key={m.id} value={m.id}>
                          <AiModelDisplayLabel
                            name={m.name}
                            isFree={m.isFree}
                            providerDisplayName={provider?.displayName}
                            providerColor={provider?.color}
                          />
                        </SelectItem>
                      );
                    })
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t.settings.generatorModelDesc}</p>
            </div>

            {/* Reviewer Model */}
            <div className="space-y-2">
              <Label htmlFor="reviewer-model">{t.settings.reviewerModel}</Label>
              <Select value={reviewerModel} onValueChange={setReviewerModel}>
                <SelectTrigger id="reviewer-model" data-testid="select-reviewer-model">
                  <SelectValue placeholder={allModelsLoading ? t.settings.loadingModels : t.settings.selectModel} />
                </SelectTrigger>
                <SelectContent>
                  {allModelsLoading ? (
                    <SelectItem value="loading" disabled>{t.settings.loadingModels}</SelectItem>
                  ) : filteredModels.length === 0 ? (
                    <SelectItem value="none" disabled>{t.settings.noModelsFound}</SelectItem>
                  ) : (
                    filteredModels.map(m => {
                      const provider = providerInfoMap?.[m.provider];
                      return (
                        <SelectItem key={m.id} value={m.id}>
                          <AiModelDisplayLabel
                            name={m.name}
                            isFree={m.isFree}
                            providerDisplayName={provider?.displayName}
                            providerColor={provider?.color}
                          />
                        </SelectItem>
                      );
                    })
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t.settings.reviewerModelDesc}</p>
            </div>

            {/* Verifier Model */}
            <div className="space-y-2">
              <Label htmlFor="verifier-model">{t.settings.verifierModel}</Label>
              <Select value={verifierModel} onValueChange={setVerifierModel}>
                <SelectTrigger id="verifier-model" data-testid="select-verifier-model">
                  <SelectValue placeholder={allModelsLoading ? t.settings.loadingModels : t.settings.selectModel} />
                </SelectTrigger>
                <SelectContent>
                  {allModelsLoading ? (
                    <SelectItem value="loading" disabled>{t.settings.loadingModels}</SelectItem>
                  ) : filteredModels.length === 0 ? (
                    <SelectItem value="none" disabled>{t.settings.noModelsFound}</SelectItem>
                  ) : (
                    filteredModels.map(m => {
                      const provider = providerInfoMap?.[m.provider];
                      return (
                        <SelectItem key={m.id} value={m.id}>
                          <AiModelDisplayLabel
                            name={m.name}
                            isFree={m.isFree}
                            providerDisplayName={provider?.displayName}
                            providerColor={provider?.color}
                          />
                        </SelectItem>
                      );
                    })
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t.settings.verifierModelDesc}</p>
            </div>
            {/* Semantic Repair Model */}            <div className="space-y-2">              <Label htmlFor="semantic-repair-model">{t.settings.semanticRepairModel}</Label>              <Select value={semanticRepairModel} onValueChange={setSemanticRepairModel}>                <SelectTrigger id="semantic-repair-model" data-testid="select-semantic-repair-model">                  <SelectValue placeholder={allModelsLoading ? t.settings.loadingModels : t.settings.selectModel} />                </SelectTrigger>                <SelectContent>                  {allModelsLoading ? (                    <SelectItem value="loading" disabled>{t.settings.loadingModels}</SelectItem>                  ) : filteredModels.length === 0 ? (                    <SelectItem value="none" disabled>{t.settings.noModelsFound}</SelectItem>                  ) : (                    filteredModels.map(m => {                      const provider = providerInfoMap?.[m.provider];                      return (                        <SelectItem key={m.id} value={m.id}>                          <AiModelDisplayLabel                            name={m.name}                            isFree={m.isFree}                            providerDisplayName={provider?.displayName}                            providerColor={provider?.color}                          />                        </SelectItem>                      );                    })                  )}                </SelectContent>              </Select>              <p className="text-xs text-muted-foreground">{t.settings.semanticRepairModelDesc}</p>            </div>

            {/* Fallback Chain */}
            <div className="space-y-2">
              <Label>{t.settings.fallbackChain}</Label>
              <p className="text-xs text-muted-foreground">{t.settings.fallbackChainDesc}</p>

              <div className="space-y-1">
                {fallbackChain.map((modelId, idx) => {
                  const modelMeta = modelMetaMap.get(modelId);
                  const provider = modelMeta ? providerInfoMap?.[modelMeta.provider] : undefined;
                  const statusEntry = modelStatusData?.modelStatus?.[modelId];
                  const statusColor = (!statusEntry || statusEntry.status === 'ok')
                    ? 'bg-green-500'
                    : 'bg-yellow-400';
                  const statusTitle = (!statusEntry || statusEntry.status === 'ok')
                    ? t.settings.modelAvailable
                    : `${t.settings.modelCooldown}: ${statusEntry?.reason || '?'} (${statusEntry?.cooldownSecondsLeft || '?'}s)`;
                  return (
                    <div key={modelId} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
                      <span className="text-muted-foreground w-5 text-center text-xs">{idx + 1}</span>
                      <span title={statusTitle} className={`w-2 h-2 rounded-full ${statusColor} flex-shrink-0`} />
                      <AiModelDisplayLabel
                        name={modelMeta?.name ?? modelId}
                        isFree={modelMeta?.isFree}
                        providerDisplayName={provider?.displayName}
                        providerColor={provider?.color}
                        className="flex-1"
                      />
                      <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === 0}
                        onClick={() => setFallbackChain(prev => {
                          const next = [...prev];
                          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                          return next;
                        })}>
                        <span className="text-xs">▲</span>
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === fallbackChain.length - 1}
                        onClick={() => setFallbackChain(prev => {
                          const next = [...prev];
                          [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                          return next;
                        })}>
                        <span className="text-xs">▼</span>
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" disabled={fallbackChain.length <= 1}
                        onClick={() => setFallbackChain(prev => prev.filter((_, i) => i !== idx))}>
                        <span className="text-xs">✕</span>
                      </Button>
                    </div>
                  );
                })}
              </div>

              <Select value="" onValueChange={(id) => {
                if (id && !fallbackChain.includes(id)) {
                  setFallbackChain(prev => [...prev, id]);
                }
              }}>
                <SelectTrigger data-testid="select-fallback-model">
                  <SelectValue placeholder={t.settings.addFallbackModel} />
                </SelectTrigger>
                <SelectContent>
                  {allModelsLoading ? (
                    <SelectItem value="loading" disabled>{t.settings.loadingModels}</SelectItem>
                  ) : filteredModels.filter(m => !fallbackChain.includes(m.id)).length === 0 ? (
                    <SelectItem value="none" disabled>{t.settings.noModelsFound}</SelectItem>
                  ) : (
                    filteredModels
                      .filter(m => !fallbackChain.includes(m.id))
                      .map(m => {
                        const provider = providerInfoMap?.[m.provider];
                        return (
                          <SelectItem key={m.id} value={m.id}>
                            <AiModelDisplayLabel
                              name={m.name}
                              isFree={m.isFree}
                              providerDisplayName={provider?.displayName}
                              providerColor={provider?.color}
                            />
                          </SelectItem>
                        );
                      })
                  )}
                </SelectContent>
              </Select>

              <Button variant="outline" size="sm"
                onClick={() => setFallbackChain([...DEFAULT_FALLBACK_CHAIN])}>
                <RefreshCw className="h-3 w-3 mr-1" />
                {t.settings.resetFallbackChain}
              </Button>
            </div>

            <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
              <p className="text-sm font-medium">{t.settings.howFallbackWorks}</p>
              <p className="text-xs text-muted-foreground">{t.settings.howFallbackWorksDesc}</p>
            </div>

            <Separator className="my-4" />

            {/* AI Tier */}
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
                  <SelectItem value="abacus">{t.settings.tierAbacus}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t.settings.qualityTierDesc}</p>
            </div>
          </div>

          <Separator className="my-6" />

          {/* Iterative Mode */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4" />
                  <Label htmlFor="iterative-mode" className="text-base cursor-pointer">
                    {t.settings.iterativeWorkflow}
                  </Label>
                </div>
                <p className="text-sm text-muted-foreground">{t.settings.iterativeWorkflowDesc}</p>
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
                  <p className="text-xs text-muted-foreground">{t.settings.iterationCountDesc}</p>
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
                  <p className="text-xs text-muted-foreground">{t.settings.iterativeTimeoutDesc}</p>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="final-review" className="cursor-pointer">
                      {t.settings.finalReviewLabel}
                    </Label>
                    <p className="text-sm text-muted-foreground">{t.settings.finalReviewDesc}</p>
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

            {/* Guided Mode */}
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
                <p className="text-xs text-muted-foreground">{t.settings.questionRoundsDesc}</p>
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
  );
}
