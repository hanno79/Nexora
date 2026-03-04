// OpenRouter API Client for Dual-AI System
// Based on HRP-17 Specification
// ÄNDERUNG 04.03.2026: Direkte Provider-Aufrufe als Fallback hinzugefuegt

import type { TokenUsage } from "@shared/schema";
import { createProvider, type AIProvider } from "./providers/index";
import { getBestDirectProvider, resolveProvidersForModel, isOpenRouterFreeModel } from "./modelRegistry";

interface ModelTier {
  generator: string;
  reviewer: string;
  cost: string;
}

interface ModelConfig {
  development: ModelTier;
  production: ModelTier;
  premium: ModelTier;
}

const DEFAULT_SAFE_TIER: keyof ModelConfig = 'development';
const DEFAULT_FREE_GENERATOR_MODEL = 'nvidia/nemotron-3-nano-30b-a3b:free';
const DEFAULT_FREE_REVIEWER_MODEL = 'arcee-ai/trinity-large-preview:free';
const DEFAULT_FREE_FALLBACK_MODEL = 'google/gemma-3-27b-it:free';

// Ordered list of free fallback candidates for development tier.
// Earlier entries are preferred. Users can override this list in Settings.
// HINWEIS: openrouter/free wurde entfernt, da nicht-deterministisch.
// Das Auto-Router-Modell kann zu unterschiedlichen Providern/Modellen führen,
// was Debugging und Fehleranalyse erschwert. Stattdessen nutzen wir eine
// deterministische Kette bekannter, stabiler Free-Modelle.
const DEFAULT_FREE_FALLBACK_CHAIN: readonly string[] = [
  'google/gemma-3-27b-it:free',                           // current single fallback
  'meta-llama/llama-3.3-70b-instruct:free',                // GPT-4 level, 128K
  'mistralai/mistral-small-3.1-24b-instruct:free',         // EU-hosted, 128K
  'qwen/qwen3-coder:free',                                 // 262K context
  'openai/gpt-oss-120b:free',                              // 131K context
];

const DEPRECATED_MODEL_IDS = new Set<string>([
  'deepseek/deepseek-r1-0528:free',
  'deepseek-ai/deepseek-r1',       // NVIDIA EOL seit 26.01.2026
  'deepseek-ai/deepseek-r1:free',  // :free Variante ebenfalls EOL
]);

const DEFAULT_FALLBACK_MODEL_BY_TIER: Record<keyof ModelConfig, string> = {
  development: DEFAULT_FREE_FALLBACK_MODEL,
  production: DEFAULT_FREE_FALLBACK_MODEL,
  premium: DEFAULT_FREE_FALLBACK_MODEL,
};

export function sanitizeConfiguredModel(model: string | null | undefined): string | undefined {
  const normalized = (model || '').trim();
  if (!normalized) return undefined;
  if (DEPRECATED_MODEL_IDS.has(normalized)) return undefined;
  return normalized;
}

export function getDefaultFallbackModelForTier(tier: keyof ModelConfig): string {
  return DEFAULT_FALLBACK_MODEL_BY_TIER[tier] || DEFAULT_FREE_FALLBACK_MODEL;
}

export function resolveModelTier(tier: string | null | undefined): keyof ModelConfig {
  if (!tier) return DEFAULT_SAFE_TIER;
  return tier in MODEL_TIERS ? (tier as keyof ModelConfig) : DEFAULT_SAFE_TIER;
}

function extractOpenRouterErrorMessage(errorData: any, fallbackText: string): string {
  return String(
    errorData?.error?.message ||
    errorData?.message ||
    fallbackText ||
    ''
  ).trim();
}

// --- Global cooldown registry ---
// Shared across all OpenRouterClient instances within the process.
// Persists for the process lifetime; lost on server restart (acceptable: transient state).
const globalModelCooldowns = new Map<string, { until: number; reason: string }>();

function getGlobalCooldownStatus(model: string): { until: number; reason: string } | null {
  const entry = globalModelCooldowns.get(model);
  if (!entry) return null;
  if (Date.now() >= entry.until) {
    globalModelCooldowns.delete(model);
    return null;
  }
  return entry;
}

function setGlobalCooldown(model: string, cooldownMs: number, reason: string): void {
  globalModelCooldowns.set(model, { until: Date.now() + cooldownMs, reason });
}

function clearGlobalCooldown(model: string): void {
  globalModelCooldowns.delete(model);
}

function getAllActiveCooldowns(): Record<string, { until: number; reason: string }> {
  const result: Record<string, { until: number; reason: string }> = {};
  const now = Date.now();
  for (const [model, entry] of globalModelCooldowns) {
    if (now < entry.until) {
      result[model] = entry;
    } else {
      globalModelCooldowns.delete(model);
    }
  }
  return result;
}

// Model configuration with currently available models (verified Feb 2026)
const MODEL_TIERS: ModelConfig = {
  development: {
    generator: DEFAULT_FREE_GENERATOR_MODEL,
    reviewer: DEFAULT_FREE_REVIEWER_MODEL,
    cost: "$0/Million Tokens"
  },
  production: {
    generator: "google/gemini-2.5-flash",
    reviewer: "anthropic/claude-sonnet-4",
    cost: "~$0.10-0.30 pro PRD"
  },
  premium: {
    generator: "anthropic/claude-sonnet-4",
    reviewer: "google/gemini-2.5-pro-preview",
    cost: "~$0.30-1.00 pro PRD"
  }
};

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
  private preferredModels: { generator?: string; reviewer?: string; fallback?: string } = {};
  private preferredFallbackChain: string[] = [];

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

  setPreferredModel(type: 'generator' | 'reviewer' | 'fallback', model: string | undefined): void {
    this.preferredModels[type] = model;
  }

  getPreferredModel(type: 'generator' | 'reviewer' | 'fallback'): string | undefined {
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

  private getActiveCooldown(model: string): { until: number; reason: string } | null {
    return getGlobalCooldownStatus(model);
  }

  private applyFailureCooldown(model: string, errorMessage: string): void {
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
    } else if (message.includes('rate limit exceeded')) {
      cooldownMs = 2 * 60 * 1000;
      reason = 'rate limited';
    }

    if (cooldownMs > 0) {
      setGlobalCooldown(model, cooldownMs, reason);
    }
  }

  async callModel(
    modelType: 'generator' | 'reviewer',
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number = 6000,
    temperature: number = 0.7,
    responseFormat?: { type: 'json_object' }
  ): Promise<{ content: string; usage: TokenUsage; model: string; finishReason?: string }> {
    // Use preferred model if set, otherwise use tier-based model
    let modelName: string;
    if (this.preferredModels[modelType]) {
      modelName = this.preferredModels[modelType]!;
    } else {
      const models = this.getModels();
      modelName = modelType === 'generator' ? models.generator : models.reviewer;
    }

    // ÄNDERUNG 04.03.2026: Versuche direkten Provider-Aufruf fuer bestimmte Modelle
    const provider = this.detectProviderForModel(modelName);
    console.log(`[OpenRouterClient] Model: ${modelName}, Detected provider: ${provider || 'openrouter'}`);
    
    if (provider && provider !== 'openrouter') {
      console.log(`[OpenRouterClient] Attempting direct ${provider} call for ${modelName}`);
      try {
        const result = await this.callProviderDirectly(provider, modelName, systemPrompt, userPrompt, maxTokens, temperature);
        console.log(`[OpenRouterClient] Direct ${provider} call successful for ${modelName}`);
        return result;
      } catch (error: any) {
        console.warn(`[OpenRouterClient] Direct provider call failed for ${modelName}:`, error.message);
        // Nicht zu OpenRouter fallen - NVIDIA-exklusive Modelle existieren dort nicht.
        // callWithFallback() probiert das naechste Modell in der Chain.
        throw new Error(`Direct ${provider} call failed for ${modelName}: ${error.message}`);
      }
    } else {
      console.log(`[OpenRouterClient] Using OpenRouter for ${modelName}`);
    }

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
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: any = {};
        
        try {
          errorData = JSON.parse(errorText);
        } catch {
          // If not JSON, use plain text
          errorData = { message: errorText };
        }
        
        const errorMsg = extractOpenRouterErrorMessage(errorData, errorText);
        const normalizedError = errorMsg.toLowerCase();

        // Handle specific error types with user-friendly messages
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
        
        // Generic error with model name
        throw new Error(`AI model error (${modelName}): ${errorMsg}. Status: ${response.status}`);
      }

      const data: OpenRouterResponse = await response.json();
      
      if (!data.choices || !data.choices[0]?.message?.content) {
        throw new Error(`Model ${modelName} returned an empty response. Please try again.`);
      }
      
      return {
        content: data.choices[0].message.content,
        usage: data.usage,
        model: data.model,
        finishReason: data.choices[0]?.finish_reason,
      };
    } catch (error: any) {
      clearTimeout(timeout);
      console.error(`Error calling ${modelName}:`, error.message);

      if (error?.name === 'AbortError') {
        throw new Error(`Model ${modelName} timed out after ${timeoutMs}ms. The system will try a fallback model.`);
      }
      
      // Network errors
      if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
        throw new Error('Cannot connect to OpenRouter API. Please check your internet connection and try again.');
      }
      
      throw error;
    }
  }

  /**
   * ÄNDERUNG 04.03.2026: Registry-basierte Provider-Erkennung.
   * Nutzt die Model-Provider Registry statt Vendor-Prefix-Heuristik,
   * um Modelle korrekt an den richtigen Provider zu routen.
   */
  private detectProviderForModel(modelName: string): AIProvider | null {
    const provider = getBestDirectProvider(modelName);

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
    temperature: number
  ): Promise<{ content: string; usage: TokenUsage; model: string; finishReason?: string }> {
    const apiKey = process.env[`${provider.toUpperCase()}_API_KEY`] || '';
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
    });

    return {
      content: result.content,
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
    modelType: 'generator' | 'reviewer',
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number = 4000,
    responseFormat?: { type: 'json_object' },
    temperature?: number
  ): Promise<{ content: string; usage: TokenUsage; model: string; tier: string; usedFallback: boolean; finishReason?: string }> {
    const errors: string[] = [];

    // Build deduplicated ordered list:
    // 1) preferred model for this role
    // 2) explicit fallback model
    // 3) tier default for this role
    // 4) optional cross-role fallbacks (only when explicitly enabled)
    const seen = new Set<string>();
    const modelsToTry: Array<{ model: string; isPrimary: boolean }> = [];

    const addIfNew = (model: string | undefined, isPrimary: boolean) => {
      const sanitized = sanitizeConfiguredModel(model);
      if (!sanitized || seen.has(sanitized)) return;

      const activeCooldown = this.getActiveCooldown(sanitized);
      if (activeCooldown) {
        console.warn(`Skipping ${sanitized} due to cooldown: ${activeCooldown.reason}`);
        return;
      }

      seen.add(sanitized);
      modelsToTry.push({ model: sanitized, isPrimary });
    };

    const primary = this.preferredModels[modelType];
    // Support both new fallback chain and legacy single fallback
    const fallbackChain = this.preferredFallbackChain.length > 0
      ? this.preferredFallbackChain
      : (this.preferredModels.fallback ? [this.preferredModels.fallback] : []);
    const tierModels = MODEL_TIERS[this.tier];
    const roleDefault = modelType === 'generator' ? tierModels.generator : tierModels.reviewer;
    const crossRolePreferred = this.preferredModels[modelType === 'generator' ? 'reviewer' : 'generator'];
    const crossRoleTierDefault = modelType === 'generator' ? tierModels.reviewer : tierModels.generator;
    const allowCrossRoleFallback = process.env.ALLOW_CROSS_ROLE_MODEL_FALLBACK === 'true';

    addIfNew(primary, true);
    for (const fb of fallbackChain) {
      addIfNew(fb, false);
    }
    addIfNew(roleDefault, false);

    // Cross-Provider-Fallbacks: Fuer :free Modelle in der Chain prüfen ob eine
    // Direct-Provider-Variante (ohne :free) existiert und als Fallback anfuegen.
    // Das stellt sicher, dass bei OpenRouter-Ausfall Direct-Provider genutzt werden.
    for (const fb of fallbackChain) {
      if (isOpenRouterFreeModel(fb)) {
        const baseModel = fb.replace(/:free$/, '');
        const directProviders = resolveProvidersForModel(baseModel);
        if (directProviders.length > 0) {
          addIfNew(baseModel, false);
        }
      }
    }

    // Direct-Provider kostenlose Modelle als letzte Fallbacks
    if (process.env.NVIDIA_API_KEY) {
      addIfNew('meta/llama-3.3-70b-instruct', false);
    }
    if (process.env.GROQ_API_KEY) {
      addIfNew('llama-3.3-70b-versatile', false);
    }
    if (process.env.CEREBRAS_API_KEY) {
      addIfNew('llama-3.3-70b', false);
    }

    // Optional legacy behavior: allow using the other role's model as last-resort fallback.
    if (allowCrossRoleFallback) {
      addIfNew(crossRolePreferred, false);
      addIfNew(crossRoleTierDefault, false);
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

    for (let i = 0; i < modelsToTry.length; i++) {
      const { model: attemptModel, isPrimary } = modelsToTry[i];

      try {
        console.log(`Attempting ${modelType} with ${attemptModel} (${isPrimary ? 'primary' : 'fallback'})`);

        const savedPreferred = this.preferredModels[modelType];
        this.preferredModels[modelType] = attemptModel;

        try {
          const result = await this.callModel(modelType, systemPrompt, userPrompt, maxTokens, temperature ?? 0.7, responseFormat);
          clearGlobalCooldown(attemptModel);
          const usedFallback = !isPrimary;
          if (usedFallback) {
            console.log(`⚠️ Fallback used: ${attemptModel} instead of ${primary || 'none'}`);
          }
          return { ...result, tier: this.tier, usedFallback };
        } finally {
          this.preferredModels[modelType] = savedPreferred;
        }
      } catch (error: any) {
        this.applyFailureCooldown(attemptModel, error.message || '');
        errors.push(`${attemptModel}: ${error.message}`);
        console.warn(`${attemptModel} failed, trying next model...`, error.message);

        // Provider-weite Fehler: Alle verbleibenden Modelle desselben Providers skippen,
        // wenn ein Fehler den gesamten Provider betrifft (Auth oder Rate Limit).
        const errMsg = (error.message || '').toLowerCase();
        const failedIsOpenRouterOnly = getBestDirectProvider(attemptModel) === null;

        if (
          failedIsOpenRouterOnly && (
            errMsg.includes('api key is invalid') ||
            errMsg.includes('unauthorized') ||
            errMsg.includes('key not configured')
          )
        ) {
          for (const remaining of modelsToTry.slice(i + 1)) {
            if (getBestDirectProvider(remaining.model) === null) {
              setGlobalCooldown(remaining.model, 5 * 60 * 1000, 'openrouter auth failure');
              console.warn(`[Auth-Skip] Cooldown set for ${remaining.model} (OpenRouter auth failure)`);
            }
          }
        }

        // OpenRouter Rate-Limit-Skip: Wenn OpenRouter 429 zurueckgibt, alle
        // verbleibenden OpenRouter-only Modelle auf Cooldown setzen.
        if (
          failedIsOpenRouterOnly &&
          errMsg.includes('rate limit exceeded') &&
          !errMsg.includes('nvidia') &&
          !errMsg.includes('groq') &&
          !errMsg.includes('cerebras')
        ) {
          for (const remaining of modelsToTry.slice(i + 1)) {
            if (getBestDirectProvider(remaining.model) === null) {
              setGlobalCooldown(remaining.model, 2 * 60 * 1000, 'openrouter rate limited');
              console.warn(`[Rate-Skip] Cooldown set for ${remaining.model} (OpenRouter rate limit)`);
            }
          }
        }
      }
    }

    // All models failed - clear error for the user
    const modelList = modelsToTry.map(m => m.model);
    throw new Error(
      `All ${modelList.length} configured AI models failed. Please go to Settings and verify your models are available on OpenRouter.\n\nModels tried:\n${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}`
    );
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

// --- OpenRouter Models List API ---

export interface OpenRouterModel {
  id: string;
  name: string;
  pricing: {
    prompt: string;
    completion: string;
  };
  context_length: number;
  isFree: boolean;
  provider: string;
}

let modelsCache: OpenRouterModel[] | null = null;
let modelsCacheTimestamp: number = 0;
const MODELS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  const now = Date.now();
  if (modelsCache && (now - modelsCacheTimestamp) < MODELS_CACHE_TTL) {
    return modelsCache;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured');
  }

  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models from OpenRouter: ${response.status}`);
  }

  const data = await response.json();
  
  const models: OpenRouterModel[] = (data.data || [])
    .filter((m: any) => m.id && m.name)
    .map((m: any) => {
      const promptPrice = parseFloat(m.pricing?.prompt || '0');
      const completionPrice = parseFloat(m.pricing?.completion || '0');
      const isFree = promptPrice === 0 && completionPrice === 0;
      const provider = m.id.split('/')[0] || 'unknown';
      
      return {
        id: m.id,
        name: m.name,
        pricing: {
          prompt: m.pricing?.prompt || '0',
          completion: m.pricing?.completion || '0',
        },
        context_length: m.context_length || 0,
        isFree,
        provider,
      };
    })
    .sort((a: OpenRouterModel, b: OpenRouterModel) => a.name.localeCompare(b.name));

  modelsCache = models;
  modelsCacheTimestamp = now;
  return models;
}

// Startup check
if (!isOpenRouterConfigured()) {
  console.warn('⚠️  WARNING: OPENROUTER_API_KEY is not set. Dual-AI features will not work.');
  console.warn('   Get your free API key at: https://openrouter.ai/keys');
}

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
  getAllActiveCooldowns,
  getGlobalCooldownStatus,
  setGlobalCooldown,
  clearGlobalCooldown,
};
export type { ModelTier, ModelConfig };

/**
 * Shared factory: create an OpenRouterClient configured with user's AI preferences.
 * Single source of truth for DualAiService and GuidedAiService.
 */
export async function createClientWithUserPreferences(
  userId: string | undefined,
  log?: (msg: string, data?: any) => void,
): Promise<{ client: OpenRouterClient; contentLanguage: string | null }> {
  // Lazy import to avoid circular dependency at module-load time
  const { db } = await import('./db');
  const { users } = await import('@shared/schema');
  const { eq } = await import('drizzle-orm');

  const client = getOpenRouterClient();
  let contentLanguage: string | null = null;

  if (userId) {
    const userPrefs = await db.select({
      aiPreferences: users.aiPreferences,
      defaultContentLanguage: users.defaultContentLanguage,
    })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (userPrefs[0]) {
      contentLanguage = userPrefs[0].defaultContentLanguage || null;

      if (userPrefs[0].aiPreferences) {
        const prefs = userPrefs[0].aiPreferences as any;
        const tier = resolveModelTier(prefs.tier);
        const activeTierModels = prefs.tierModels?.[tier] || {};
        const tierDefaults = MODEL_TIERS[tier] || MODEL_TIERS.development;
        const resolvedGeneratorModel =
          sanitizeConfiguredModel(activeTierModels.generatorModel || prefs.generatorModel) ||
          tierDefaults.generator;
        const resolvedReviewerModel =
          sanitizeConfiguredModel(activeTierModels.reviewerModel || prefs.reviewerModel) ||
          tierDefaults.reviewer;
        const resolvedFallbackModel =
          sanitizeConfiguredModel(activeTierModels.fallbackModel || prefs.fallbackModel) ||
          getDefaultFallbackModelForTier(tier);
        const resolvedFallbackChain: string[] =
          activeTierModels.fallbackChain ??
          (Array.isArray(prefs.fallbackChain) ? prefs.fallbackChain : undefined) ??
          [...DEFAULT_FREE_FALLBACK_CHAIN];

        if (log) {
          log('🤖 User AI preferences loaded:', {
            tier,
            tierGenerator: activeTierModels.generatorModel || '(not set)',
            tierReviewer: activeTierModels.reviewerModel || '(not set)',
            globalGenerator: prefs.generatorModel || '(not set)',
            globalReviewer: prefs.reviewerModel || '(not set)',
            resolvedGenerator: resolvedGeneratorModel,
            resolvedReviewer: resolvedReviewerModel,
            resolvedFallback: resolvedFallbackModel || '(none)',
            fallbackChainLength: resolvedFallbackChain.length,
          });
        }

        if (resolvedGeneratorModel) {
          client.setPreferredModel('generator', resolvedGeneratorModel);
        }
        if (resolvedReviewerModel) {
          client.setPreferredModel('reviewer', resolvedReviewerModel);
        }
        client.setPreferredModel('fallback', resolvedFallbackChain[0] ?? resolvedFallbackModel);
        client.setFallbackChain(resolvedFallbackChain);
        client.setPreferredTier(tier);
      }
    }
  }

  return { client, contentLanguage };
}
