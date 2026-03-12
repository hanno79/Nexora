/**
 * Author: rahn
 * Datum: 12.03.2026
 * Version: 1.0
 * Beschreibung: Abacus AI RouteLLM Provider Client fuer Premium-Modelle
 *
 * OpenAI-kompatible API unter https://routellm.abacus.ai/v1
 * Zugang ueber ChatLLM Subscription ($10/Monat, 20K Credits inkl.)
 */

import { BaseAIProvider, type AIModel, type CallOptions, type AIResponse, type ProviderConfig, PROVIDER_METADATA } from './base';

// Statische Modell-Liste — RouteLLM hat keinen dokumentierten /models Endpoint
const ABACUS_MODELS_FALLBACK: AIModel[] = [
  {
    id: 'route-llm',
    name: 'RouteLLM (Auto-Router)',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.5, output: 1.5 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Intelligenter Router — waehlt automatisch das beste Modell (Claude/GPT/Gemini)',
  },
  {
    id: 'claude-4.5-sonnet',
    name: 'Claude 4.5 Sonnet',
    provider: 'abacus',
    contextLength: 200000,
    isFree: false,
    pricing: { input: 3.0, output: 15.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Anthropic Claude 4.5 Sonnet — stark bei komplexen Aufgaben',
  },
  {
    id: 'claude-opus',
    name: 'Claude Opus',
    provider: 'abacus',
    contextLength: 200000,
    isFree: false,
    pricing: { input: 15.0, output: 75.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Anthropic Claude Opus — staerkstes Claude-Modell',
  },
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 2.0, output: 8.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'OpenAI GPT-5.2 — neuestes GPT-Modell',
  },
  {
    id: 'gpt-5.1',
    name: 'GPT-5.1',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 2.0, output: 8.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'OpenAI GPT-5.1',
  },
  {
    id: 'gpt-5',
    name: 'GPT-5',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 2.0, output: 8.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'OpenAI GPT-5',
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 2.5, output: 10.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'OpenAI GPT-4o — schnelles Multimodal-Modell',
  },
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    provider: 'abacus',
    contextLength: 1000000,
    isFree: false,
    pricing: { input: 1.25, output: 10.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Google Gemini 3.1 Pro — 1M Token Kontext',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'abacus',
    contextLength: 1000000,
    isFree: false,
    pricing: { input: 1.25, output: 10.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Google Gemini 2.5 Pro — 1M Token Kontext',
  },
  {
    id: 'deepseek-v3',
    name: 'DeepSeek V3',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.27, output: 1.1 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'DeepSeek V3 — guenstig und leistungsstark',
  },
  {
    id: 'llama-4-maverick',
    name: 'Llama 4 Maverick',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.2, output: 0.6 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Meta Llama 4 Maverick',
  },
];

export class AbacusProvider extends BaseAIProvider {
  getProviderConfig(): ProviderConfig {
    return PROVIDER_METADATA.abacus;
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length >= 20;
  }

  async getModels(): Promise<AIModel[]> {
    if (!this.isConfigured()) {
      return ABACUS_MODELS_FALLBACK;
    }

    // RouteLLM hat keinen dokumentierten /models Endpoint — statische Liste verwenden
    return ABACUS_MODELS_FALLBACK;
  }

  async callModel(options: CallOptions): Promise<AIResponse> {
    const { model, messages, temperature = 0.7, maxTokens, stream, response: expressResponse, abortSignal } = options;

    this.logMessage(`Calling Abacus AI model: ${model}`, { temperature, maxTokens, stream });

    const requestBody: any = {
      model,
      messages,
      temperature,
      stream: !!stream,
    };

    if (maxTokens) {
      requestBody.max_tokens = maxTokens;
    }

    try {
      const fetchResponse = await this.fetchWithTimeout(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      }, undefined, abortSignal);

      if (!fetchResponse.ok) {
        const errorText = await fetchResponse.text();
        let errorMessage = `Abacus AI API Error ${fetchResponse.status}: ${errorText}`;

        if (fetchResponse.status === 401) {
          errorMessage = 'Abacus AI API: Authentifizierung fehlgeschlagen. Bitte pruefen Sie Ihren API Key unter https://routellm-apis.abacus.ai';
        } else if (fetchResponse.status === 404) {
          errorMessage = `Abacus AI API: Modell '${model}' nicht gefunden.`;
        } else if (fetchResponse.status === 429) {
          errorMessage = 'Abacus AI API: Rate limit oder Credit-Limit erreicht. Bitte pruefen Sie Ihre Subscription.';
        }

        throw new Error(errorMessage);
      }

      // Handle streaming response
      if (stream && expressResponse) {
        return this.handleStreamingResponse(fetchResponse, expressResponse, model, 'abacus');
      }

      // Handle non-streaming response
      const data = await fetchResponse.json();

      return {
        content: data.choices[0]?.message?.content || '',
        model: data.model || model,
        provider: 'abacus',
        usage: {
          inputTokens: data.usage?.prompt_tokens || 0,
          outputTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
        finishReason: data.choices[0]?.finish_reason || 'unknown',
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }
}
