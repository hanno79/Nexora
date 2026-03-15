export type AiTier = "development" | "production" | "premium" | "abacus";

export interface TierDefaults {
  development?: { generator?: string; reviewer?: string; verifier?: string; semanticRepair?: string };
  production?: { generator?: string; reviewer?: string; verifier?: string; semanticRepair?: string };
  premium?: { generator?: string; reviewer?: string; verifier?: string; semanticRepair?: string };
  abacus?: { generator?: string; reviewer?: string; verifier?: string; semanticRepair?: string };
}

export interface TierModelSelection {
  generatorModel?: string;
  reviewerModel?: string;
  verifierModel?: string;
  semanticRepairModel?: string;
  fallbackModel?: string;
  fallbackChain?: string[];
}

export interface AiPreferencesResponse {
  generatorModel?: string;
  reviewerModel?: string;
  semanticRepairModel?: string;
  verifierModel?: string;
  fallbackChain?: string[];
  fallbackModel?: string;
  tier?: AiTier;
  tierModels?: Record<string, TierModelSelection>;
  tierDefaults?: TierDefaults;
  iterativeMode?: boolean;
  iterationCount?: number;
  iterativeTimeoutMinutes?: number;
  useFinalReview?: boolean;
  guidedQuestionRounds?: number;
}

export interface ResolvedAiModelSettingsState {
  generatorModel: string;
  reviewerModel: string;
  verifierModel: string;
  semanticRepairModel: string;
  fallbackChain: string[];
  aiTier: AiTier;
  tierDefaults: TierDefaults;
  tierModels: Record<string, TierModelSelection>;
  iterativeMode: boolean;
  iterationCount: number;
  iterativeTimeoutMinutes: number;
  useFinalReview: boolean;
  guidedQuestionRounds: number;
}

export interface AiSettingsPayloadInput {
  savedTierModels: Record<string, TierModelSelection>;
  generatorModel: string;
  reviewerModel: string;
  verifierModel: string;
  fallbackChain: string[];
  semanticRepairModel: string;
  aiTier: AiTier;
  tierDefaults: TierDefaults;
  iterativeMode: boolean;
  iterationCount: number;
  iterativeTimeoutMinutes: number;
  useFinalReview: boolean;
  guidedQuestionRounds: number;
}

export const DEFAULT_GENERATOR_MODEL = "nvidia/nemotron-3-nano-30b-a3b:free";
export const DEFAULT_REVIEWER_MODEL = "arcee-ai/trinity-large-preview:free";
export const DEFAULT_VERIFIER_MODEL = "google/gemma-3-27b-it:free";
export const DEFAULT_SEMANTIC_REPAIR_MODEL = "arcee-ai/trinity-large-preview:free";
export const DEFAULT_FALLBACK_CHAIN = [
  "google/gemma-3-27b-it:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "qwen/qwen3-coder:free",
  "openai/gpt-oss-120b:free",
] as const;

export function normalizeModelDisplayName(name: string | null | undefined): string {
  const normalized = String(name || "").trim();
  if (!normalized) {
    return "";
  }
  return normalized.replace(/\s*\((?:free)\)\s*$/i, "").trim();
}

export function buildAiModelSettingsKey(params: {
  generatorModel: string;
  reviewerModel: string;
  verifierModel: string;
  semanticRepairModel: string;
  fallbackChain: string[];
  aiTier: AiTier;
  iterativeMode: boolean;
  iterationCount: number;
  iterativeTimeoutMinutes: number;
  useFinalReview: boolean;
  guidedQuestionRounds: number;
}): string {
  return JSON.stringify(params);
}

export function buildTierModelSelection(params: {
  generatorModel: string;
  reviewerModel: string;
  verifierModel: string;
  semanticRepairModel: string;
  fallbackChain: string[];
}): TierModelSelection {
  return {
    generatorModel: params.generatorModel,
    reviewerModel: params.reviewerModel,
    verifierModel: params.verifierModel,
    semanticRepairModel: params.semanticRepairModel,
    fallbackChain: params.fallbackChain,
  };
}

export function resolveInitialAiModelSettingsState(
  aiPreferences?: AiPreferencesResponse,
): ResolvedAiModelSettingsState {
  const fallbackChain =
    aiPreferences?.fallbackChain ??
    (aiPreferences?.fallbackModel ? [aiPreferences.fallbackModel] : null) ??
    [...DEFAULT_FALLBACK_CHAIN];

  return {
    generatorModel: aiPreferences?.generatorModel || DEFAULT_GENERATOR_MODEL,
    reviewerModel: aiPreferences?.reviewerModel || DEFAULT_REVIEWER_MODEL,
    verifierModel:
      aiPreferences?.verifierModel ||
      aiPreferences?.reviewerModel ||
      DEFAULT_VERIFIER_MODEL,
    semanticRepairModel:
      aiPreferences?.semanticRepairModel ||
      aiPreferences?.reviewerModel ||
      DEFAULT_SEMANTIC_REPAIR_MODEL,
    fallbackChain: [...fallbackChain],
    aiTier: aiPreferences?.tier || "development",
    tierDefaults: aiPreferences?.tierDefaults || {},
    tierModels: aiPreferences?.tierModels || {},
    iterativeMode: aiPreferences?.iterativeMode || false,
    iterationCount: aiPreferences?.iterationCount || 3,
    iterativeTimeoutMinutes: aiPreferences?.iterativeTimeoutMinutes || 30,
    useFinalReview: aiPreferences?.useFinalReview || false,
    guidedQuestionRounds: aiPreferences?.guidedQuestionRounds || 3,
  };
}

export function resolveTierModelSelection(params: {
  savedTierModels: Record<string, TierModelSelection>;
  tier: AiTier;
  tierDefaults: TierDefaults;
}): {
  generatorModel?: string;
  reviewerModel?: string;
  verifierModel?: string;
  semanticRepairModel?: string;
  fallbackChain: string[];
} {
  const saved = params.savedTierModels[params.tier];
  if (
    saved?.generatorModel
    || saved?.reviewerModel
    || saved?.verifierModel
    || saved?.semanticRepairModel
    || saved?.fallbackChain
    || saved?.fallbackModel
  ) {
    return {
      generatorModel: saved.generatorModel,
      reviewerModel: saved.reviewerModel,
      verifierModel: saved.verifierModel,
      semanticRepairModel: saved.semanticRepairModel,
      fallbackChain:
        Array.isArray(saved.fallbackChain) && saved.fallbackChain.length > 0
          ? [...saved.fallbackChain]
          : (saved.fallbackModel ? [saved.fallbackModel] : [...DEFAULT_FALLBACK_CHAIN]),
    };
  }

  const defaults = params.tierDefaults[params.tier];
  return {
    generatorModel: defaults?.generator,
    reviewerModel: defaults?.reviewer,
    verifierModel: defaults?.verifier ?? defaults?.reviewer,
    semanticRepairModel: defaults?.semanticRepair ?? defaults?.reviewer,
    fallbackChain: [...DEFAULT_FALLBACK_CHAIN],
  };
}

export function buildAiSettingsPayload(params: AiSettingsPayloadInput) {
  const currentTierModels = {
    ...params.savedTierModels,
    [params.aiTier]: buildTierModelSelection({
      generatorModel: params.generatorModel,
      reviewerModel: params.reviewerModel,
      verifierModel: params.verifierModel,
      semanticRepairModel: params.semanticRepairModel,
      fallbackChain: params.fallbackChain,
    }),
  };

  return {
    generatorModel: params.generatorModel,
    reviewerModel: params.reviewerModel,
    verifierModel: params.verifierModel,
    semanticRepairModel: params.semanticRepairModel,
    fallbackModel: params.fallbackChain[0] || DEFAULT_FALLBACK_CHAIN[0],
    fallbackChain: params.fallbackChain,
    tier: params.aiTier,
    tierModels: currentTierModels,
    tierDefaults: params.tierDefaults,
    iterativeMode: params.iterativeMode,
    iterationCount: Math.min(5, Math.max(2, params.iterationCount)),
    iterativeTimeoutMinutes: Math.min(120, Math.max(5, params.iterativeTimeoutMinutes)),
    useFinalReview: params.useFinalReview,
    guidedQuestionRounds: Math.min(10, Math.max(1, params.guidedQuestionRounds)),
  };
}
