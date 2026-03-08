/**
 * Author: rahn
 * Datum: 03.03.2026
 * Version: 1.2
 * Beschreibung: Groq Provider Client
 *
 * ÄNDERUNG 04.03.2026: Import-Extensions korrigiert (.js entfernt)
 * ÄNDERUNG 04.03.2026: Dynamisches Modell-Laden implementiert
 * ÄNDERUNG 04.03.2026: Verbesserte Fehlerbehandlung hinzugefuegt
 */

import { BaseAIProvider, type AIModel, type CallOptions, type AIResponse, type ProviderConfig, PROVIDER_METADATA } from './base';

// ÄNDERUNG 03.03.2026: Groq Provider Integration

// Fallback Modell-Daten fuer Groq (wenn API nicht erreichbar)
// Quelle: https://console.groq.com/docs/models
const GROQ_MODELS_FALLBACK: AIModel[] = [
  // Aktuelle Produktionsmodelle (Stand: Maerz 2026)
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B (Versatile)',
    provider: 'groq',
    contextLength: 128000,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Leistungsstarkes Modell fuer komplexe Aufgaben',
  },
  {
    id: 'llama-3.1-8b-instant',
    name: 'Llama 3.1 8B (Instant)',
    provider: 'groq',
    contextLength: 128000,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Schnelles Modell fuer einfache Aufgaben',
  },
  {
    id: 'gemma2-9b-it',
    name: 'Gemma 2 9B IT',
    provider: 'groq',
    contextLength: 8192,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Google Gemma 2 Instruct',
  },
  {
    id: 'mixtral-8x7b-32768',
    name: 'Mixtral 8x7B',
    provider: 'groq',
    contextLength: 32768,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Mistral Mixtral MoE Modell',
  },
  {
    id: 'llama3-70b-8192',
    name: 'Llama 3 70B',
    provider: 'groq',
    contextLength: 8192,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Llama 3 70B von Meta',
  },
  {
    id: 'llama3-8b-8192',
    name: 'Llama 3 8B',
    provider: 'groq',
    contextLength: 8192,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Llama 3 8B von Meta',
  },
  {
    id: 'llama-guard-3-8b',
    name: 'Llama Guard 3 8B',
    provider: 'groq',
    contextLength: 8192,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion'],
    description: 'Sicherheitsmodell fuer Content Moderation',
  },
];

// Max output tokens for models with known limits (lower than typical token budgets)
const GROQ_MAX_OUTPUT_TOKENS: Record<string, number> = {
  'gemma2-9b-it': 8192,
  'llama3-70b-8192': 8192,
  'llama3-8b-8192': 8192,
  'llama-guard-3-8b': 8192,
};

export class GroqProvider extends BaseAIProvider {
  getProviderConfig(): ProviderConfig {
    return PROVIDER_METADATA.groq;
  }

  isConfigured(): boolean {
    // Groq API Keys starten mit "gsk_" und sind typischerweise 52 Zeichen lang
    return !!this.apiKey && this.apiKey.startsWith('gsk_') && this.apiKey.length >= 20;
  }

  async getModels(): Promise<AIModel[]> {
    // Ohne gueltigen API Key direkt Fallback nutzen (kein HTTP-Call)
    if (!this.isConfigured()) {
      return GROQ_MODELS_FALLBACK;
    }

    // Versuche dynamisch Modelle von der API zu laden
    try {
      const response = await this.fetchWithTimeout(`${this.config.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.warn(`Groq API models endpoint failed: ${response.status}`);
        return GROQ_MODELS_FALLBACK;
      }

      const data = await response.json();
      if (data.data && Array.isArray(data.data)) {
        return data.data.map((model: any): AIModel => ({
          id: model.id,
          name: model.id.split('-').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
          provider: 'groq',
          contextLength: model.context_window || 8192,
          isFree: true,
          pricing: { input: 0, output: 0 },
          capabilities: ['chat', 'completion', 'streaming'],
          description: model.id,
        }));
      }

      return GROQ_MODELS_FALLBACK;
    } catch (error) {
      console.warn('Failed to fetch Groq models dynamically, using fallback:', error);
      return GROQ_MODELS_FALLBACK;
    }
  }

  async callModel(options: CallOptions): Promise<AIResponse> {
    const { model, messages, temperature = 0.7, maxTokens, stream, response: expressResponse, abortSignal } = options;

    this.logMessage(`Calling Groq model: ${model}`, { temperature, maxTokens, stream });

    const requestBody: any = {
      model,
      messages,
      temperature,
      stream: !!stream,
    };

    if (maxTokens) {
      const modelLimit = GROQ_MAX_OUTPUT_TOKENS[model];
      requestBody.max_tokens = modelLimit ? Math.min(maxTokens, modelLimit) : maxTokens;
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
        let errorMessage = `Groq API Error ${fetchResponse.status}: ${errorText}`;

        // Spezifische Fehlermeldungen fuer haeufige Fehler
        if (fetchResponse.status === 401) {
          errorMessage = 'Groq API: Authentifizierung fehlgeschlagen. Bitte pruefen Sie Ihren API Key unter https://console.groq.com/keys';
        } else if (fetchResponse.status === 404) {
          errorMessage = `Groq API: Modell '${model}' nicht gefunden. Verfuegbare Modelle: https://console.groq.com/docs/models`;
        } else if (fetchResponse.status === 429) {
          errorMessage = 'Groq API: Rate limit erreicht. Bitte warten Sie einen Moment oder pruefen Sie Ihre Limits.';
        } else if (fetchResponse.status === 413) {
          errorMessage = 'Groq API: Request zu gross. Bitte reduzieren Sie die Kontextlaenge.';
        }

        throw new Error(errorMessage);
      }

      // Handle streaming response
      if (stream && expressResponse) {
        return this.handleStreamingResponse(fetchResponse, expressResponse, model, 'groq');
      }

      // Handle non-streaming response
      const data = await fetchResponse.json();

      return {
        content: data.choices[0]?.message?.content || '',
        model: data.model || model,
        provider: 'groq',
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
