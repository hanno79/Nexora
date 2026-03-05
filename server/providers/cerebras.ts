/**
 * Author: rahn
 * Datum: 03.03.2026
 * Version: 1.2
 * Beschreibung: Cerebras Provider Client
 *
 * ÄNDERUNG 04.03.2026: Import-Extensions korrigiert (.js entfernt)
 * ÄNDERUNG 04.03.2026: Dynamisches Modell-Laden implementiert
 * ÄNDERUNG 04.03.2026: Verbesserte Fehlerbehandlung hinzugefuegt
 */

import { BaseAIProvider, type AIModel, type CallOptions, type AIResponse, type ProviderConfig, PROVIDER_METADATA } from './base';

// ÄNDERUNG 03.03.2026: Cerebras Provider Integration

// Fallback Modell-Daten fuer Cerebras (wenn API nicht erreichbar)
// Quelle: https://inference-docs.cerebras.ai/
const CEREBRAS_MODELS_FALLBACK: AIModel[] = [
  // Aktuelle Produktionsmodelle
  {
    id: 'llama3.1-8b',
    name: 'Llama 3.1 8B',
    provider: 'cerebras',
    contextLength: 8192,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Schnelles Modell fuer Standard-Aufgaben',
  },
  {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    provider: 'cerebras',
    contextLength: 128000,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Leistungsstarkes Modell fuer komplexe Aufgaben',
  },
  {
    id: 'llama-4-scout-17b-16e-instruct',
    name: 'Llama 4 Scout 17B',
    provider: 'cerebras',
    contextLength: 256000,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Meta Llama 4 Scout mit 256K Kontext',
  },
  {
    id: 'llama-4-maverick-17b-128e-instruct',
    name: 'Llama 4 Maverick 17B',
    provider: 'cerebras',
    contextLength: 256000,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Meta Llama 4 Maverick mit 256K Kontext',
  },
];

export class CerebrasProvider extends BaseAIProvider {
  getProviderConfig(): ProviderConfig {
    return PROVIDER_METADATA.cerebras;
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.startsWith('csk-');
  }

  async getModels(): Promise<AIModel[]> {
    // Ohne gueltigen API Key direkt Fallback nutzen (kein HTTP-Call)
    if (!this.isConfigured()) {
      return CEREBRAS_MODELS_FALLBACK;
    }

    // Versuche dynamisch Modelle von der API zu laden
    try {
      const response = await this.fetchWithTimeout(`${this.config.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      }, 30000);

      if (!response.ok) {
        console.warn(`Cerebras API models endpoint failed: ${response.status}`);
        return CEREBRAS_MODELS_FALLBACK;
      }

      const data = await response.json();
      if (data.data && Array.isArray(data.data)) {
        return data.data.map((model: any): AIModel => ({
          id: model.id,
          name: model.id.split('-').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
          provider: 'cerebras',
          contextLength: 128000,
          isFree: true,
          pricing: { input: 0, output: 0 },
          capabilities: ['chat', 'completion', 'streaming'],
          description: model.id,
        }));
      }

      return CEREBRAS_MODELS_FALLBACK;
    } catch (error) {
      console.warn('Failed to fetch Cerebras models dynamically, using fallback:', error);
      return CEREBRAS_MODELS_FALLBACK;
    }
  }

  async callModel(options: CallOptions): Promise<AIResponse> {
    const { model, messages, temperature = 0.7, maxTokens, stream, response: expressResponse } = options;

    this.logMessage(`Calling Cerebras model: ${model}`, { temperature, maxTokens, stream });

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
      });

      if (!fetchResponse.ok) {
        const errorText = await fetchResponse.text();
        let errorMessage = `Cerebras API Error ${fetchResponse.status}: ${errorText}`;

        // Spezifische Fehlermeldungen fuer haeufige Fehler
        if (fetchResponse.status === 401) {
          errorMessage = 'Cerebras API: Authentifizierung fehlgeschlagen. Bitte pruefen Sie Ihren API Key unter https://inference.cerebras.ai/';
        } else if (fetchResponse.status === 404) {
          errorMessage = `Cerebras API: Modell '${model}' nicht gefunden. Verfuegbare Modelle: https://inference.cerebras.ai/`;
        } else if (fetchResponse.status === 429) {
          errorMessage = 'Cerebras API: Rate limit erreicht. Bitte warten Sie einen Moment.';
        } else if (fetchResponse.status === 400) {
          errorMessage = 'Cerebras API: Ungueltige Anfrage. Bitte pruefen Sie die Parameter.';
        }

        throw new Error(errorMessage);
      }

      // Handle streaming response
      if (stream && expressResponse) {
        return this.handleStreamingResponse(fetchResponse, expressResponse, model, 'cerebras');
      }

      // Handle non-streaming response
      const data = await fetchResponse.json();

      return {
        content: data.choices[0]?.message?.content || '',
        model: data.model || model,
        provider: 'cerebras',
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
