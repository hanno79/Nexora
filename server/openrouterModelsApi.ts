/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: OpenRouter-Model-API mit Cache fuer Modelllisten und Preisinformationen.
*/

// ÄNDERUNG 08.03.2026: Model-List-API und Cache aus `server/openrouter.ts` extrahiert,
// um die Hauptdatei konservativ zu verkleinern und die API ueber Re-Exports stabil zu halten.

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
let modelsCacheTimestamp = 0;
const MODELS_CACHE_TTL = 30 * 60 * 1000;

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
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models from OpenRouter: ${response.status}`);
  }

  const responseBody = await response.text();
  let data: { data?: any[] };
  try {
    data = JSON.parse(responseBody);
  } catch (error) {
    console.error('Failed to parse OpenRouter models response', {
      status: response.status,
      body: responseBody.slice(0, 2000),
      error,
    });
    throw new Error(`Failed to parse models from OpenRouter: invalid JSON response (status ${response.status})`);
  }
  const rawModels = Array.isArray(data.data) ? data.data : [];
  const models: OpenRouterModel[] = rawModels
    .filter((model: any) => model.id && model.name)
    .map((model: any) => {
      let promptPrice = Number.parseFloat(model.pricing?.prompt || '0');
      let completionPrice = Number.parseFloat(model.pricing?.completion || '0');
      if (!Number.isFinite(promptPrice)) promptPrice = 0;
      if (!Number.isFinite(completionPrice)) completionPrice = 0;

      return {
        id: model.id,
        name: model.name,
        pricing: {
          prompt: model.pricing?.prompt || '0',
          completion: model.pricing?.completion || '0',
        },
        context_length: model.context_length || 0,
        isFree: promptPrice === 0 && completionPrice === 0,
        provider: model.id.split('/')[0] || 'unknown',
      };
    })
    .sort((a: OpenRouterModel, b: OpenRouterModel) => a.name.localeCompare(b.name));

  modelsCache = models;
  modelsCacheTimestamp = now;
  return models;
}
