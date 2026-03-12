/**
 * Author: rahn
 * Datum: 04.03.2026
 * Version: 1.2
 * Beschreibung: NVIDIA Build Provider Client für kostenlose Test-Modelle
 *
 * ÄNDERUNG 04.03.2026: Import-Extensions korrigiert (.js entfernt)
 * ÄNDERUNG 04.03.2026: Dynamisches Modell-Laden implementiert
 * ÄNDERUNG 04.03.2026: Model-Liste mit tatsaechlich verfuegbaren Modellen aktualisiert
 */

import { BaseAIProvider, sanitizeProviderErrorText, type AIModel, type CallOptions, type AIResponse, type ProviderConfig, PROVIDER_METADATA } from './base';

// ÄNDERUNG 04.03.2026: NVIDIA Provider Integration

// Fallback Modell-Daten fuer NVIDIA (wenn API nicht erreichbar)
// Quelle: https://build.nvidia.com/models
const NVIDIA_MODELS_FALLBACK: AIModel[] = [
  // Empfohlene/kostenlose Chat-Modelle
  {
    id: 'meta/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B Instruct',
    provider: 'nvidia',
    contextLength: 128000,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Leistungsstarkes Llama 3.3 70B fuer komplexe Aufgaben',
  },
  {
    id: 'meta/llama-3.1-8b-instruct',
    name: 'Llama 3.1 8B Instruct',
    provider: 'nvidia',
    contextLength: 128000,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Schnelles Llama 3.1 8B fuer einfache Aufgaben',
  },
  {
    id: 'meta/llama-3.1-405b-instruct',
    name: 'Llama 3.1 405B Instruct',
    provider: 'nvidia',
    contextLength: 128000,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Ultra-leistungsstarkes Llama 3.1 405B',
  },
  {
    id: 'google/gemma-2-9b-it',
    name: 'Gemma 2 9B IT',
    provider: 'nvidia',
    contextLength: 8192,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Google Gemma 2 Instruct',
  },
  {
    id: 'google/gemma-3-27b-it',
    name: 'Gemma 3 27B IT',
    provider: 'nvidia',
    contextLength: 128000,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Google Gemma 3 27B Instruct',
  },
  {
    id: 'qwen/qwen2.5-7b-instruct',
    name: 'Qwen 2.5 7B Instruct',
    provider: 'nvidia',
    contextLength: 32768,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Alibaba Qwen 2.5 fuer Code und Reasoning',
  },
  {
    id: 'qwen/qwen3-coder-480b-a35b-instruct',
    name: 'Qwen3 Coder 480B A35B',
    provider: 'nvidia',
    contextLength: 131072,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Qwen3 Coder fuer Programmieraufgaben',
  },
  {
    id: 'mistralai/mixtral-8x7b-instruct-v0.1',
    name: 'Mixtral 8x7B Instruct',
    provider: 'nvidia',
    contextLength: 32768,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Mistral Mixtral MoE Modell',
  },
  {
    id: 'microsoft/phi-3-mini-128k-instruct',
    name: 'Phi-3 Mini 128K',
    provider: 'nvidia',
    contextLength: 128000,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Microsoft Phi-3 Mini fuer Reasoning',
  },
  {
    id: 'microsoft/phi-4-mini-instruct',
    name: 'Phi-4 Mini Instruct',
    provider: 'nvidia',
    contextLength: 16384,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Microsoft Phi-4 Mini fuer Reasoning',
  },
  {
    id: 'deepseek-ai/deepseek-r1-distill-llama-8b',
    name: 'DeepSeek R1 Distill Llama 8B',
    provider: 'nvidia',
    contextLength: 128000,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'DeepSeek R1 Distill fuer Reasoning',
  },
  {
    id: 'deepseek-ai/deepseek-r1-distill-qwen-14b',
    name: 'DeepSeek R1 Distill Qwen 14B',
    provider: 'nvidia',
    contextLength: 128000,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'DeepSeek R1 Distill Qwen',
  },
  // nvidia/llama-3.1-nemotron-70b-instruct entfernt (404 fuer diesen Account)
  // nvidia/nemotron-4-340b-instruct entfernt (404 fuer diesen Account)

  // Langsame Modelle ans Ende - 675B erzeugt nur ~6.6 Tok/s auf NVIDIA
  {
    id: 'mistralai/mistral-large-3-675b-instruct-2512',
    name: 'Mistral Large 3 675B (SLOW)',
    provider: 'nvidia',
    contextLength: 128000,
    isFree: true,
    pricing: { input: 0, output: 0 },
    capabilities: ['chat', 'completion', 'streaming'],
    description: 'Mistral Large 3 675B - ACHTUNG: Sehr langsam (~6.6 Tok/s), Timeout-Risiko bei langen Ausgaben',
  },
];

export class NvidiaProvider extends BaseAIProvider {
  getProviderConfig(): ProviderConfig {
    return PROVIDER_METADATA.nvidia;
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.startsWith('nvapi-');
  }

  async getModels(): Promise<AIModel[]> {
    // Ohne gueltigen API Key direkt Fallback nutzen (kein HTTP-Call)
    if (!this.isConfigured()) {
      return NVIDIA_MODELS_FALLBACK;
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
        console.warn(`NVIDIA API models endpoint failed: ${response.status}`);
        return NVIDIA_MODELS_FALLBACK;
      }

      const data = await response.json();
      if (data.data && Array.isArray(data.data)) {
        // Ausschluss-basierter Filter: Entferne bekannte nicht-Chat-Modelle
        // Besser als Inclusion-Filter, da viele Chat-Modelle keine 'instruct'/'chat' im Namen haben
        const NON_CHAT_PATTERNS = [
          /embed/i, /reward/i, /guard/i, /safety/i, /shield/i,
          /parse$/i, /retriever/i, /clip$/i, /nvclip/i,
          /^nvidia\/vila$/i, /deplot/i, /^nvidia\/neva/i,
          /streampetr/i, /paligemma/i, /^microsoft\/kosmos/i,
          /gliner/i, /^adept\/fuyu/i,
          /-base$/i,  // Base-Modelle (nicht fuer Chat)
          /^bigcode\/starcoder/i,  // Code-Completion, kein Chat
          /^snowflake\/arctic-embed/i,  // Embedding
        ];
        const chatModels = data.data.filter((model: any) => {
          const id = model.id || '';
          return !NON_CHAT_PATTERNS.some(p => p.test(id));
        });

        return chatModels.map((model: any): AIModel => ({
          id: model.id,
          name: model.id.split('/').pop()?.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || model.id,
          provider: 'nvidia',
          contextLength: 128000, // Standard, da API keine Context-Length liefert
          isFree: true,
          pricing: { input: 0, output: 0 },
          capabilities: ['chat', 'completion', 'streaming'],
          description: `${model.id} (${model.owned_by})`,
        }));
      }

      return NVIDIA_MODELS_FALLBACK;
    } catch (error) {
      console.warn('Failed to fetch NVIDIA models dynamically, using fallback:', error);
      return NVIDIA_MODELS_FALLBACK;
    }
  }

  async callModel(options: CallOptions): Promise<AIResponse> {
    const { model, messages, temperature = 0.7, maxTokens, stream, response: expressResponse, abortSignal } = options;

    // Grosse Modelle (>=200B) brauchen deutlich laenger - Timeout anpassen
    // Dynamisch aus Model-ID parsen statt hardcoded Strings (z.B. 397b, 675b, 405b, 480b)
    const paramMatch = model.match(/(\d+)b(?:-|$|[^a-z])/i);
    const paramBillions = paramMatch ? parseInt(paramMatch[1], 10) : 0;
    const isLargeModel = paramBillions >= 200;
    const effectiveTimeout = isLargeModel ? 300000 : undefined; // 5 min fuer grosse Modelle, sonst Default (120s)
    if (isLargeModel) {
      this.logMessage(`Warning: Large model ${model} selected - extended timeout to ${effectiveTimeout}ms (~6.6 tok/s expected)`);
    }

    this.logMessage(`Calling NVIDIA model: ${model}`, { temperature, maxTokens, stream });

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
      }, effectiveTimeout, abortSignal);

      if (!fetchResponse.ok) {
        const errorText = await fetchResponse.text();
        const sanitized = sanitizeProviderErrorText(fetchResponse.status, errorText);
        let errorMessage = `NVIDIA API Error ${fetchResponse.status}: ${sanitized}`;

        // Spezifische Fehlermeldungen fuer haeufige Fehler
        if (fetchResponse.status === 401) {
          errorMessage = 'NVIDIA API: Authentifizierung fehlgeschlagen. Bitte pruefen Sie Ihren API Key unter https://build.nvidia.com/';
        } else if (fetchResponse.status === 403) {
          errorMessage = 'NVIDIA API: Keine Berechtigung fuer dieses Modell. Das Modell erfordert moeglicherweise eine Genehmigung oder hat keine Credits mehr.';
        } else if (fetchResponse.status === 404) {
          errorMessage = `NVIDIA API: Modell '${model}' nicht gefunden. Bitte pruefen Sie die Modell-ID.`;
        } else if (fetchResponse.status === 429) {
          errorMessage = 'NVIDIA API: Rate limit erreicht. Bitte warten Sie einen Moment.';
        }

        throw new Error(errorMessage);
      }

      // Handle streaming response
      if (stream && expressResponse) {
        return this.handleStreamingResponse(fetchResponse, expressResponse, model, 'nvidia');
      }

      // Handle non-streaming response
      const data = await fetchResponse.json();

      return {
        content: data.choices[0]?.message?.content || '',
        model: data.model || model,
        provider: 'nvidia',
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
