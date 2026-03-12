/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Registriert Provider-/Modell-Routen und enthaelt kleine Helfer fuer Provider-Filter und Modelldeduplizierung.
*/

// ÄNDERUNG 08.03.2026: Provider-/Modell-Routen aus `server/routes.ts` extrahiert,
// um die Hauptdatei konservativ zu verkleinern und das Laufzeitverhalten unveraendert zu halten.

import type { Express, Request, RequestHandler } from 'express';
import type { AIModel, AIProvider } from './providers/base';
import { asyncHandler } from './asyncHandler';
import { logger } from './logger';
import { getAllProviders, getModelsForProvider, isProviderConfigured } from './providers';

type OpenRouterModelLike = {
  id: string;
  name: string;
  pricing: { prompt: string; completion: string };
  context_length: number;
  isFree: boolean;
};

export interface AggregatedAIModel extends AIModel {
  availableProviders: AIProvider[];
}

export const SUPPORTED_PROVIDERS: AIProvider[] = ['openrouter', 'groq', 'cerebras', 'nvidia', 'abacus'];

export function isSupportedProvider(provider: string): provider is AIProvider {
  return SUPPORTED_PROVIDERS.includes(provider as AIProvider);
}

export function parseSelectedProviders(providersQuery: unknown): AIProvider[] | undefined {
  if (!providersQuery) {
    return undefined;
  }

  return String(providersQuery)
    .split(',')
    .map((provider) => provider.trim())
    .filter(isSupportedProvider);
}

export function mapOpenRouterModelsToAiModels(models: OpenRouterModelLike[]): AIModel[] {
  return models.map((model) => ({
    id: model.id,
    name: model.name,
    provider: 'openrouter',
    contextLength: model.context_length,
    isFree: model.isFree,
    pricing: {
      input: parseFloat(model.pricing.prompt) * 1_000_000,
      output: parseFloat(model.pricing.completion) * 1_000_000,
    },
    capabilities: ['chat', 'completion', 'streaming'],
  }));
}

export function dedupeModelsById(models: AIModel[]): AggregatedAIModel[] {
  const deduped = new Map<string, AggregatedAIModel>();

  for (const model of models) {
    const existing = deduped.get(model.id);
    if (!existing) {
      deduped.set(model.id, { ...model, availableProviders: [model.provider] });
      continue;
    }

    if (!existing.availableProviders.includes(model.provider)) {
      existing.availableProviders.push(model.provider);
    }

    if (existing.provider === 'openrouter' && model.provider !== 'openrouter') {
      deduped.set(model.id, {
        ...model,
        availableProviders: existing.availableProviders,
      });
    }
  }

  return Array.from(deduped.values());
}

export async function registerModelProviderRoutes(app: Express, isAuthenticated: RequestHandler): Promise<void> {
  const {
    DEFAULT_FREE_FALLBACK_CHAIN,
    MODEL_TIERS,
    fetchOpenRouterModels,
    getAllActiveCooldowns,
    getOpenRouterConfigError,
    isOpenRouterConfigured,
  } = await import('./openrouter');

  app.get('/api/openrouter/models', isAuthenticated, asyncHandler(async (_req: Request, res) => {
    if (!isOpenRouterConfigured()) {
      return res.status(503).json({ message: getOpenRouterConfigError() });
    }

    const models = await fetchOpenRouterModels();
    res.json({ models, tierDefaults: MODEL_TIERS });
  }));

  app.get('/api/providers', isAuthenticated, asyncHandler(async (_req: Request, res) => {
    const providers = getAllProviders().map((provider) => ({
      ...provider,
      configured: isProviderConfigured(provider.id, process.env[provider.apiKeyEnv]),
      apiKeyEnv: provider.apiKeyEnv,
    }));

    res.json({ providers });
  }));

  app.get('/api/providers/:provider/models', isAuthenticated, asyncHandler(async (req: Request, res) => {
    const providerKey = req.params.provider;
    if (!isSupportedProvider(providerKey)) {
      return res.status(400).json({ message: 'Ungültiger Provider' });
    }

    const models = await getModelsForProvider(providerKey);
    const providerConfig = getAllProviders().find((provider) => provider.id === providerKey);
    const configured = isProviderConfigured(providerKey, process.env[providerConfig?.apiKeyEnv || '']);

    res.json({
      provider: providerKey,
      configured,
      models,
    });
  }));

  app.get('/api/models', isAuthenticated, asyncHandler(async (req: Request, res) => {
    const selectedProviders = parseSelectedProviders(req.query.providers);
    let allModels: AIModel[] = [];

    if (!selectedProviders || selectedProviders.includes('openrouter')) {
      try {
        const openRouterModels = await fetchOpenRouterModels();
        allModels = allModels.concat(mapOpenRouterModelsToAiModels(openRouterModels));
      } catch (error) {
        logger.warn('Failed to fetch OpenRouter models', { error });
      }
    }

    for (const provider of SUPPORTED_PROVIDERS.filter((candidate) => candidate !== 'openrouter')) {
      if (selectedProviders && !selectedProviders.includes(provider)) {
        continue;
      }

      try {
        const providerModels = await getModelsForProvider(provider);
        allModels = allModels.concat(providerModels);
      } catch (error) {
        logger.warn(`Failed to fetch ${provider.toUpperCase()} models`, { error });
      }
    }

    const dedupedModels = dedupeModelsById(allModels)
      .sort((a: AggregatedAIModel, b: AggregatedAIModel) => a.name.localeCompare(b.name));

    res.json({
      models: dedupedModels,
      providers: selectedProviders || SUPPORTED_PROVIDERS,
      totalCount: dedupedModels.length,
      freeCount: dedupedModels.filter((model) => model.isFree).length,
    });
  }));

  app.get('/api/providers/:provider/status', isAuthenticated, asyncHandler(async (req: Request, res) => {
    const providerKey = req.params.provider;
    if (!isSupportedProvider(providerKey)) {
      return res.status(400).json({ message: 'Ungültiger Provider' });
    }

    const providerConfig = getAllProviders().find((provider) => provider.id === providerKey);
    const apiKey = process.env[providerConfig?.apiKeyEnv || ''];
    const configured = isProviderConfigured(providerKey, apiKey);

    res.json({
      provider: providerKey,
      configured,
      hasApiKey: !!apiKey,
    });
  }));

  app.get('/api/openrouter/model-status', isAuthenticated, asyncHandler(async (req: Request, res) => {
    const cooldowns = getAllActiveCooldowns();
    const extraModels = typeof req.query.models === 'string'
      ? req.query.models.split(',').map((model) => model.trim()).filter(Boolean)
      : [];
    const candidates = [...new Set([...DEFAULT_FREE_FALLBACK_CHAIN, ...extraModels])];
    const now = Date.now();

    const modelStatus = Object.fromEntries(
      candidates.map((id) => {
        const cooldown = cooldowns[id];
        if (!cooldown) {
          return [id, { status: 'ok' as const }];
        }

        return [id, {
          status: 'cooldown' as const,
          cooldownSecondsLeft: Math.ceil((cooldown.until - now) / 1000),
          reason: cooldown.reason,
        }];
      }),
    );

    res.json({ modelStatus, checkedAt: now });
  }));
}