import type { TokenUsage } from "@shared/schema";
import { fetchOpenRouterModels } from "./openrouter";
import { normalizeTokenCount } from "./tokenMath";

export interface ModelPricing {
  prompt: number;
  completion: number;
}

// Prices in USD per token (prompt / completion). Updated as of 2025-05.
export const FALLBACK_MODEL_PRICING: Record<string, ModelPricing> = {
  "anthropic/claude-sonnet-4": { prompt: 3e-6, completion: 15e-6 },
  "anthropic/claude-haiku-4": { prompt: 0.8e-6, completion: 4e-6 },
  "anthropic/claude-3.5-sonnet": { prompt: 3e-6, completion: 15e-6 },
  "google/gemini-2.5-flash": { prompt: 0.15e-6, completion: 0.6e-6 },
  "google/gemini-2.0-flash-exp:free": { prompt: 0, completion: 0 },
  "openai/gpt-4o": { prompt: 2.5e-6, completion: 10e-6 },
  "openai/gpt-4o-mini": { prompt: 0.15e-6, completion: 0.6e-6 },
  "deepseek/deepseek-r1-0528:free": { prompt: 0, completion: 0 },
  "meta-llama/llama-3.3-70b-instruct:free": { prompt: 0, completion: 0 },
  "llama-3.1-8b-instant": { prompt: 0.05e-6, completion: 0.08e-6 },
  "gemma2-9b-it": { prompt: 0.20e-6, completion: 0.20e-6 },
  "llama-3.3-70b-versatile": { prompt: 0.59e-6, completion: 0.79e-6 },
  "mixtral-8x7b-32768": { prompt: 0.24e-6, completion: 0.24e-6 },
  "llama3-70b-8192": { prompt: 0.59e-6, completion: 0.79e-6 },
  "llama3-8b-8192": { prompt: 0.05e-6, completion: 0.08e-6 },
  "llama3.1-8b": { prompt: 0.10e-6, completion: 0.10e-6 },
  "llama-3.3-70b": { prompt: 0.85e-6, completion: 1.20e-6 },
};

export function getFallbackModelPricing(modelId: string): ModelPricing | null {
  return FALLBACK_MODEL_PRICING[modelId] || null;
}

export async function getModelPricing(modelId: string): Promise<ModelPricing> {
  try {
    const models = await fetchOpenRouterModels();
    const match = models.find(model => model.id === modelId);
    if (match) {
      return {
        prompt: parseFloat(match.pricing.prompt) || 0,
        completion: parseFloat(match.pricing.completion) || 0,
      };
    }
  } catch {
    // API unavailable — fall through to fallback pricing.
  }

  return getFallbackModelPricing(modelId) || { prompt: 0, completion: 0 };
}

export function estimateUsageCostUsd(
  modelId: string,
  usage: Pick<TokenUsage, "prompt_tokens" | "completion_tokens" | "total_tokens">
): number | null {
  const pricing = getFallbackModelPricing(modelId);
  if (!pricing) {
    return null;
  }

  const promptTokens = normalizeTokenCount(usage.prompt_tokens);
  const completionTokens = normalizeTokenCount(usage.completion_tokens);

  return promptTokens * pricing.prompt + completionTokens * pricing.completion;
}
