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

// Model configuration based on HRP-17
const MODEL_TIERS: ModelConfig = {
  development: {
    generator: "mistralai/mistral-7b-instruct",
    reviewer: "google/gemini-flash-1.5",
    cost: "$0/Million Tokens"
  },
  production: {
    generator: "openai/gpt-4o",  // GPT-5 not yet available, using GPT-4o
    reviewer: "anthropic/claude-3.5-sonnet",  // Opus 4.1 not yet available
    cost: "~$0.30-0.50 pro PRD"
  },
  premium: {
    generator: "anthropic/claude-3.5-sonnet",
    reviewer: "openai/gpt-4o",
    cost: "~$0.50-1.00 pro PRD"
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
  private preferredModels: { generator?: string; reviewer?: string } = {};

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

  setPreferredModel(type: 'generator' | 'reviewer', model: string | undefined): void {
    this.preferredModels[type] = model;
  }

  getPreferredModel(type: 'generator' | 'reviewer'): string | undefined {
    return this.preferredModels[type];
  }

  setPreferredTier(tier: keyof ModelConfig): void {
    this.tier = tier;
  }

  async callModel(
    modelType: 'generator' | 'reviewer',
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number = 4000,
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
        body: JSON.stringify(requestBody)
      });

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
        
        if (response.status === 503 || response.status === 504) {
          throw new Error(`Model ${modelName} is temporarily unavailable or overloaded. The system will automatically try a backup model.`);
        }
        
        // Generic error with model name
        throw new Error(`AI model error (${modelName}): ${errorData.message || errorText}. Status: ${response.status}`);
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
      console.error(`Error calling ${modelName}:`, error.message);
      
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
  ): Promise<{ content: string; usage: any; model: string; tier: string }> {
    const tiers: (keyof ModelConfig)[] = ['premium', 'production', 'development'];
    const startIndex = tiers.indexOf(this.tier);
    const originalTier = this.tier;
    
    // Try current tier and all lower tiers
    for (let i = startIndex; i < tiers.length; i++) {
      const fallbackTier = tiers[i];
      const fallbackModels = MODEL_TIERS[fallbackTier];
      const attemptModel = modelType === 'generator' 
        ? fallbackModels.generator 
        : fallbackModels.reviewer;

      try {
        console.log(`Attempting ${modelType} with ${attemptModel} (${fallbackTier} tier)`);
        
        // Temporarily switch tier for this call only
        this.tier = fallbackTier;
        
        const result = await this.callModel(
          modelType, 
          systemPrompt, 
          userPrompt, 
          maxTokens
        );
        
        // Success! Return result and restore tier
        return {
          ...result,
          tier: fallbackTier
        };
      } catch (error: any) {
        console.warn(`${attemptModel} failed, trying fallback...`, error.message);
        
        // If this is the last tier, restore original tier and throw
        if (i === tiers.length - 1) {
          this.tier = originalTier;
          throw new Error(`All models failed. Last error: ${error.message}`);
        }
        
        // Continue to next tier
        continue;
      } finally {
        // Always restore original tier to prevent cross-request contamination
        this.tier = originalTier;
      }
    }

    // Safety: restore tier even if loop exits abnormally
    this.tier = originalTier;
    throw new Error('All fallback attempts failed');
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

// Startup check
if (!isOpenRouterConfigured()) {
  console.warn('⚠️  WARNING: OPENROUTER_API_KEY is not set. Dual-AI features will not work.');
  console.warn('   Get your free API key at: https://openrouter.ai/keys');
}

export { OpenRouterClient, MODEL_TIERS };
export type { ModelTier, ModelConfig };
