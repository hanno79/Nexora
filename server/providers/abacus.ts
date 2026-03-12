/**
 * Author: rahn
 * Datum: 12.03.2026
 * Version: 1.1
 * Beschreibung: Abacus AI RouteLLM Provider Client fuer Premium-Modelle
 *
 * OpenAI-kompatible API unter https://routellm.abacus.ai/v1
 * Zugang ueber ChatLLM Subscription ($10/Monat, 20K Credits inkl.)
 *
 * AENDERUNG 12.03.2026: Modellliste auf vollstaendigen API-Katalog aktualisiert
 * Quelle: https://abacus.ai/help/developer-platform/route-llm/api
 */

import { BaseAIProvider, sanitizeProviderErrorText, type AIModel, type CallOptions, type AIResponse, type ProviderConfig, PROVIDER_METADATA } from './base';

// Abacus RouteLLM keys are long bearer tokens; reject obviously incomplete placeholder values.
const MIN_API_KEY_LENGTH = 20;

// Statische Modell-Liste — RouteLLM hat keinen dokumentierten /models Endpoint
const ABACUS_MODELS_FALLBACK: AIModel[] = [
  // ── Intelligent Routing ──
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

  // ── Anthropic ──
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'abacus',
    contextLength: 200000,
    isFree: false,
    pricing: { input: 3.0, output: 15.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Anthropic Claude Sonnet 4.6 — neuestes Sonnet-Modell',
  },
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    provider: 'abacus',
    contextLength: 200000,
    isFree: false,
    pricing: { input: 15.0, output: 75.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Anthropic Claude Opus 4.6 — staerkstes Claude-Modell',
  },
  {
    id: 'claude-4-5-sonnet',
    name: 'Claude 4.5 Sonnet',
    provider: 'abacus',
    contextLength: 200000,
    isFree: false,
    pricing: { input: 3.0, output: 15.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Anthropic Claude 4.5 Sonnet',
  },
  {
    id: 'claude-4-5-haiku',
    name: 'Claude 4.5 Haiku',
    provider: 'abacus',
    contextLength: 200000,
    isFree: false,
    pricing: { input: 0.8, output: 4.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Anthropic Claude 4.5 Haiku — schnell und guenstig',
  },
  {
    id: 'claude-4-5-opus',
    name: 'Claude 4.5 Opus',
    provider: 'abacus',
    contextLength: 200000,
    isFree: false,
    pricing: { input: 15.0, output: 75.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Anthropic Claude 4.5 Opus',
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    provider: 'abacus',
    contextLength: 200000,
    isFree: false,
    pricing: { input: 3.0, output: 15.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Anthropic Claude Sonnet 4',
  },
  {
    id: 'claude-opus-4',
    name: 'Claude Opus 4',
    provider: 'abacus',
    contextLength: 200000,
    isFree: false,
    pricing: { input: 15.0, output: 75.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Anthropic Claude Opus 4',
  },
  {
    id: 'claude-opus-4-1',
    name: 'Claude Opus 4.1',
    provider: 'abacus',
    contextLength: 200000,
    isFree: false,
    pricing: { input: 15.0, output: 75.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Anthropic Claude Opus 4.1',
  },

  // ── OpenAI ──
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
    id: 'gpt-5-mini',
    name: 'GPT-5 Mini',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.4, output: 1.6 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'OpenAI GPT-5 Mini — kompakt und schnell',
  },
  {
    id: 'gpt-5-nano',
    name: 'GPT-5 Nano',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.1, output: 0.4 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'OpenAI GPT-5 Nano — kleinstes GPT-5 Modell',
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 2.0, output: 8.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'OpenAI GPT-4.1',
  },
  {
    id: 'gpt-4.1-mini',
    name: 'GPT-4.1 Mini',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.4, output: 1.6 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'OpenAI GPT-4.1 Mini',
  },
  {
    id: 'gpt-4.1-nano',
    name: 'GPT-4.1 Nano',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.1, output: 0.4 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'OpenAI GPT-4.1 Nano',
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
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.15, output: 0.6 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'OpenAI GPT-4o Mini',
  },
  {
    id: 'o4-mini',
    name: 'o4 Mini',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 1.1, output: 4.4 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'OpenAI o4 Mini — Reasoning-Modell',
  },
  {
    id: 'o3',
    name: 'o3',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 2.0, output: 8.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'OpenAI o3 — Reasoning-Modell',
  },
  {
    id: 'o3-mini',
    name: 'o3 Mini',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 1.1, output: 4.4 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'OpenAI o3 Mini — kompaktes Reasoning-Modell',
  },
  {
    id: 'o1',
    name: 'o1',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 15.0, output: 60.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'OpenAI o1 — Reasoning-Modell',
  },

  // ── Google ──
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
    id: 'gemini-3-pro',
    name: 'Gemini 3 Pro',
    provider: 'abacus',
    contextLength: 1000000,
    isFree: false,
    pricing: { input: 1.25, output: 10.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Google Gemini 3 Pro',
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    provider: 'abacus',
    contextLength: 1000000,
    isFree: false,
    pricing: { input: 0.1, output: 0.4 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Google Gemini 3 Flash — schnell und guenstig',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'abacus',
    contextLength: 1000000,
    isFree: false,
    pricing: { input: 1.25, output: 10.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Google Gemini 2.5 Pro',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'abacus',
    contextLength: 1000000,
    isFree: false,
    pricing: { input: 0.075, output: 0.3 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Google Gemini 2.5 Flash',
  },

  // ── xAI ──
  {
    id: 'grok-4-1-fast',
    name: 'Grok 4.1 Fast',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 3.0, output: 15.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'xAI Grok 4.1 Fast',
  },
  {
    id: 'grok-4',
    name: 'Grok 4',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 3.0, output: 15.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'xAI Grok 4',
  },
  {
    id: 'grok-code-fast-1',
    name: 'Grok Code Fast 1',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.15, output: 0.6 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'xAI Grok Code Fast — spezialisiert auf Code',
  },

  // ── Meta (Llama) ──
  {
    id: 'llama-4-Maverick-17B',
    name: 'Llama 4 Maverick 17B',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.2, output: 0.6 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Meta Llama 4 Maverick 17B',
  },
  {
    id: 'llama-3.3-70B',
    name: 'Llama 3.3 70B',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.2, output: 0.6 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Meta Llama 3.3 70B',
  },
  {
    id: 'llama-3.1-405B',
    name: 'Llama 3.1 405B',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.8, output: 2.4 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Meta Llama 3.1 405B — groesstes Llama-Modell',
  },

  // ── DeepSeek ──
  {
    id: 'deepseek-v3.2',
    name: 'DeepSeek V3.2',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.27, output: 1.1 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'DeepSeek V3.2 — neueste Version',
  },
  {
    id: 'deepseek-v3.1',
    name: 'DeepSeek V3.1',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.27, output: 1.1 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'DeepSeek V3.1',
  },
  {
    id: 'deepseek-R1',
    name: 'DeepSeek R1',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.55, output: 2.19 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'DeepSeek R1 — Reasoning-Modell',
  },
  {
    id: 'deepseek-v3',
    name: 'DeepSeek V3',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.27, output: 1.1 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'DeepSeek V3',
  },

  // ── Qwen ──
  {
    id: 'qwen3-max',
    name: 'Qwen 3 Max',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.3, output: 1.2 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Alibaba Qwen 3 Max',
  },
  {
    id: 'qwen3-coder',
    name: 'Qwen 3 Coder',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.3, output: 1.2 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Alibaba Qwen 3 Coder — spezialisiert auf Code',
  },
  {
    id: 'qwen3-32b',
    name: 'Qwen 3 32B',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.1, output: 0.4 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Alibaba Qwen 3 32B',
  },
  {
    id: 'qwq-32b',
    name: 'QwQ 32B',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.1, output: 0.4 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Alibaba QwQ 32B — Reasoning-Modell',
  },

  // ── Kimi ──
  {
    id: 'kimi-k2',
    name: 'Kimi K2',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.6, output: 2.4 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Moonshot Kimi K2',
  },
  {
    id: 'kimi-k2.5',
    name: 'Kimi K2.5',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.6, output: 2.4 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Moonshot Kimi K2.5',
  },

  // ── ZhipuAI (GLM) ──
  {
    id: 'glm-5',
    name: 'GLM-5',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.5, output: 2.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'ZhipuAI GLM-5',
  },
  {
    id: 'glm-4.7',
    name: 'GLM-4.7',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.5, output: 2.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'ZhipuAI GLM-4.7',
  },
  {
    id: 'glm-4.6',
    name: 'GLM-4.6',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.5, output: 2.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'ZhipuAI GLM-4.6',
  },
  {
    id: 'glm-4.5',
    name: 'GLM-4.5',
    provider: 'abacus',
    contextLength: 128000,
    isFree: false,
    pricing: { input: 0.5, output: 2.0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'ZhipuAI GLM-4.5',
  },
];

export class AbacusProvider extends BaseAIProvider {
  getProviderConfig(): ProviderConfig {
    return PROVIDER_METADATA.abacus;
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length >= MIN_API_KEY_LENGTH;
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
      // RouteLLM braucht laenger als Standard-Provider: Routing-Entscheidung + Backend-Modell-Antwort
      // Generator-Calls (lange PRD-Sektionen) koennen 4+ Minuten dauern
      const abacusTimeoutMs = Number(process.env.ABACUS_TIMEOUT_MS || 360000);
      const maxRetries = model === 'route-llm' ? 1 : 0;
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const fetchResponse = await this.fetchWithTimeout(`${this.config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          }, abacusTimeoutMs, abortSignal);

          // Bei Erfolg: weiter mit Response-Verarbeitung
          return await this.processAbacusResponse(fetchResponse, model, stream, expressResponse);
        } catch (retryErr) {
          lastError = retryErr as Error;
          const isTimeout = lastError.message?.toLowerCase().includes('timed out') ||
                            lastError.message?.toLowerCase().includes('abort');
          if (attempt < maxRetries && isTimeout) {
            this.logMessage(`Abacus route-llm timeout — retry ${attempt + 1}/${maxRetries}`, { model });
            continue;
          }
          throw lastError;
        }
      }
      // Fallthrough (sollte nicht erreicht werden)
      throw lastError || new Error('Abacus call failed');
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private async processAbacusResponse(
    fetchResponse: Response,
    model: string,
    stream: boolean | undefined,
    expressResponse: any | undefined,
  ): Promise<AIResponse> {
    if (!fetchResponse.ok) {
      const errorText = await fetchResponse.text();
      const sanitized = sanitizeProviderErrorText(fetchResponse.status, errorText);
      let errorMessage = `Abacus AI API Error ${fetchResponse.status}: ${sanitized}`;

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
    const data: unknown = await fetchResponse.json();

    if (!data || typeof data !== 'object') {
      throw new Error('Abacus AI API returned a malformed JSON response');
    }

    const responseData = data as {
      choices?: Array<{
        message?: { content?: unknown };
        finish_reason?: unknown;
      }>;
      model?: unknown;
      usage?: {
        prompt_tokens?: unknown;
        completion_tokens?: unknown;
        total_tokens?: unknown;
      };
    };
    const choices = Array.isArray(responseData.choices) ? responseData.choices : [];
    const firstChoice = choices.length > 0 ? choices[0] : undefined;
    const usage = responseData.usage && typeof responseData.usage === 'object'
      ? responseData.usage
      : undefined;
    const inputTokens = typeof usage?.prompt_tokens === 'number' && Number.isFinite(usage.prompt_tokens)
      ? usage.prompt_tokens
      : 0;
    const outputTokens = typeof usage?.completion_tokens === 'number' && Number.isFinite(usage.completion_tokens)
      ? usage.completion_tokens
      : 0;
    const totalTokens = typeof usage?.total_tokens === 'number' && Number.isFinite(usage.total_tokens)
      ? usage.total_tokens
      : inputTokens + outputTokens;

    return {
      content: typeof firstChoice?.message?.content === 'string' ? firstChoice.message.content : '',
      model: typeof responseData.model === 'string' && responseData.model.length > 0 ? responseData.model : model,
      provider: 'abacus',
      usage: {
        inputTokens,
        outputTokens,
        totalTokens,
      },
      finishReason: typeof firstChoice?.finish_reason === 'string' && firstChoice.finish_reason.length > 0
        ? firstChoice.finish_reason
        : 'unknown',
    };
  }
}
