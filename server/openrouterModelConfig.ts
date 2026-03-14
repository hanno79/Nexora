/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Zentrale Tier-, Default- und Fallback-Konfiguration fuer OpenRouter
*/

// ÄNDERUNG 08.03.2026: Tier-/Fallback-Konfiguration aus `server/openrouter.ts` extrahiert,
// um die Datei konservativ zu verkleinern und die API ueber Re-Exports stabil zu halten.

import type { AIProvider } from './providers/base';

export type { AIProvider } from './providers/base';

export interface ModelTier {
  generator: string;
  reviewer: string;
  verifier: string;
  semanticRepair: string;
  cost: string;
}

export interface ModelConfig {
  development: ModelTier;
  production: ModelTier;
  premium: ModelTier;
  abacus: ModelTier;
}

export const DEFAULT_SAFE_TIER: keyof ModelConfig = 'development';
export const DEFAULT_FREE_GENERATOR_MODEL = 'nvidia/nemotron-3-nano-30b-a3b:free';
export const DEFAULT_FREE_REVIEWER_MODEL = 'arcee-ai/trinity-large-preview:free';
export const DEFAULT_FREE_FALLBACK_MODEL = 'google/gemma-3-27b-it:free';
export const TIER_PROVIDER_HINT: Partial<Record<string, AIProvider>> = {
  abacus: 'abacus',
};

export const DEFAULT_FREE_FALLBACK_CHAIN: readonly string[] = [
  'google/gemma-3-27b-it:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
  'qwen/qwen3-coder:free',
  'openai/gpt-oss-120b:free',
];

// ÄNDERUNG 13.03.2026: Free-Modelle aus Production/Premium-Chains entfernt,
// damit diese Tiers nie versehentlich auf Free-Endpunkte zurueckfallen.
export const DEFAULT_PRODUCTION_FALLBACK_CHAIN: readonly string[] = [
  'google/gemini-2.5-flash',
  'mistralai/mistral-small-3.1-24b-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
];

export const DEFAULT_PREMIUM_FALLBACK_CHAIN: readonly string[] = [
  'anthropic/claude-sonnet-4',
  'google/gemini-2.5-flash',
  'mistralai/mistral-small-3.1-24b-instruct',
];

export const DEFAULT_ABACUS_FALLBACK_CHAIN: readonly string[] = [
  'claude-4-5-sonnet',
  'gpt-5.2',
  'gemini-2.5-pro',
  'deepseek-v3.2',
  'gpt-4.1',
];

export const DEPRECATED_MODEL_IDS = new Set<string>([
  'deepseek/deepseek-r1-0528:free',
  'deepseek-ai/deepseek-r1',
  'deepseek-ai/deepseek-r1:free',
  'qwen-3-235b-a22b-instruct-2507',
]);

export const DEFAULT_FALLBACK_MODEL_BY_TIER: Record<keyof ModelConfig, string> = {
  development: DEFAULT_FREE_FALLBACK_MODEL,
  production: 'google/gemini-2.5-flash',
  premium: 'anthropic/claude-sonnet-4',
  abacus: 'claude-4-5-sonnet',
};

export function getDefaultFallbackChainForTier(tier: keyof ModelConfig): readonly string[] {
  switch (tier) {
    case 'abacus':
      return DEFAULT_ABACUS_FALLBACK_CHAIN;
    case 'premium':
      return DEFAULT_PREMIUM_FALLBACK_CHAIN;
    case 'production':
      return DEFAULT_PRODUCTION_FALLBACK_CHAIN;
    default:
      return DEFAULT_FREE_FALLBACK_CHAIN;
  }
}

export function sanitizeConfiguredModel(model: string | null | undefined): string | undefined {
  const normalized = (model || '').trim();
  if (!normalized) return undefined;
  if (DEPRECATED_MODEL_IDS.has(normalized)) return undefined;
  return normalized;
}

export function getDefaultFallbackModelForTier(tier: keyof ModelConfig): string {
  return DEFAULT_FALLBACK_MODEL_BY_TIER[tier] || DEFAULT_FREE_FALLBACK_MODEL;
}

export const MODEL_TIERS: ModelConfig = {
  development: {
    generator: DEFAULT_FREE_GENERATOR_MODEL,
    reviewer: DEFAULT_FREE_REVIEWER_MODEL,
    verifier: 'google/gemma-3-27b-it:free',
    semanticRepair: DEFAULT_FREE_REVIEWER_MODEL,
    cost: '$0/Million Tokens',
  },
  production: {
    generator: 'google/gemini-2.5-flash',
    reviewer: 'anthropic/claude-sonnet-4',
    verifier: 'mistralai/mistral-small-3.1-24b-instruct',
    cost: '~$0.10-0.30 pro PRD',
    semanticRepair: 'anthropic/claude-sonnet-4',
  },
  premium: {
    generator: 'anthropic/claude-sonnet-4',
    reviewer: 'google/gemini-2.5-pro-preview',
    verifier: 'mistralai/mistral-small-3.1-24b-instruct',
    cost: '~$0.30-1.00 pro PRD',
    semanticRepair: 'google/gemini-2.5-pro-preview',
  },
  abacus: {
    generator: 'route-llm',
    reviewer: 'route-llm',
    verifier: 'route-llm',
    semanticRepair: 'route-llm',
    cost: '~$0.05-0.20 pro PRD (Credits)',
  },
};

export function resolveModelTier(tier: string | null | undefined): keyof ModelConfig {
  if (!tier) return DEFAULT_SAFE_TIER;
  return tier in MODEL_TIERS ? (tier as keyof ModelConfig) : DEFAULT_SAFE_TIER;
}
