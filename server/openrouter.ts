// OpenRouter API Client for Dual-AI System
// Based on HRP-17 Specification

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

// Model configuration with currently available models (verified Feb 2026)
const MODEL_TIERS: ModelConfig = {
  development: {
    generator: "deepseek/deepseek-r1-0528:free",
    reviewer: "meta-llama/llama-3.3-70b-instruct:free",
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

  constructor(apiKey?: string, tier: keyof ModelConfig = 'production') {
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

  async callModel(
    modelType: 'generator' | 'reviewer',
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number = 6000,
    temperature: number = 0.7
  ): Promise<{ content: string; usage: any; model: string }> {
    if (!this.apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    // Use preferred model if set, otherwise use tier-based model
    let modelName: string;
    if (this.preferredModels[modelType]) {
      modelName = this.preferredModels[modelType]!;
    } else {
      const models = this.getModels();
      modelName = modelType === 'generator' ? models.generator : models.reviewer;
    }

    const requestBody: OpenRouterRequest = {
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: maxTokens,
      temperature
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
        
        // Handle specific error types with user-friendly messages
        if (response.status === 401 || response.status === 403) {
          throw new Error('OpenRouter API key is invalid or unauthorized. Please check your OPENROUTER_API_KEY in settings or get a new key at https://openrouter.ai/keys');
        }
        
        if (response.status === 429) {
          throw new Error('Rate limit exceeded. OpenRouter has temporarily limited your requests. Please wait a few minutes and try again, or upgrade your OpenRouter plan at https://openrouter.ai/settings/limits');
        }
        
        if (response.status === 402 || errorText.includes('insufficient') || errorText.includes('credit')) {
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
        const errorMsg = errorData?.error?.message || errorData.message || errorText;
        throw new Error(`AI model error (${modelName}): ${errorMsg}. Status: ${response.status}`);
      }

      const data: OpenRouterResponse = await response.json();
      
      if (!data.choices || !data.choices[0]?.message?.content) {
        throw new Error(`Model ${modelName} returned an empty response. Please try again.`);
      }
      
      return {
        content: data.choices[0].message.content,
        usage: data.usage,
        model: data.model
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

  async callWithFallback(
    modelType: 'generator' | 'reviewer',
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number = 4000
  ): Promise<{ content: string; usage: any; model: string; tier: string; usedFallback: boolean }> {
    const errors: string[] = [];

    // Build deduplicated ordered list:
    // 1) preferred model for this role
    // 2) explicit fallback model
    // 3) tier default for this role
    // 4) optional cross-role fallbacks (only when explicitly enabled)
    const seen = new Set<string>();
    const modelsToTry: Array<{ model: string; isPrimary: boolean }> = [];

    const addIfNew = (model: string | undefined, isPrimary: boolean) => {
      if (model && !seen.has(model)) {
        seen.add(model);
        modelsToTry.push({ model, isPrimary });
      }
    };

    const primary = this.preferredModels[modelType];
    const fallback = this.preferredModels.fallback;
    const tierModels = MODEL_TIERS[this.tier];
    const roleDefault = modelType === 'generator' ? tierModels.generator : tierModels.reviewer;
    const crossRolePreferred = this.preferredModels[modelType === 'generator' ? 'reviewer' : 'generator'];
    const crossRoleTierDefault = modelType === 'generator' ? tierModels.reviewer : tierModels.generator;
    const allowCrossRoleFallback = process.env.ALLOW_CROSS_ROLE_MODEL_FALLBACK === 'true';

    addIfNew(primary, true);
    addIfNew(fallback, false);
    addIfNew(roleDefault, false);

    // Optional legacy behavior: allow using the other role's model as last-resort fallback.
    if (allowCrossRoleFallback) {
      addIfNew(crossRolePreferred, false);
      addIfNew(crossRoleTierDefault, false);
    }

    for (let i = 0; i < modelsToTry.length; i++) {
      const { model: attemptModel, isPrimary } = modelsToTry[i];

      try {
        console.log(`Attempting ${modelType} with ${attemptModel} (${isPrimary ? 'primary' : 'fallback'})`);

        const savedPreferred = this.preferredModels[modelType];
        this.preferredModels[modelType] = attemptModel;

        try {
          const result = await this.callModel(modelType, systemPrompt, userPrompt, maxTokens);
          const usedFallback = !isPrimary;
          if (usedFallback) {
            console.log(`⚠️ Fallback used: ${attemptModel} instead of ${primary || 'none'}`);
          }
          return { ...result, tier: this.tier, usedFallback };
        } finally {
          this.preferredModels[modelType] = savedPreferred;
        }
      } catch (error: any) {
        errors.push(`${attemptModel}: ${error.message}`);
        console.warn(`${attemptModel} failed, trying next model...`, error.message);
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
  const envTier = (process.env.AI_TIER as keyof ModelConfig) || 'production';
  const selectedTier = tier || envTier;
  
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

export { OpenRouterClient, MODEL_TIERS };
export type { ModelTier, ModelConfig };
