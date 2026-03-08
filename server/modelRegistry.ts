/**
 * Author: rahn
 * Datum: 04.03.2026
 * Version: 1.0
 * Beschreibung: Model-Provider Registry - Ordnet Model-IDs ihren echten Providern zu.
 *
 * Ersetzt die fehlerhafte Vendor-Prefix-Heuristik in detectProviderForModel()
 * durch eine Registry, die aus den tatsaechlichen Provider-Modelllisten gebaut wird.
 *
 * Regeln:
 * 1. :free-Suffix → immer OpenRouter (kein Direct-Provider)
 * 2. Modell in Registry → nutze registrierten Direct-Provider (wenn API Key vorhanden)
 * 3. Nicht gefunden → OpenRouter (Default)
 */

import type { AIProvider } from './providers/base';

interface ModelProviderEntry {
  modelId: string;
  providers: AIProvider[];
}

const registry = new Map<string, ModelProviderEntry>();
let initialized = false;

// Known provider mismatches or temporarily unsupported direct-provider mappings.
// These models should stay on OpenRouter until the provider routing is verified again.
const DIRECT_PROVIDER_DENYLIST = new Map<string, Set<AIProvider>>([
  ['qwen-3-235b-a22b-instruct-2507', new Set<AIProvider>(['cerebras'])],
]);

/**
 * Normalisiert eine Model-ID fuer Registry-Lookup.
 * Entfernt :free Suffix (OpenRouter-Konzept) und konvertiert zu lowercase.
 */
function normalizeModelId(modelId: string): string {
  return modelId.replace(/:free$/, '').toLowerCase();
}

function resolveDeniedProviders(modelId: string): Set<AIProvider> | undefined {
  const normalized = normalizeModelId(modelId);
  const tail = normalized.includes('/') ? normalized.split('/').pop() || normalized : normalized;
  return DIRECT_PROVIDER_DENYLIST.get(normalized) || DIRECT_PROVIDER_DENYLIST.get(tail);
}

/**
 * Prueft ob eine Model-ID den OpenRouter-spezifischen :free Suffix hat.
 */
export function isOpenRouterFreeModel(modelId: string): boolean {
  return modelId.endsWith(':free');
}

/**
 * Initialisiert die Registry aus den statischen Provider-Modelllisten.
 * Muss beim Server-Start aufgerufen werden.
 */
export async function initializeModelRegistry(): Promise<void> {
  registry.clear();

  // Importiere getModelsForProvider lazy um zirkulaere Abhaengigkeiten zu vermeiden
  const { getModelsForProvider } = await import('./providers/index');

  const providers: AIProvider[] = ['nvidia', 'groq', 'cerebras'];

  for (const provider of providers) {
    try {
      const models = await getModelsForProvider(provider);
      for (const model of models) {
        const key = normalizeModelId(model.id);
        const entry = registry.get(key) || { modelId: model.id, providers: [] };
        if (!entry.providers.includes(provider)) {
          entry.providers.push(provider);
        }
        registry.set(key, entry);
      }
    } catch (error) {
      console.warn(`[ModelRegistry] Failed to load models for ${provider}:`, error);
    }
  }

  initialized = true;
  console.log(`[ModelRegistry] Initialized with ${registry.size} model entries`);
}

/**
 * Gibt alle Direct-Provider zurueck, die ein bestimmtes Modell bedienen koennen.
 * Filtert nach vorhandenen API Keys.
 *
 * Regeln:
 * 1. :free Suffix → leeres Array (nur OpenRouter)
 * 2. Modell in Registry → registrierte Provider (gefiltert nach API Key)
 * 3. Nicht gefunden → leeres Array (OpenRouter Default)
 */
export function resolveProvidersForModel(modelId: string): AIProvider[] {
  // Regel 1: :free Modelle sind immer OpenRouter-exklusiv
  if (isOpenRouterFreeModel(modelId)) {
    return [];
  }

  const key = normalizeModelId(modelId);
  const entry = registry.get(key);

  if (!entry) {
    return [];
  }

  // Nur Provider mit konfiguriertem API Key zurueckgeben
  const API_KEY_ENV: Record<AIProvider, string> = {
    openrouter: 'OPENROUTER_API_KEY',
    nvidia: 'NVIDIA_API_KEY',
    groq: 'GROQ_API_KEY',
    cerebras: 'CEREBRAS_API_KEY',
  };

  return entry.providers.filter(provider => {
    const envKey = API_KEY_ENV[provider];
    if (!process.env[envKey]) return false;
    const deniedProviders = resolveDeniedProviders(modelId);
    return !deniedProviders?.has(provider);
  });
}

/**
 * Gibt den besten Direct-Provider fuer ein Modell zurueck, oder null fuer OpenRouter.
 * Ersatz fuer die alte detectProviderForModel() Heuristik.
 */
export function getBestDirectProvider(modelId: string): AIProvider | null {
  const providers = resolveProvidersForModel(modelId);
  return providers.length > 0 ? providers[0] : null;
}

/**
 * Prueft ob die Registry initialisiert wurde.
 */
export function isRegistryInitialized(): boolean {
  return initialized;
}

/**
 * Gibt die Anzahl der registrierten Modelle zurueck (fuer Tests/Debugging).
 */
export function getRegistrySize(): number {
  return registry.size;
}
