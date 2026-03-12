/**
 * Author: rahn
 * Datum: 03.03.2026
 * Version: 1.1
 * Beschreibung: Provider Factory und zentrale Exporte
 *
 * ÄNDERUNG 04.03.2026: Import-Extensions korrigiert (.js entfernt)
 */

// ÄNDERUNG 03.03.2026: Zentrale Provider-Factory

export * from './base';
export { GroqProvider } from './groq';
export { CerebrasProvider } from './cerebras';
export { NvidiaProvider } from './nvidia';
export { AbacusProvider } from './abacus';

import { GroqProvider } from './groq';
import { CerebrasProvider } from './cerebras';
import { NvidiaProvider } from './nvidia';
import { AbacusProvider } from './abacus';
import type { BaseAIProvider, AIProvider, ProviderConfig, AIModel } from './base';
import { PROVIDER_METADATA } from './base';

// OpenRouter Modelle (statisch definiert, da sie von der API kommen könnten)
const OPENROUTER_MODELS: AIModel[] = [
  // Free Modelle
  {
    id: 'nvidia/nemotron-3-nano-30b-a3b:free',
    name: 'Nemotron 3 Nano 30B',
    provider: 'openrouter',
    contextLength: 128000,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion'],
  },
  {
    id: 'arcee-ai/trinity-large-preview:free',
    name: 'Trinity Large Preview',
    provider: 'openrouter',
    contextLength: 128000,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion'],
  },
  {
    id: 'google/gemma-3-27b-it:free',
    name: 'Gemma 3 27B IT',
    provider: 'openrouter',
    contextLength: 128000,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion'],
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    name: 'Llama 3.3 70B Instruct',
    provider: 'openrouter',
    contextLength: 128000,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion'],
  },
  {
    id: 'mistralai/mistral-small-3.1-24b-instruct:free',
    name: 'Mistral Small 3.1 24B',
    provider: 'openrouter',
    contextLength: 128000,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion'],
  },
  {
    id: 'qwen/qwen3-coder:free',
    name: 'Qwen3 Coder',
    provider: 'openrouter',
    contextLength: 128000,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion'],
  },
  // Paid Modelle
  {
    id: 'anthropic/claude-sonnet-4',
    name: 'Claude Sonnet 4',
    provider: 'openrouter',
    contextLength: 200000,
    isFree: false,
    pricing: { input: 3.0, output: 15.0 },
    capabilities: ['chat', 'completion', 'streaming'],
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'openrouter',
    contextLength: 1000000,
    isFree: false,
    pricing: { input: 0.15, output: 0.6 },
    capabilities: ['chat', 'completion', 'streaming'],
  },
  {
    id: 'google/gemini-2.5-pro-preview',
    name: 'Gemini 2.5 Pro Preview',
    provider: 'openrouter',
    contextLength: 1000000,
    isFree: false,
    pricing: { input: 1.25, output: 10.0 },
    capabilities: ['chat', 'completion', 'streaming'],
  },
];

// Factory Funktion um Provider zu erstellen
export function createProvider(
  provider: AIProvider,
  apiKey: string,
  log?: (msg: string, data?: any) => void
): BaseAIProvider {
  switch (provider) {
    case 'groq':
      return new GroqProvider(apiKey, log);
    case 'cerebras':
      return new CerebrasProvider(apiKey, log);
    case 'nvidia':
      return new NvidiaProvider(apiKey, log);
    case 'abacus':
      return new AbacusProvider(apiKey, log);
    default:
      throw new Error(`Provider ${provider} wird nicht unterstützt. Bitte nutze OpenRouter über den bestehenden Client.`);
  }
}

// Hilfsfunktion um alle Modelle eines Providers zu erhalten
export async function getModelsForProvider(provider: AIProvider): Promise<AIModel[]> {
  switch (provider) {
    case 'openrouter':
      return OPENROUTER_MODELS;
    case 'groq': {
      // Versuche mit API Key aus Umgebungsvariable, sonst Fallback
      const apiKey = process.env.GROQ_API_KEY || '';
      const groq = new GroqProvider(apiKey);
      return groq.getModels();
    }
    case 'cerebras': {
      // Versuche mit API Key aus Umgebungsvariable, sonst Fallback
      const apiKey = process.env.CEREBRAS_API_KEY || '';
      const cerebras = new CerebrasProvider(apiKey);
      return cerebras.getModels();
    }
    case 'nvidia': {
      // Versuche mit API Key aus Umgebungsvariable, sonst Fallback
      const apiKey = process.env.NVIDIA_API_KEY || '';
      const nvidia = new NvidiaProvider(apiKey);
      return nvidia.getModels();
    }
    case 'abacus': {
      const apiKey = process.env.ABACUS_API_KEY || '';
      const abacus = new AbacusProvider(apiKey);
      return abacus.getModels();
    }
    default:
      return [];
  }
}

// Hilfsfunktion um alle Provider zu erhalten
export function getAllProviders(): ProviderConfig[] {
  return Object.values(PROVIDER_METADATA);
}

// Hilfsfunktion um alle verfügbaren Modelle zu erhalten
export async function getAllAvailableModels(): Promise<AIModel[]> {
  const allModels: AIModel[] = [];
  
  for (const provider of Object.keys(PROVIDER_METADATA) as AIProvider[]) {
    const models = await getModelsForProvider(provider);
    allModels.push(...models);
  }
  
  return allModels;
}

// Hilfsfunktion um zu prüfen ob ein Provider konfiguriert ist
export function isProviderConfigured(provider: AIProvider, apiKey?: string): boolean {
  if (!apiKey) return false;
  
  try {
    const instance = createProvider(provider, apiKey);
    return instance.isConfigured();
  } catch {
    return false;
  }
}

// Hilfsfunktion um Provider-Namen zu erhalten
export function getProviderDisplayName(provider: AIProvider): string {
  return PROVIDER_METADATA[provider].displayName;
}

// Hilfsfunktion um Provider-Farbe zu erhalten
export function getProviderColor(provider: AIProvider): string {
  return PROVIDER_METADATA[provider].color;
}

// Hilfsfunktion um Provider-Icon zu erhalten
export function getProviderIcon(provider: AIProvider): string {
  return PROVIDER_METADATA[provider].icon;
}
