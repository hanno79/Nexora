/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Fallback-Orchestrierung fuer OpenRouter-Client-Aufrufe inklusive Cooldown-, Provider- und Modellfamilienlogik.
*/

// ÄNDERUNG 08.03.2026: Fallback-Orchestrierung aus `server/openrouter.ts` extrahiert, um die Hauptdatei konservativ zu verkleinern.

import type { TokenUsage } from '@shared/schema';
import {
  getBestDirectProvider,
  isOpenRouterFreeModel,
  resolveProvidersForModel,
} from './modelRegistry';
import {
  clearGlobalCooldown,
  getGlobalCooldownStatus,
  getProviderCooldownStatus,
  setGlobalCooldown,
  setProviderCooldown,
} from './openrouterCooldowns';
import {
  getModelFamily,
  normalizeModelFamilyList,
} from './modelFamily';
import {
  MODEL_TIERS,
  TIER_PROVIDER_HINT,
  getDefaultFallbackChainForTier,
  sanitizeConfiguredModel,
  type ModelConfig,
} from './openrouterModelConfig';

type ModelRole = 'generator' | 'reviewer' | 'verifier';
type PreferredModelRole = ModelRole | 'fallback';

type PreferredModelsState = {
  generator?: string;
  reviewer?: string;
  verifier?: string;
  fallback?: string;
};

type CallResult = {
  content: string;
  usage: TokenUsage;
  model: string;
  finishReason?: string;
};

type FallbackResult = CallResult & {
  tier: string;
  usedFallback: boolean;
};

export interface ModelCallAttemptUpdate {
  role: ModelRole;
  model: string;
  phase?: string;
  provider?: string;
  status: 'started' | 'succeeded' | 'failed' | 'aborted';
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  finishReason?: string;
  errorMessage?: string;
}

export interface ModelCallExecutionContext {
  abortSignal?: AbortSignal;
  phase?: string;
  onAttemptUpdate?: (attempt: ModelCallAttemptUpdate) => void;
}

interface FallbackCandidate {
  model: string;
  isPrimary: boolean;
}

interface CooldownCandidate extends FallbackCandidate {
  reason: string;
}

interface SameFamilyCandidate extends FallbackCandidate {
  family?: string;
}

export interface ModelFamilyFallbackEvent {
  role: ModelRole;
  model: string;
  family?: string;
  blockedFamilies: string[];
}

export interface CallWithFallbackConstraints {
  avoidModelFamilies?: string[];
  allowSameFamilyFallback?: boolean;
  onSameFamilyFallback?: (event: ModelFamilyFallbackEvent) => void;
  abortSignal?: AbortSignal;
  phase?: string;
  onAttemptUpdate?: (attempt: ModelCallAttemptUpdate) => void;
}

interface ExecuteOpenRouterFallbackParams {
  modelType: ModelRole;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  responseFormat?: { type: 'json_object' };
  temperature?: number;
  constraints?: CallWithFallbackConstraints;
  tier: keyof ModelConfig;
  preferredModels: PreferredModelsState;
  preferredFallbackChain: string[];
  callModel: (
    modelType: ModelRole,
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number,
    temperature: number,
    responseFormat?: { type: 'json_object' },
    executionContext?: ModelCallExecutionContext,
  ) => Promise<CallResult>;
  withTemporaryPreferredModel: <T>(
    role: PreferredModelRole,
    model: string,
    run: () => Promise<T>,
  ) => Promise<T>;
  isModelQuarantined?: (model: string) => boolean;
  recordFailureForRun?: (model: string, errorMessage: string) => void;
}

type FallbackFailureCategory =
  | 'rate_limited'
  | 'timed_out'
  | 'provider_error'
  | 'auth'
  | 'model_unavailable'
  | 'other';

function categorizeFallbackError(errorMessage: string): FallbackFailureCategory {
  const normalized = (errorMessage || '').toLowerCase();
  if (normalized.includes('rate limit') || normalized.includes('429')) return 'rate_limited';
  if (
    normalized.includes('timed out') ||
    normalized.includes('fetch failed') ||
    normalized.includes('econnrefused') ||
    normalized.includes('enotfound') ||
    normalized.includes('socket hang up')
  ) {
    return 'timed_out';
  }
  if (
    normalized.includes('provider returned error') ||
    normalized.includes('provider error')
  ) {
    return 'provider_error';
  }
  if (
    normalized.includes('api key is invalid') ||
    normalized.includes('unauthorized') ||
    normalized.includes('key not configured') ||
    normalized.includes('auth failure')
  ) {
    return 'auth';
  }
  if (
    normalized.includes('not a valid model') ||
    normalized.includes('not found') ||
    normalized.includes('nicht gefunden') ||
    normalized.includes('no longer available') ||
    normalized.includes('end of life') ||
    normalized.includes('reached its end')
  ) {
    return 'model_unavailable';
  }
  return 'other';
}

function buildFallbackFailureMessage(modelCount: number, errors: string[]): string {
  const uniqueErrors = Array.from(new Set(errors));
  const counts = uniqueErrors.reduce<Record<FallbackFailureCategory, number>>((acc, error) => {
    const category = categorizeFallbackError(error);
    acc[category] += 1;
    return acc;
  }, {
    rate_limited: 0,
    timed_out: 0,
    provider_error: 0,
    auth: 0,
    model_unavailable: 0,
    other: 0,
  });

  const summaryParts: string[] = [];
  if (counts.rate_limited > 0) summaryParts.push(`${counts.rate_limited} rate-limited`);
  if (counts.timed_out > 0) summaryParts.push(`${counts.timed_out} timed out`);
  if (counts.provider_error > 0) summaryParts.push(`${counts.provider_error} provider error${counts.provider_error === 1 ? '' : 's'}`);
  if (counts.auth > 0) summaryParts.push(`${counts.auth} auth error${counts.auth === 1 ? '' : 's'}`);
  if (counts.model_unavailable > 0) summaryParts.push(`${counts.model_unavailable} unavailable`);
  if (counts.other > 0) summaryParts.push(`${counts.other} other`);

  const allRateLimited = uniqueErrors.length > 0 && counts.rate_limited === uniqueErrors.length;
  const allTransient = uniqueErrors.length > 0
    && counts.auth === 0
    && counts.model_unavailable === 0
    && (counts.rate_limited + counts.timed_out + counts.provider_error === uniqueErrors.length);

  let intro = `All ${modelCount} configured AI models failed for this request.`;
  if (allRateLimited) {
    intro =
      `All ${modelCount} configured AI models are currently rate limited. ` +
      'This looks like a temporary OpenRouter/provider capacity issue, not a model-settings problem.';
  } else if (allTransient) {
    intro =
      `All ${modelCount} configured AI models are temporarily unavailable. ` +
      'This looks like a transient OpenRouter/provider issue, not a permanent model-settings problem.';
  } else {
    intro += ' If this persists, check Settings and verify your models are available on OpenRouter.';
  }

  const summary = summaryParts.length > 0
    ? `\n\nFailure summary: ${summaryParts.join(', ')}.`
    : '';

  return (
    `${intro}${summary}\n\nModels tried:\n` +
    uniqueErrors.map((error, index) => `${index + 1}. ${error}`).join('\n')
  );
}

export async function executeOpenRouterFallback(
  params: ExecuteOpenRouterFallbackParams,
): Promise<FallbackResult> {
  const {
    modelType,
    systemPrompt,
    userPrompt,
    maxTokens,
    responseFormat,
    temperature,
    constraints,
    tier,
    preferredModels,
    preferredFallbackChain,
    callModel,
    withTemporaryPreferredModel,
    isModelQuarantined,
    recordFailureForRun,
  } = params;

  const tierProviderHint = TIER_PROVIDER_HINT[tier];

  const errors: string[] = [];
  const seen = new Set<string>();
  const modelsToTry: FallbackCandidate[] = [];
  const cooldownSkippedModels: CooldownCandidate[] = [];
  const deferredSameFamilyModels: SameFamilyCandidate[] = [];
  const blockedFamilies = new Set(normalizeModelFamilyList(constraints?.avoidModelFamilies || []));

  const throwIfAborted = () => {
    const signal = constraints?.abortSignal;
    if (!signal?.aborted) return;
    const abortError: any = new Error('AI request aborted by caller.');
    abortError.name = 'AbortError';
    abortError.code = 'ERR_CLIENT_DISCONNECT';
    throw abortError;
  };

  const isLastResortCooldownOverrideAllowed = (reason: string): boolean => {
    const normalizedReason = (reason || '').toLowerCase();
    if (!normalizedReason) return true;
    if (normalizedReason.includes('auth')) return false;
    if (normalizedReason.includes('not found')) return false;
    if (normalizedReason.includes('unavailable')) return false;
    return true;
  };

  const addIfNew = (model: string | undefined, isPrimary: boolean) => {
    const sanitized = sanitizeConfiguredModel(model);
    if (!sanitized || seen.has(sanitized)) return;
    if (isModelQuarantined?.(sanitized)) {
      console.warn(`Skipping ${sanitized} — quarantined for this run after repeated invalid/provider-400 failures`);
      return;
    }
    seen.add(sanitized);

    const family = getModelFamily(sanitized);
    if (family && blockedFamilies.has(family)) {
      deferredSameFamilyModels.push({ model: sanitized, isPrimary, family });
      return;
    }

    const modelProvider = getBestDirectProvider(sanitized, tierProviderHint);
    if (modelProvider && modelProvider !== 'openrouter') {
      const providerCd = getProviderCooldownStatus(modelProvider);
      if (providerCd) {
        console.warn(`Skipping ${sanitized} — provider ${modelProvider} on cooldown: ${providerCd.reason}`);
        return;
      }
    }

    modelsToTry.push({ model: sanitized, isPrimary });
  };

  const rememberCooldownSkippedModel = (model: string, isPrimary: boolean, reason: string) => {
    const existingIndex = cooldownSkippedModels.findIndex(entry => entry.model === model);
    if (existingIndex >= 0) {
      cooldownSkippedModels[existingIndex] = { model, isPrimary, reason };
      return;
    }
    cooldownSkippedModels.push({ model, isPrimary, reason });
  };

  const primary = preferredModels[modelType];
  // ÄNDERUNG 11.03.2026: Bei leerer Fallback-Kette auf Tier-Defaults zurückfallen,
  // damit auch ohne User-Preferences mehrere Modelle zur Verfügung stehen.
  const fallbackChain = preferredFallbackChain.length > 0
    ? preferredFallbackChain
    : [...getDefaultFallbackChainForTier(tier)];
  const tierModels = MODEL_TIERS[tier];
  const roleDefault = modelType === 'generator'
    ? tierModels.generator
    : (modelType === 'reviewer' ? tierModels.reviewer : tierModels.verifier);
  const crossRoleCandidates: ModelRole[] = modelType === 'generator'
    ? ['reviewer', 'verifier']
    : (modelType === 'reviewer' ? ['verifier', 'generator'] : ['reviewer', 'generator']);
  const allowCrossRoleFallback = process.env.ALLOW_CROSS_ROLE_MODEL_FALLBACK === 'true';
  const allowDirectProviderBaseFallback = tier !== 'development';

  addIfNew(primary, true);
  for (const fallbackModel of fallbackChain) {
    addIfNew(fallbackModel, false);
  }
  addIfNew(roleDefault, false);

  if (allowDirectProviderBaseFallback) {
    for (const fallbackModel of fallbackChain) {
      if (isOpenRouterFreeModel(fallbackModel)) {
        const baseModel = fallbackModel.replace(/:free$/, '');
        const directProviders = resolveProvidersForModel(baseModel);
        if (directProviders.length > 0) {
          addIfNew(baseModel, false);
        }
      }
    }
  }

  if (allowDirectProviderBaseFallback) {
    if (process.env.NVIDIA_API_KEY) {
      addIfNew('meta/llama-3.3-70b-instruct', false);
    }
    if (process.env.GROQ_API_KEY) {
      addIfNew('llama-3.3-70b-versatile', false);
    }
    if (process.env.CEREBRAS_API_KEY) {
      addIfNew('llama-3.3-70b', false);
    }
  }

  if (allowCrossRoleFallback) {
    for (const role of crossRoleCandidates) {
      addIfNew(preferredModels[role], false);
      addIfNew(tierModels[role], false);
    }
  }

  if (modelsToTry.length === 0) {
    const emergency = sanitizeConfiguredModel(roleDefault);
    if (emergency && !seen.has(emergency)) {
      seen.add(emergency);
      modelsToTry.push({ model: emergency, isPrimary: false });
    }
  }

  if (modelsToTry.length === 0) {
    throw new Error('No usable AI models are configured after filtering unavailable/deprecated entries. Please update AI settings.');
  }

  const tryModelWithFallback = async (
    attemptModel: string,
    isPrimary: boolean,
    mode: 'normal' | 'cooldown-override' | 'same-family-fallback',
    currentIndex?: number | null,
  ): Promise<FallbackResult | null> => {
    throwIfAborted();
    try {
      console.log(
        `Attempting ${modelType} with ${attemptModel} (` +
        `${isPrimary ? 'primary' : 'fallback'}${mode === 'cooldown-override' ? ', cooldown override' : ''}${mode === 'same-family-fallback' ? ', same-family fallback' : ''})`,
      );

      return await withTemporaryPreferredModel(modelType, attemptModel, async () => {
        const result = await callModel(
          modelType,
          systemPrompt,
          userPrompt,
          maxTokens,
          temperature ?? 0.7,
          responseFormat,
          {
            abortSignal: constraints?.abortSignal,
            phase: constraints?.phase,
            onAttemptUpdate: constraints?.onAttemptUpdate,
          },
        );
        clearGlobalCooldown(attemptModel);
        const usedFallback = !isPrimary || mode !== 'normal';
        if (usedFallback) {
          console.log(`⚠️ Fallback used: ${attemptModel} instead of ${primary || 'none'}`);
        }
        if (mode === 'same-family-fallback') {
          constraints?.onSameFamilyFallback?.({
            role: modelType,
            model: attemptModel,
            family: getModelFamily(attemptModel),
            blockedFamilies: Array.from(blockedFamilies),
          });
        }
        return { ...result, tier, usedFallback };
      });
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.code === 'ERR_CLIENT_DISCONNECT') {
        throw error;
      }
      const errorMessage = error?.message || '';
      applyFailureCooldown(attemptModel, errorMessage);
      recordFailureForRun?.(attemptModel, errorMessage);
      const appliedCooldown = getGlobalCooldownStatus(attemptModel);
      if (appliedCooldown) {
        rememberCooldownSkippedModel(attemptModel, isPrimary, appliedCooldown.reason);
      }
      errors.push(`${attemptModel}: ${errorMessage}`);
      console.warn(`${attemptModel} failed, trying next model...`, errorMessage);

      const errMsg = errorMessage.toLowerCase();
      const failedIsOpenRouterOnly = getBestDirectProvider(attemptModel, tierProviderHint) === null;
      const nextSliceStart = typeof currentIndex === 'number' && currentIndex >= 0
        ? currentIndex + 1
        : 0;

      if (
        failedIsOpenRouterOnly && (
          errMsg.includes('api key is invalid') ||
          errMsg.includes('unauthorized') ||
          errMsg.includes('key not configured')
        )
      ) {
        for (const remaining of modelsToTry.slice(nextSliceStart)) {
          if (getBestDirectProvider(remaining.model, tierProviderHint) === null) {
            setGlobalCooldown(remaining.model, 5 * 60 * 1000, 'openrouter auth failure');
            console.warn(`[Auth-Skip] Cooldown set for ${remaining.model} (OpenRouter auth failure)`);
          }
        }
      }

      const failedProvider = getBestDirectProvider(attemptModel, tierProviderHint);
      if (failedProvider && failedProvider !== 'openrouter') {
        // Abacus ist ein Meta-Router — verschiedene Model-IDs nutzen verschiedene Backends.
        // Provider-weite Rate-Limit-Cooldowns wuerden unbeteiligte Modelle faelschlich blockieren.
        const isMetaRouterProvider = failedProvider === 'abacus';

        const isHardNetworkError =
          errMsg.includes('econnrefused') ||
          errMsg.includes('enotfound') ||
          errMsg.includes('socket hang up');
        const isSoftTimeout =
          errMsg.includes('timed out') ||
          errMsg.includes('fetch failed');

        if (isHardNetworkError || isSoftTimeout) {
          if (isMetaRouterProvider && isSoftTimeout && !isHardNetworkError) {
            // Meta-Router: Timeouts sind modellspezifisch (Backend-Modell war langsam),
            // kein Provider-weiter Cooldown — andere Model-IDs nutzen andere Backends
            console.warn(`[Timeout] ${attemptModel} timed out on meta-router ${failedProvider} — model-only cooldown`);
          } else {
            // Echte Netzwerk-Fehler oder Timeouts auf normalen Providern: Provider-weiter Cooldown
            setProviderCooldown(failedProvider, 5 * 60 * 1000, `timeout/connection error on ${attemptModel}`);
            for (const remaining of modelsToTry.slice(nextSliceStart)) {
              const remainingProvider = getBestDirectProvider(remaining.model, tierProviderHint);
              if (remainingProvider === failedProvider) {
                setGlobalCooldown(remaining.model, 5 * 60 * 1000, `provider ${failedProvider} down`);
                console.warn(`[Circuit-Breaker] Skipping ${remaining.model} (provider ${failedProvider} down)`);
              }
            }
          }
        }

        if (errMsg.includes('rate limit') || errMsg.includes('429')) {
          if (isMetaRouterProvider) {
            // Meta-Router: Nur das spezifische Modell kuehl stellen, nicht den gesamten Provider
            console.warn(`[Rate-Limit] ${attemptModel} rate limited on meta-router ${failedProvider} — model-only cooldown`);
          } else {
            setProviderCooldown(failedProvider, 2 * 60 * 1000, `rate limited on ${attemptModel}`);
            for (const remaining of modelsToTry.slice(nextSliceStart)) {
              const remainingProvider = getBestDirectProvider(remaining.model, tierProviderHint);
              if (remainingProvider === failedProvider) {
                setGlobalCooldown(remaining.model, 2 * 60 * 1000, `provider ${failedProvider} rate limited`);
                console.warn(`[Rate-Limit-CB] Skipping ${remaining.model} (provider ${failedProvider} rate limited)`);
              }
            }
          }
        }
      }

      return null;
    }
  };

  for (let index = 0; index < modelsToTry.length; index++) {
    throwIfAborted();
    const { model: attemptModel, isPrimary } = modelsToTry[index];
    const modelCd = getGlobalCooldownStatus(attemptModel);
    if (modelCd) {
      console.warn(`Skipping ${attemptModel} due to cooldown: ${modelCd.reason}`);
      rememberCooldownSkippedModel(attemptModel, isPrimary, modelCd.reason);
      continue;
    }

    const modelProvider = getBestDirectProvider(attemptModel, tierProviderHint);
    if (modelProvider && modelProvider !== 'openrouter') {
      const providerCd = getProviderCooldownStatus(modelProvider);
      if (providerCd) {
        console.warn(`Skipping ${attemptModel} — provider ${modelProvider} on cooldown: ${providerCd.reason}`);
        continue;
      }
    }

    const result = await tryModelWithFallback(attemptModel, isPrimary, 'normal', index);
    if (result) {
      return result;
    }
  }

  const cooldownOverrideCandidates = cooldownSkippedModels.filter(({ reason }) =>
    isLastResortCooldownOverrideAllowed(reason),
  );
  if (cooldownOverrideCandidates.length > 0) {
    console.warn(
      `Last-resort retry: ${cooldownOverrideCandidates.length} cooled-down ${modelType} model(s) ` +
      'are retried after the regular fallback chain was exhausted.',
    );
  }

  for (const { model: attemptModel, isPrimary, reason } of cooldownOverrideCandidates) {
    throwIfAborted();
    const modelProvider = getBestDirectProvider(attemptModel, tierProviderHint);
    if (modelProvider && modelProvider !== 'openrouter') {
      const providerCd = getProviderCooldownStatus(modelProvider);
      if (providerCd) {
        console.warn(`Skipping ${attemptModel} even in last resort — provider ${modelProvider} still on cooldown: ${providerCd.reason}`);
        continue;
      }
    }

    console.warn(`Retrying ${attemptModel} despite active cooldown: ${reason}`);
    const currentIndex = modelsToTry.findIndex(({ model }) => model === attemptModel);
    const result = await tryModelWithFallback(
      attemptModel,
      isPrimary,
      'cooldown-override',
      currentIndex >= 0 ? currentIndex : undefined,
    );
    if (result) {
      return result;
    }
  }

  if (constraints?.allowSameFamilyFallback !== false && deferredSameFamilyModels.length > 0) {
    console.warn(
      `Verifier independence fallback: retrying ${deferredSameFamilyModels.length} ${modelType} model(s) ` +
      `from blocked families ${Array.from(blockedFamilies).join(', ') || '(none)'}.`,
    );
  }

  if (constraints?.allowSameFamilyFallback !== false) {
    for (const { model: attemptModel, isPrimary, family } of deferredSameFamilyModels) {
      throwIfAborted();
      console.warn(
        `Retrying ${attemptModel} as same-family fallback for ${modelType}` +
        `${family ? ` (${family})` : ''}.`,
      );
      const currentIndex = modelsToTry.findIndex(({ model }) => model === attemptModel);
      const result = await tryModelWithFallback(
        attemptModel,
        isPrimary,
        'same-family-fallback',
        currentIndex >= 0 ? currentIndex : undefined,
      );
      if (result) {
        return result;
      }
    }
  }

  const modelList = [
    ...modelsToTry.map(modelEntry => modelEntry.model),
    ...deferredSameFamilyModels.map(modelEntry => modelEntry.model),
  ];
  throw new Error(buildFallbackFailureMessage(modelList.length, errors));
}

export function applyFailureCooldown(model: string, errorMessage: string): void {
  const message = (errorMessage || '').toLowerCase();
  let cooldownMs = 0;
  let reason = '';

  if (message.includes('no longer available') || message.includes('end of life') || message.includes('reached its end')) {
    cooldownMs = 24 * 60 * 60 * 1000;
    reason = 'model unavailable on provider';
  } else if (message.includes('not a valid model') || message.includes('not found') || message.includes('nicht gefunden')) {
    cooldownMs = 30 * 60 * 1000;
    reason = 'model not found';
  } else if (message.includes('returned an empty response')) {
    cooldownMs = 10 * 60 * 1000;
    reason = 'repeated empty response';
  } else if (message.includes('timed out') || message.includes('fetch failed') || message.includes('econnrefused') || message.includes('provider error')) {
    cooldownMs = 3 * 60 * 1000;
    reason = 'provider connection error';
  } else if (message.includes('rate limit exceeded') || message.includes('rate limit erreicht')) {
    cooldownMs = 2 * 60 * 1000;
    reason = 'rate limited';
  }

  if (cooldownMs > 0) {
    setGlobalCooldown(model, cooldownMs, reason);
  }
}
