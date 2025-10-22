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

    const models = this.getModels();
    const modelName = modelType === 'generator' ? models.generator : models.reviewer;

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
        throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
      }

      const data: OpenRouterResponse = await response.json();
      
      return {
        content: data.choices[0]?.message?.content || '',
        usage: data.usage,
        model: data.model
      };
    } catch (error: any) {
      console.error(`Error calling ${modelName}:`, error.message);
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

// Singleton instance
let openRouterClient: OpenRouterClient | null = null;

export function getOpenRouterClient(tier?: keyof ModelConfig): OpenRouterClient {
  const envTier = (process.env.AI_TIER as keyof ModelConfig) || 'production';
  const selectedTier = tier || envTier;
  
  if (!openRouterClient || openRouterClient.getTier() !== selectedTier) {
    openRouterClient = new OpenRouterClient(undefined, selectedTier);
  }
  
  return openRouterClient;
}

export { OpenRouterClient, MODEL_TIERS };
export type { ModelTier, ModelConfig };
