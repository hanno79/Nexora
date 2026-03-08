/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Unit-Tests fuer ausgelagerte Provider-/Modell-Routen-Helfer.
*/

// ÄNDERUNG 08.03.2026: Regressionen fuer Provider-Filter, OpenRouter-Mapping und Modelldeduplizierung ergaenzt.

import { describe, expect, it } from 'vitest';
import type { AIModel } from '../server/providers/base';
import {
  dedupeModelsById,
  mapOpenRouterModelsToAiModels,
  parseSelectedProviders,
} from '../server/modelProviderRoutes';

function buildModel(overrides: Partial<AIModel> = {}): AIModel {
  return {
    id: 'test/model',
    name: 'Test Model',
    provider: 'openrouter',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 1, output: 2 },
    capabilities: ['chat'],
    ...overrides,
  };
}

describe('modelProviderRoutes Helfer', () => {
  it('filtert Provider-Query-Parameter konservativ auf unterstuetzte Provider', () => {
    expect(parseSelectedProviders('openrouter,invalid,groq')).toEqual(['openrouter', 'groq']);
    expect(parseSelectedProviders('invalid-only')).toEqual([]);
  });

  it('gibt bei fehlendem Provider-Query undefiniert zurueck', () => {
    expect(parseSelectedProviders(undefined)).toBeUndefined();
  });

  it('mappt OpenRouter-Modelle in das gemeinsame AIModel-Format', () => {
    const result = mapOpenRouterModelsToAiModels([
      {
        id: 'google/gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        pricing: { prompt: '0.00000015', completion: '0.00000060' },
        context_length: 1_000_000,
        isFree: false,
      },
    ]);

    expect(result).toEqual([
      {
        id: 'google/gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        provider: 'openrouter',
        contextLength: 1_000_000,
        isFree: false,
        pricing: { input: 0.15, output: 0.6 },
        capabilities: ['chat', 'completion', 'streaming'],
      },
    ]);
  });

  it('bevorzugt bei gleicher Model-ID einen Direct-Provider und sammelt alle verfuegbaren Provider', () => {
    const result = dedupeModelsById([
      buildModel({ id: 'shared/model', name: 'Shared', provider: 'openrouter' }),
      buildModel({ id: 'shared/model', name: 'Shared', provider: 'nvidia' }),
      buildModel({ id: 'unique/model', name: 'Unique', provider: 'groq' }),
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'shared/model',
        provider: 'nvidia',
        availableProviders: ['openrouter', 'nvidia'],
      }),
      expect.objectContaining({
        id: 'unique/model',
        provider: 'groq',
        availableProviders: ['groq'],
      }),
    ]);
  });
});