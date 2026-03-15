// OpenRouter API Client for Dual-AI System
// Based on HRP-17 Specification
// ÄNDERUNG 04.03.2026: Direkte Provider-Aufrufe als Fallback hinzugefuegt
// ÄNDERUNG 08.03.2026: Model-API und User-Praeferenzlogik in kleine Hilfsmodule ausgelagert

import type { TokenUsage } from "@shared/schema";
import { createProvider, type AIProvider } from "./providers/index";
import { getBestDirectProvider } from "./modelRegistry";
import {
  clearGlobalCooldown,
  clearProviderCooldown,
  getAllActiveCooldowns,
  getGlobalCooldownStatus,
  getProviderCooldownStatus,
  setGlobalCooldown,
  setProviderCooldown,
} from './openrouterCooldowns';
import {
  applyFailureCooldown as applyOpenRouterFailureCooldown,
  executeOpenRouterFallback,
  type CallWithFallbackConstraints,
  type ModelCallAttemptUpdate,
  type ModelCallExecutionContext,
  type ModelFamilyFallbackEvent,
} from './openrouterFallback';
import { logger } from './logger';
import { applyUserPreferencesToClient } from './openrouterUserPreferences';
import {
  DEPRECATED_MODEL_IDS,
  DEFAULT_FALLBACK_MODEL_BY_TIER,
  DEFAULT_FREE_FALLBACK_CHAIN,
  DEFAULT_FREE_FALLBACK_MODEL,
  DEFAULT_FREE_GENERATOR_MODEL,
  DEFAULT_FREE_REVIEWER_MODEL,
  DEFAULT_PREMIUM_FALLBACK_CHAIN,
  DEFAULT_PRODUCTION_FALLBACK_CHAIN,
  DEFAULT_SAFE_TIER,
  getDefaultFallbackChainForTier,
  getDefaultFallbackModelForTier,
  MODEL_TIERS,
  resolveModelTier,
  sanitizeConfiguredModel,
  TIER_PROVIDER_HINT,
  type ModelConfig,
  type ModelTier,
} from './openrouterModelConfig';

/** Strip <think>...</think> reasoning blocks that some models emit. */
function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function extractOpenRouterErrorMessage(errorData: any, fallbackText: string): string {
  return String(
    errorData?.error?.message ||
    errorData?.message ||
    fallbackText ||
    ''
  ).trim();
}

interface OpenRouterRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: 'json_object' };
}

interface OpenRouterResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

class OpenRouterClient {
  private apiKey: string;
  private baseUrl = 'https://openrouter.ai/api/v1';
  private tier: keyof ModelConfig;
  private preferredModels: { generator?: string; reviewer?: string; verifier?: string; semantic_repair?: string; fallback?: string } = {};
  private preferredFallbackChain: string[] = [];
  private defaultExecutionContext: ModelCallExecutionContext = {};
  private runQuarantinedModels = new Map<string, string>();
  private runProvider400Failures = new Map<string, number>();

  constructor(apiKey?: string, tier: keyof ModelConfig = DEFAULT_SAFE_TIER) {
    this.apiKey = apiKey || process.env.OPENROUTER_API_KEY || '';
    this.tier = tier;
    
    if (!this.apiKey) {
      console.warn('OpenRouter API key not configured. AI features will be limited.');
    }
  }

  getTier(): keyof ModelConfig {
    return this.tier;
  }

  getModels(): ModelTier {
    return MODEL_TIERS[this.tier];
  }

  setPreferredModel(type: 'generator' | 'reviewer' | 'verifier' | 'semantic_repair' | 'fallback', model: string | undefined): void {
    this.preferredModels[type] = model;
  }

  getPreferredModel(type: 'generator' | 'reviewer' | 'verifier' | 'semantic_repair' | 'fallback'): string | undefined {
    return this.preferredModels[type];
  }

  setPreferredTier(tier: keyof ModelConfig): void {
    this.tier = tier;
  }

  setFallbackChain(models: string[]): void {
    const MAX_CHAIN_LENGTH = 10;
    this.preferredFallbackChain = models
      .filter(m => !!sanitizeConfiguredModel(m))
      .slice(0, MAX_CHAIN_LENGTH);
  }

  getFallbackChain(): string[] {
    return this.preferredFallbackChain;
  }

  setDefaultExecutionContext(context?: ModelCallExecutionContext): void {
    this.defaultExecutionContext = {
      abortSignal: context?.abortSignal,
      phase: context?.phase,
      onAttemptUpdate: context?.onAttemptUpdate,
    };
  }

  private applyFailureCooldown(model: string, errorMessage: string): void {
    applyOpenRouterFailureCooldown(model, errorMessage);
  }

  private isModelQuarantinedForRun(model: string | null | undefined): boolean {
    const sanitized = sanitizeConfiguredModel(model);
    return sanitized ? this.runQuarantinedModels.has(sanitized) : false;
  }

  private quarantineModelForRun(model: string, reason: string): void {
    const sanitized = sanitizeConfiguredModel(model);
    if (!sanitized) return;
    if (!this.runQuarantinedModels.has(sanitized)) {
      logger.warn('Quarantining AI model for current run after repeated hard failures', {
        model: sanitized,
        reason,
      });
    }
    this.runQuarantinedModels.set(sanitized, reason);
  }

  private recordRunFailure(model: string, errorMessage: string): void {
    const sanitized = sanitizeConfiguredModel(model);
    if (!sanitized) return;
    const normalized = String(errorMessage || '').toLowerCase();

    if (
      normalized.includes('not a valid model') ||
      normalized.includes('not found') ||
      normalized.includes('nicht gefunden')
    ) {
      this.quarantineModelForRun(sanitized, 'invalid or unavailable model id');
      return;
    }

    const repeatedProvider400 =
      normalized.includes('status: 400')
      || normalized.includes('provider returned error. status: 400')
      || normalized.includes('request too large')
      || normalized.includes('request zu gross');

    if (!repeatedProvider400) return;

    const nextCount = (this.runProvider400Failures.get(sanitized) || 0) + 1;
    this.runProvider400Failures.set(sanitized, nextCount);
    if (nextCount >= 2) {
      this.quarantineModelForRun(sanitized, 'repeated provider 400 failure');
    }
  }

  async callModel(
    modelType: 'generator' | 'reviewer' | 'verifier' | 'semantic_repair',
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number = 6000,
    temperature: number = 0.7,
    responseFormat?: { type: 'json_object' },
    executionContext?: ModelCallExecutionContext,
  ): Promise<{ content: string; usage: TokenUsage; model: string; finishReason?: string }> {
    const mergedExecutionContext: ModelCallExecutionContext = {
      abortSignal: executionContext?.abortSignal ?? this.defaultExecutionContext.abortSignal,
      phase: executionContext?.phase ?? this.defaultExecutionContext.phase,
      onAttemptUpdate: executionContext?.onAttemptUpdate ?? this.defaultExecutionContext.onAttemptUpdate,
    };
    // Use preferred model if set, otherwise use tier-based model
    let modelName: string;
    if (this.preferredModels[modelType]) {
      modelName = this.preferredModels[modelType]!;
    } else {
      const models = this.getModels();
      if (modelType === 'generator') {
        modelName = models.generator;
      } else if (modelType === 'reviewer') {
        modelName = models.reviewer;
      } else if (modelType === 'semantic_repair') {
        modelName = models.semanticRepair;
      } else {
        modelName = models.verifier;
      }
    }

    // ÄNDERUNG 04.03.2026: Versuche direkten Provider-Aufruf fuer bestimmte Modelle
    const provider = this.detectProviderForModel(modelName);
    const phase = String(mergedExecutionContext.phase || 'unspecified');
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    let status: ModelCallAttemptUpdate['status'] = 'failed';
    let finishReason: string | undefined;
    let errorMessage: string | undefined;
    let providerName = provider && provider !== 'openrouter' ? provider : 'openrouter';
    const publishAttemptUpdate = (update: Partial<ModelCallAttemptUpdate>) => {
      mergedExecutionContext.onAttemptUpdate?.({
        role: modelType,
        model: modelName,
        phase,
        provider: providerName,
        status,
        startedAt,
        ...update,
      });
    };

    publishAttemptUpdate({ status: 'started' });
    console.log(`[OpenRouterClient] Model: ${modelName}, Detected provider: ${provider || 'openrouter'}`);

    try {
      if (provider && provider !== 'openrouter') {
        console.log(`[OpenRouterClient] Attempting direct ${provider} call for ${modelName}`);
        try {
          const result = await this.callProviderDirectly(
            provider,
            modelName,
            systemPrompt,
            userPrompt,
            maxTokens,
            temperature,
            responseFormat,
            mergedExecutionContext,
          );
          finishReason = result.finishReason;
          status = 'succeeded';
          errorMessage = undefined;
          console.log(`[OpenRouterClient] Direct ${provider} call successful for ${modelName}`);
          return result;
        } catch (error: any) {
          if (error?.name === 'AbortError' || error?.code === 'ERR_CLIENT_DISCONNECT') {
            throw error;
          }
          errorMessage = error?.message || `Direct ${provider} call failed`;
          providerName = 'openrouter';
          console.warn(`[OpenRouterClient] Direct provider call failed for ${modelName}; falling back to OpenRouter:`, errorMessage);
        }
      }

      console.log(`[OpenRouterClient] Using OpenRouter for ${modelName}`);

      if (!this.apiKey) {
        throw new Error('OpenRouter API key not configured');
      }

      const requestBody: OpenRouterRequest = {
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: maxTokens,
        temperature,
        ...(responseFormat ? { response_format: responseFormat } : {})
      };

      const timeoutMs = Number(process.env.OPENROUTER_TIMEOUT_MS || 90000);
      const controller = new AbortController();
      let timedOut = false;
      let callerAborted = false;
      const abortFromCaller = () => {
        callerAborted = true;
        controller.abort(mergedExecutionContext.abortSignal?.reason);
      };

      if (mergedExecutionContext.abortSignal) {
        if (mergedExecutionContext.abortSignal.aborted) {
          abortFromCaller();
        } else {
          mergedExecutionContext.abortSignal.addEventListener('abort', abortFromCaller, { once: true });
        }
      }

      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error(`Timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.REPL_SLUG
              ? `https://${process.env.REPL_SLUG}.replit.app`
              : 'https://nexora.app',
            'X-Title': 'NEXORA - AI PRD Platform'
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorData: any = {};

          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { message: errorText };
          }

          const errorMsg = extractOpenRouterErrorMessage(errorData, errorText);
          const normalizedError = errorMsg.toLowerCase();

          if (
            response.status === 429 ||
            normalizedError.includes('rate limit') ||
            normalizedError.includes('too many requests') ||
            normalizedError.includes('temporarily rate-limited')
          ) {
            throw new Error('Rate limit exceeded. OpenRouter has temporarily limited your requests. Please wait a few minutes and try again, or upgrade your OpenRouter plan at https://openrouter.ai/settings/limits');
          }

          if (
            response.status === 403 &&
            (
              normalizedError.includes('key limit exceeded') ||
              normalizedError.includes('monthly limit') ||
              normalizedError.includes('quota')
            )
          ) {
            throw new Error('OpenRouter key quota exceeded (monthly limit). Please adjust key limits in OpenRouter settings or use free models only.');
          }

          if (
            response.status === 401 ||
            (
              response.status === 403 &&
              (
                normalizedError.includes('unauthorized') ||
                normalizedError.includes('forbidden') ||
                normalizedError.includes('invalid') ||
                normalizedError.includes('api key')
              )
            )
          ) {
            throw new Error('OpenRouter API key is invalid or unauthorized. Please check your OPENROUTER_API_KEY in settings or get a new key at https://openrouter.ai/keys');
          }

          if (
            response.status === 402 ||
            normalizedError.includes('insufficient') ||
            normalizedError.includes('credit')
          ) {
            throw new Error('Insufficient credits in your OpenRouter account. Please add credits at https://openrouter.ai/settings/credits or switch to a free model in Settings.');
          }

          if (response.status === 400 && errorText.includes('max_tokens')) {
            throw new Error(`The requested content is too long for model ${modelName}. Try splitting your PRD into smaller sections.`);
          }

          if (response.status === 404 || errorText.includes('No endpoints found') || errorText.includes('not found')) {
            throw new Error(`Model "${modelName}" is no longer available on OpenRouter. Please go to Settings and select a different model.`);
          }

          if (response.status === 503 || response.status === 504) {
            throw new Error(`Model ${modelName} is temporarily unavailable or overloaded. The system will automatically try a backup model.`);
          }

          throw new Error(`AI model error (${modelName}): ${errorMsg}. Status: ${response.status}`);
        }

        const data: OpenRouterResponse = await response.json();

        if (!data.choices || !data.choices[0]?.message?.content) {
          throw new Error(`Model ${modelName} returned an empty response. Please try again.`);
        }

        finishReason = data.choices[0]?.finish_reason;
        status = 'succeeded';
        errorMessage = undefined;
        return {
          content: stripThinkTags(data.choices[0].message.content),
          usage: data.usage,
          model: data.model,
          finishReason,
        };
      } catch (error: any) {
        console.error(`Error calling ${modelName}:`, error.message);
        errorMessage = error?.message || 'Unknown error';

        if (error?.name === 'AbortError') {
          status = timedOut ? 'failed' : 'aborted';
          if (timedOut) {
            throw new Error(`Model ${modelName} timed out after ${timeoutMs}ms. The system will try a fallback model.`);
          }
          if (callerAborted || mergedExecutionContext.abortSignal?.aborted) {
            const abortError: any = new Error(`Model ${modelName} aborted by caller.`);
            abortError.name = 'AbortError';
            abortError.code = 'ERR_CLIENT_DISCONNECT';
            throw abortError;
          }
        }

        if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
          throw new Error('Cannot connect to OpenRouter API. Please check your internet connection and try again.');
        }

        throw error;
      } finally {
        clearTimeout(timeout);
        if (mergedExecutionContext.abortSignal) {
          mergedExecutionContext.abortSignal.removeEventListener('abort', abortFromCaller);
        }
      }
    } catch (error: any) {
      errorMessage = error?.message || errorMessage;
      if (error?.name === 'AbortError' || error?.code === 'ERR_CLIENT_DISCONNECT') {
        status = 'aborted';
      } else if (status !== 'succeeded') {
        status = 'failed';
      }
      throw error;
    } finally {
      const endedAtMs = Date.now();
      const endedAt = new Date(endedAtMs).toISOString();
      const durationMs = endedAtMs - startedAtMs;
      publishAttemptUpdate({
        status,
        endedAt,
        durationMs,
        ...(finishReason ? { finishReason } : {}),
        ...(errorMessage ? { errorMessage } : {}),
      });
      logger.info('AI model call completed', {
        role: modelType,
        model: modelName,
        phase,
        provider: providerName,
        startedAt,
        endedAt,
        durationMs,
        status,
        finishReason: finishReason || null,
        errorMessage: errorMessage || null,
      });
    }
  }

  /**
   * ÄNDERUNG 04.03.2026: Registry-basierte Provider-Erkennung.
   * Nutzt die Model-Provider Registry statt Vendor-Prefix-Heuristik,
   * um Modelle korrekt an den richtigen Provider zu routen.
   */
  private detectProviderForModel(modelName: string): AIProvider | null {
    const preferredProvider = TIER_PROVIDER_HINT[this.tier];
    const provider = getBestDirectProvider(modelName, preferredProvider);

    if (provider) {
      console.log(`[OpenRouterClient] Registry matched ${modelName} to provider: ${provider}`);
    } else {
      console.log(`[OpenRouterClient] No direct provider for ${modelName}, using OpenRouter`);
    }

    return provider;
  }

  /**
   * ÄNDERUNG 04.03.2026: Ruft einen Provider direkt auf (nicht über OpenRouter)
   */
  private async callProviderDirectly(
    provider: AIProvider,
    modelName: string,
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number,
    temperature: number,
    responseFormat?: { type: 'json_object' },
    executionContext?: ModelCallExecutionContext,
  ): Promise<{ content: string; usage: TokenUsage; model: string; finishReason?: string }> {
    const normalizedProvider = String(provider).replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
    const apiKey = process.env[`${normalizedProvider}_API_KEY`] || '';
    if (!apiKey) {
      throw new Error(`${provider} API key not configured`);
    }

    const providerInstance = createProvider(provider, apiKey);
    
    const result = await providerInstance.callModel({
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature,
      maxTokens,
      responseFormat,
      abortSignal: executionContext?.abortSignal,
    });

    return {
      content: stripThinkTags(result.content),
      usage: {
        prompt_tokens: result.usage.inputTokens,
        completion_tokens: result.usage.outputTokens,
        total_tokens: result.usage.totalTokens,
      },
      model: result.model,
      finishReason: result.finishReason,
    };
  }

  async callWithFallback(
    modelType: 'generator' | 'reviewer' | 'verifier' | 'semantic_repair',
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number = 4000,
    responseFormat?: { type: 'json_object' },
    temperature?: number,
    constraints?: CallWithFallbackConstraints,
  ): Promise<{ content: string; usage: TokenUsage; model: string; tier: string; usedFallback: boolean; finishReason?: string; fallbackDiagnostics: import('./openrouterFallback').FallbackAttemptDiagnostic[] }> {
    const mergedConstraints: CallWithFallbackConstraints | undefined = constraints
      ? {
          ...this.defaultExecutionContext,
          ...constraints,
        }
      : (Object.keys(this.defaultExecutionContext).length > 0 ? { ...this.defaultExecutionContext } : undefined);

    return executeOpenRouterFallback({
      modelType,
      systemPrompt,
      userPrompt,
      maxTokens,
      responseFormat,
      temperature,
      constraints: mergedConstraints,
      tier: this.tier,
      preferredModels: this.preferredModels,
      preferredFallbackChain: this.preferredFallbackChain,
      isModelQuarantined: (model) => this.isModelQuarantinedForRun(model),
      recordFailureForRun: (model, errorMessage) => this.recordRunFailure(model, errorMessage),
      callModel: (role, nextSystemPrompt, nextUserPrompt, nextMaxTokens, nextTemperature, nextResponseFormat, nextExecutionContext) =>
        this.callModel(role, nextSystemPrompt, nextUserPrompt, nextMaxTokens, nextTemperature, nextResponseFormat, nextExecutionContext),
      withTemporaryPreferredModel: async (role, model, run) => {
        const savedPreferred = this.preferredModels[role];
        this.preferredModels[role] = model;
        try {
          return await run();
        } finally {
          this.preferredModels[role] = savedPreferred;
        }
      },
    });
  }
}

/**
 * Create a new OpenRouterClient instance per request to prevent cross-user contamination.
 * Each request gets its own client with isolated state for preferences.
 */
export function getOpenRouterClient(tier?: keyof ModelConfig): OpenRouterClient {
  // Ignore process.env.AI_TIER — it could force paid models globally for all users.
  // Base tier is always DEFAULT_SAFE_TIER ('development' = free models).
  // User-specific tier is applied later via createClientWithUserPreferences().
  const selectedTier = tier || DEFAULT_SAFE_TIER;

  // Always create a fresh instance to prevent shared mutable state
  return new OpenRouterClient(undefined, selectedTier);
}

/**
 * Check if OpenRouter API key is configured
 */
export function isOpenRouterConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

/**
 * Get user-friendly error message if OpenRouter is not configured
 */
export function getOpenRouterConfigError(): string {
  return `OpenRouter API key is not configured. Please add OPENROUTER_API_KEY to your environment variables. You can get a free API key at https://openrouter.ai/keys`;
}

// Startup check
if (!isOpenRouterConfigured()) {
  console.warn('⚠️  WARNING: OPENROUTER_API_KEY is not set. Dual-AI features will not work.');
  console.warn('   Get your free API key at: https://openrouter.ai/keys');
}

export { fetchOpenRouterModels } from './openrouterModelsApi';
export type { OpenRouterModel } from './openrouterModelsApi';

export {
  OpenRouterClient,
  MODEL_TIERS,
  DEPRECATED_MODEL_IDS,
  DEFAULT_SAFE_TIER,
  DEFAULT_FREE_GENERATOR_MODEL,
  DEFAULT_FREE_REVIEWER_MODEL,
  DEFAULT_FREE_FALLBACK_MODEL,
  DEFAULT_FALLBACK_MODEL_BY_TIER,
  DEFAULT_FREE_FALLBACK_CHAIN,
  DEFAULT_PRODUCTION_FALLBACK_CHAIN,
  DEFAULT_PREMIUM_FALLBACK_CHAIN,
  sanitizeConfiguredModel,
  getDefaultFallbackModelForTier,
  getDefaultFallbackChainForTier,
  resolveModelTier,
  getAllActiveCooldowns,
  getGlobalCooldownStatus,
  setGlobalCooldown,
  clearGlobalCooldown,
  getProviderCooldownStatus,
  setProviderCooldown,
  clearProviderCooldown,
};
export type { ModelTier, ModelConfig };
export type { CallWithFallbackConstraints, ModelFamilyFallbackEvent };

/**
 * Shared factory: create an OpenRouterClient configured with user's AI preferences.
 * Single source of truth for DualAiService and GuidedAiService.
 */
export async function createClientWithUserPreferences(
  userId: string | undefined,
  log?: (msg: string, data?: any) => void,
): Promise<{ client: OpenRouterClient; contentLanguage: string | null }> {
  const client = getOpenRouterClient();
  const contentLanguage = await applyUserPreferencesToClient(client, userId, log);
  return { client, contentLanguage };
}
