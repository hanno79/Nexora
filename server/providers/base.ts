/**
 * Author: rahn
 * Datum: 03.03.2026
 * Version: 1.1
 * Beschreibung: Abstrakte Base-Klasse für alle AI Provider
 *
 * ÄNDERUNG 04.03.2026: Verbessertes Error Handling im Streaming mit
 * progressivem Delay bei aufeinanderfolgenden Parse-Errors
 */

import type { Response } from 'express';

// ÄNDERUNG 03.03.2026: Neue Basis-Struktur für alle AI Provider

export type AIProvider = 'openrouter' | 'groq' | 'cerebras' | 'nvidia';

export interface AIModel {
  id: string;
  name: string;
  provider: AIProvider;
  contextLength: number;
  isFree: boolean;
  pricing: {
    input: number;    // $ per 1M tokens
    output: number;   // $ per 1M tokens
  };
  capabilities: ('chat' | 'completion' | 'streaming')[];
  description?: string;
}

export interface ProviderConfig {
  id: AIProvider;
  name: string;
  displayName: string;
  icon: string;
  color: string;
  baseUrl: string;
  apiKeyEnv: string;
  supportsStreaming: boolean;
  websiteUrl: string;
}

export interface CallOptions {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  response?: Response;
  abortSignal?: AbortSignal;
}

export interface AIResponse {
  content: string;
  model: string;
  provider: AIProvider;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  finishReason: string;
}

export interface AIResponseWithFallback extends AIResponse {
  usedFallback: boolean;
  fallbackModel?: string;
}

export class ClientDisconnectError extends Error {
  readonly code = 'ERR_CLIENT_DISCONNECT';

  constructor(message = 'Provider request aborted by caller') {
    super(message);
    Object.setPrototypeOf(this, ClientDisconnectError.prototype);
    this.name = 'ClientDisconnectError';
  }
}

export abstract class BaseAIProvider {
  protected apiKey: string;
  protected config: ProviderConfig;
  protected log?: (msg: string, data?: any) => void;

  constructor(apiKey: string, log?: (msg: string, data?: any) => void) {
    this.apiKey = apiKey;
    this.log = log;
    this.config = this.getProviderConfig();
  }

  abstract getProviderConfig(): ProviderConfig;
  abstract callModel(options: CallOptions): Promise<AIResponse>;
  abstract getModels(): Promise<AIModel[]>;
  abstract isConfigured(): boolean;

  protected logMessage(message: string, data?: any): void {
    if (this.log) {
      this.log(message, data);
    }
  }

  protected handleError(error: any): Error {
    if (error?.name === 'AbortError' || error?.code === 'ERR_CLIENT_DISCONNECT') {
      return error;
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    this.logMessage(`Provider error: ${errorMessage}`, error);
    return new Error(`${this.config.name} Provider Error: ${errorMessage}`);
  }

  /**
   * Fetch mit konfigurierbarem Timeout fuer Direct-Provider-Calls.
   * Verhindert, dass langsame Provider (z.B. NVIDIA) minutenlang haengen.
   */
  protected async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs?: number,
    abortSignal?: AbortSignal,
  ): Promise<globalThis.Response> {
    const ms = timeoutMs ?? Number(process.env.DIRECT_PROVIDER_TIMEOUT_MS || 120000);
    const controller = new AbortController();
    let timedOut = false;
    let callerAborted = false;
    const abortFromCaller = () => {
      callerAborted = true;
      controller.abort(abortSignal?.reason);
    };
    if (abortSignal?.aborted) {
      abortFromCaller();
      throw new ClientDisconnectError();
    }
    if (abortSignal) {
      abortSignal.addEventListener('abort', abortFromCaller, { once: true });
    }
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(`Timed out after ${ms}ms`));
    }, ms);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        if (callerAborted || abortSignal?.aborted) {
          throw new ClientDisconnectError();
        }
        if (timedOut) {
          throw new Error(`Provider request timed out after ${ms}ms`);
        }
        throw new Error('Provider request was aborted unexpectedly');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      abortSignal?.removeEventListener('abort', abortFromCaller);
    }
  }

  /**
   * Gemeinsame Streaming-Handler Implementierung für alle Provider.
   * Verarbeitet SSE-Streams und schreibt sie in die Express-Response.
   */
  protected async handleStreamingResponse(
    apiResponse: globalThis.Response,
    expressResponse: import('express').Response,
    model: string,
    providerName: AIProvider
  ): Promise<AIResponse> {
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason = 'unknown';
    let parseErrorCount = 0;
    const MAX_PARSE_ERRORS = 10;

    expressResponse.setHeader('Content-Type', 'text/event-stream');
    expressResponse.setHeader('Cache-Control', 'no-cache');
    expressResponse.setHeader('Connection', 'keep-alive');

    const reader = apiResponse.body?.getReader();
    if (!reader) {
      throw new Error('No response body available for streaming');
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices[0]?.delta?.content || '';
              if (content) {
                fullContent += content;
                expressResponse.write(`data: ${JSON.stringify({ content })}\n\n`);
              }
              if (parsed.choices[0]?.finish_reason) {
                finishReason = parsed.choices[0].finish_reason;
              }
              if (parsed.usage) {
                inputTokens = parsed.usage.prompt_tokens || 0;
                outputTokens = parsed.usage.completion_tokens || 0;
              }
            } catch (e) {
              parseErrorCount++;
              this.logMessage(`Parse error in streaming chunk (${parseErrorCount}/${MAX_PARSE_ERRORS})`, { error: e, data: data.slice(0, 100) });
              
              // Kurze Pause bei aufeinanderfolgenden Parse-Errors um CPU-Last zu reduzieren
              // und Zeit fuer eventuelle Netzwerk-Recovery zu geben
              if (parseErrorCount > 1) {
                await new Promise(resolve => setTimeout(resolve, Math.min(parseErrorCount * 10, 100)));
              }
              
              if (parseErrorCount > MAX_PARSE_ERRORS) {
                throw new Error(`Too many parse errors in streaming response (${parseErrorCount}). Stream may be corrupted.`);
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
      expressResponse.end();
    }

    return {
      content: fullContent,
      model,
      provider: providerName,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      finishReason,
    };
  }
}

// Provider-Metadaten für UI
export const PROVIDER_METADATA: Record<AIProvider, ProviderConfig> = {
  openrouter: {
    id: 'openrouter',
    name: 'openrouter',
    displayName: 'OpenRouter',
    icon: 'Globe',
    color: '#3B82F6', // blue-500
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    supportsStreaming: true,
    websiteUrl: 'https://openrouter.ai',
  },
  groq: {
    id: 'groq',
    name: 'groq',
    displayName: 'Groq',
    icon: 'Zap',
    color: '#10B981', // emerald-500
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    supportsStreaming: true,
    websiteUrl: 'https://groq.com',
  },
  cerebras: {
    id: 'cerebras',
    name: 'cerebras',
    displayName: 'Cerebras',
    icon: 'Cpu',
    color: '#F59E0B', // amber-500
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKeyEnv: 'CEREBRAS_API_KEY',
    supportsStreaming: true,
    websiteUrl: 'https://cerebras.ai',
  },
  nvidia: {
    id: 'nvidia',
    name: 'nvidia',
    displayName: 'NVIDIA',
    icon: 'Monitor',
    color: '#76B900', // NVIDIA Green
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKeyEnv: 'NVIDIA_API_KEY',
    supportsStreaming: true,
    websiteUrl: 'https://build.nvidia.com',
  },
};

// Hilfsfunktion um Provider-Config zu erhalten
export function getProviderConfig(provider: AIProvider): ProviderConfig {
  return PROVIDER_METADATA[provider];
}

// Hilfsfunktion um alle Provider zu erhalten
export function getAllProviders(): ProviderConfig[] {
  return Object.values(PROVIDER_METADATA);
}
