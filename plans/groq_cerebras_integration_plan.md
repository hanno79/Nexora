# Groq & Cerebras Integration Plan

**Author:** rahn  
**Datum:** 03.03.2026  
**Version:** 1.0  
**Status:** Entwurf

---

## ZUSAMMENFASSUNG

Dieser Plan beschreibt die Integration von **Groq** und **Cerebras** als neue AI-Provider in die Nexora-Plattform, sowie die Bereinigung der Provider-Landschaft durch Entfernung des nicht genutzten Anthropic-Direct-Providers.

### Finale Provider-Liste
- ✅ **OpenRouter** - Aggregator für alle Modelle
- ✅ **Groq** - Ultra-schnelle Inference (Llama, Mixtral)
- ✅ **Cerebras** - Hochleistungs-Compute (Llama)

### Nicht mehr benötigt
- ❌ **Anthropic Direct** - Wird nur noch über OpenRouter genutzt

---

## ARCHITEKTUR

### Neue Dateien

| Datei | Beschreibung |
|-------|-------------|
| `server/providers/base.ts` | Abstrakte Base-Klasse für alle Provider |
| `server/providers/index.ts` | Provider-Factory, Typen und Registry |
| `server/providers/groq.ts` | Groq API Client Implementierung |
| `server/providers/cerebras.ts` | Cerebras API Client Implementierung |

### Anzupassende Dateien

| Datei | Änderung |
|-------|----------|
| `server/openrouter.ts` | Refactoren als Provider-Klasse |
| `server/aiUsageLogger.ts` | Pricing für Groq/Cerebras hinzufügen |
| `server/dualAiService.ts` | Provider-Routing integrieren |
| `server/guidedAiService.ts` | Provider-Routing integrieren |

### Zu löschende Dateien

| Datei | Grund |
|-------|-------|
| `server/anthropic.ts` | Wird nicht direkt genutzt, nur über OpenRouter |

---

## DATENSTRUKTUREN

### Provider Typen

```typescript
// type AIProvider = 'openrouter' | 'groq' | 'cerebras'
type AIProvider = 'openrouter' | 'groq' | 'cerebras';

interface AIModel {
  id: string;
  name: string;
  provider: AIProvider;
  contextWindow: number;
  pricing: {
    input: number;   // $ pro 1M Tokens
    output: number;  // $ pro 1M Tokens
  };
  isFree: boolean;
  description?: string;
}

interface ProviderConfig {
  id: AIProvider;
  name: string;
  description: string;
  website: string;
  requiresApiKey: boolean;
  envKeyName: string;
  models: AIModel[];
  enabled: boolean;
}

interface ProviderCredentials {
  apiKey: string;
  baseUrl?: string;
}
```

### Datenbank-Schema Erweiterungen

```sql
-- Tabelle: ai_usage_logs — Neue Spalten
ALTER TABLE ai_usage_logs
  ADD COLUMN provider TEXT NOT NULL DEFAULT 'openrouter',  -- 'openrouter' | 'groq' | 'cerebras'
  ADD COLUMN model_id TEXT;                                -- z.B. 'llama-3.1-70b-versatile'

CREATE INDEX idx_ai_usage_logs_provider ON ai_usage_logs (provider);
CREATE INDEX idx_ai_usage_logs_provider_model ON ai_usage_logs (provider, model_id);

-- Tabelle: user_settings — Neue Spalten
ALTER TABLE user_settings
  ADD COLUMN preferred_provider TEXT DEFAULT 'openrouter',
  ADD COLUMN groq_api_key_encrypted TEXT,        -- AES-256-GCM verschlüsselt
  ADD COLUMN cerebras_api_key_encrypted TEXT,     -- AES-256-GCM verschlüsselt
  ADD COLUMN preferred_model_per_provider JSONB DEFAULT '{}';

ALTER TABLE user_settings
  ADD CONSTRAINT chk_preferred_model_json
  CHECK (jsonb_typeof(preferred_model_per_provider) = 'object');
```

#### Verschlüsselung (Encryption at Rest)

- **Methode:** AES-256-GCM, Application-Level Encryption
- **Schlüssel:** Aus Umgebungsvariable `ENCRYPTION_SECRET` (min. 32 Byte)
- **Transport:** TLS 1.2+ erforderlich für alle DB-Verbindungen
- **Zugriffsmuster:** Alle Lese-/Schreibzugriffe auf `*_api_key_encrypted` erfolgen über `encryptField()` / `decryptField()` Hilfsfunktionen
- **Key Rotation:** Rotation von `ENCRYPTION_SECRET` löst Re-Encryption-Migration aller bestehenden Keys aus
- **Migration:** Bestehende Zeilen erhalten `DEFAULT`-Werte; ggf. vorhandene Klartext-Keys werden bei Deployment verschlüsselt

---

## BACKEND-ÄNDERUNGEN

### 1. Provider Base-Klasse (`server/providers/base.ts`)

```typescript
export abstract class BaseAIProvider {
  protected config: ProviderConfig;
  protected credentials: ProviderCredentials;

  constructor(config: ProviderConfig, credentials: ProviderCredentials) {
    this.config = config;
    this.credentials = credentials;
  }

  abstract generateResponse(
    prompt: string,
    options?: GenerateOptions
  ): Promise<AIResponse>;

  abstract streamResponse(
    prompt: string,
    options?: GenerateOptions
  ): AsyncIterable<AIStreamChunk>;

  abstract getModels(): AIModel[];

  abstract calculateCost(modelId: string, inputTokens: number, outputTokens: number): number;

  abstract validateCredentials(): Promise<boolean>;

  /** Returns whether this provider is currently available (credentials set, service reachable). */
  abstract isAvailable(): Promise<boolean>;
}
```

### 2. Groq Provider (`server/providers/groq.ts`)

- Integration der Groq REST API
- Unterstützung für Streaming
- Modell-Verwaltung:
  - `llama-3.1-70b-versatile`
  - `llama-3.1-8b-instant`
  - `mixtral-8x7b-32768`
  - `gemma2-9b-it`
- Fehlerbehandlung und Retry-Logik

### 3. Cerebras Provider (`server/providers/cerebras.ts`)

- Integration der Cerebras REST API
- Unterstützung für Streaming
- Modell-Verwaltung:
  - `llama-3.1-70b`
  - `llama-3.1-8b`
- Fehlerbehandlung und Retry-Logik

### 4. Factory & Registry (`server/providers/index.ts`)

```typescript
export class ProviderFactory {
  private static providers: Map<AIProvider, BaseAIProvider> = new Map();

  static registerProvider(
    id: AIProvider,
    provider: BaseAIProvider
  ): void {
    this.providers.set(id, provider);
  }

  static getProvider(id: AIProvider): BaseAIProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Provider ${id} nicht registriert`);
    }
    return provider;
  }

  static getAllProviders(): BaseAIProvider[] {
    return Array.from(this.providers.values());
  }

  static getAvailableProviders(): AIProvider[] {
    return Array.from(this.providers.keys())
      .filter(id => this.providers.get(id)?.isAvailable());
  }
}
```

### 5. API-Routen

```typescript
// GET /api/providers
// Response: ProviderConfig[]

// GET /api/providers/:id/models
// Response: AIModel[]

// POST /api/providers/:id/validate
// Response: { valid: boolean; error?: string }

// GET /api/user/provider-preferences
// Response: { preferredProvider: AIProvider; preferredModels: Record<AIProvider, string> }

// POST /api/user/provider-preferences
// Body: { preferredProvider: AIProvider; preferredModels: Record<AIProvider, string> }
```

### 6. Service-Integration

#### `server/dualAiService.ts`

- Provider-Auswahl basierend auf User-Einstellung
- Fallback zu OpenRouter bei Fehlern
- Routing-Logik:
  ```typescript
  async function getProviderForRequest(userId: string): Promise<BaseAIProvider> {
    const prefs = await getUserPreferences(userId);
    const preferredProvider = prefs.preferredProvider || 'openrouter';
    return ProviderFactory.getProvider(preferredProvider);
  }
  ```

#### `server/guidedAiService.ts`

- Gleiche Provider-Routing-Logik wie dualAiService
- Beibehaltung der bestehenden Workflow-Logik

### 7. AI Usage Logger (`server/aiUsageLogger.ts`)

Anstatt eines hardcodierten `PRICING`-Objekts wird Pricing dynamisch geladen, um historische Kostenberechnungen zu ermöglichen und Preisänderungen ohne Code-Deploys zu unterstützen.

- **Neues Pricing-Modell:** `model_pricing_history` (Tabelle oder Config-Datei)
  ```typescript
  interface ModelPricingEntry {
    provider: AIProvider;
    modelId: string;
    inputPrice: number;   // $ pro 1M Tokens
    outputPrice: number;  // $ pro 1M Tokens
    validFrom: Date;
    validTo: Date | null; // null = aktuell gültig
  }
  ```

- **Lookup-Funktion:** Ersetzt die statische `PRICING`-Konstante
  ```typescript
  async function getPricingForModelAtTimestamp(
    provider: AIProvider,
    modelId: string,
    timestamp: Date = new Date()
  ): Promise<ModelPricing> {
    // Abfrage: WHERE provider = $1 AND model_id = $2
    //          AND valid_from <= $3 AND (valid_to IS NULL OR valid_to > $3)
  }
  ```

- **Initiale Pricing-Daten (Seed):**
  | Provider | Modell | Input (1M) | Output (1M) |
  |----------|--------|-----------|------------|
  | groq | llama-3.1-70b-versatile | $0.59 | $0.79 |
  | groq | llama-3.1-8b-instant | $0.05 | $0.08 |
  | groq | mixtral-8x7b-32768 | $0.24 | $0.24 |
  | groq | gemma2-9b-it | $0.20 | $0.20 |
  | cerebras | llama-3.1-70b | $0.60 | $0.60 |
  | cerebras | llama-3.1-8b | $0.10 | $0.10 |

- **Caller-Anpassung:** `aiUsageLogger.calculateCost()` ruft `getPricingForModelAtTimestamp()` mit dem Timestamp des Usage-Logs auf

---

## FRONTEND-ÄNDERUNGEN

### 1. Neue Komponente: `ProviderSelector.tsx`

**Funktion:**
- Horizontale Liste von Provider-Cards
- Jede Card zeigt: Logo, Name, Status (aktiv/inaktiv)
- Auswahl durch Klick
- Anzeige von API-Key-Status (konfiguriert/fehlt)

**Props:**
```typescript
interface ProviderSelectorProps {
  selectedProvider: AIProvider;
  onSelect: (provider: AIProvider) => void;
  providers: ProviderConfig[];
}
```

### 2. Neue Komponente: `ModelList.tsx`

**Funktion:**
- Liste aller verfügbaren Modelle für den gewählten Provider
- Gruppierung: Free Models / Paid Models
- Anzeige pro Modell:
  - Name und Beschreibung
  - Context Window
  - Preis (Input/Output pro 1M Tokens)
  - "Free" Badge bei kostenlosen Modellen
- Radio-Button zur Auswahl des Standard-Modells

**Props:**
```typescript
interface ModelListProps {
  provider: AIProvider;
  selectedModel: string;
  onSelect: (modelId: string) => void;
  models: AIModel[];
}
```

### 3. Anpassung: `Settings.tsx`

**Neuer Abschnitt: "AI Provider"**

Struktur:
```
┌─────────────────────────────────────────────┐
│ AI Provider Einstellungen                   │
├─────────────────────────────────────────────┤
│                                             │
│  Wähle deinen bevorzugten Provider:         │
│                                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │OpenRouter│ │  Groq   │ │Cerebras │       │
│  │  [✓]   │ │   [ ]   │ │   [ ]   │       │
│  └─────────┘ └─────────┘ └─────────┘       │
│                                             │
├─────────────────────────────────────────────┤
│ Verfügbare Modelle - Groq                   │
├─────────────────────────────────────────────┤
│                                             │
│  ○ llama-3.1-70b-versatile                  │
│    Context: 128k | $0.59/$0.79 per 1M       │
│                                             │
│  ● llama-3.1-8b-instant [FREE]              │
│    Context: 128k | Kostenlos                │
│                                             │
├─────────────────────────────────────────────┤
│ API Keys                                    │
├─────────────────────────────────────────────┤
│                                             │
│  Groq API Key: [••••••••••••••••] [Show]   │
│  [Validate] [Remove]                        │
│                                             │
│  Cerebras API Key: [••••••••••••••••]      │
│  [Validate] [Remove]                        │
│                                             │
└─────────────────────────────────────────────┘
```

**Implementierung:**
- Integration von `ProviderSelector` und `ModelList`
- API-Key-Management pro Provider
- Validierung der API-Keys
- Speichern der Präferenzen

### 4. i18n Erweiterungen

**Deutsch (`client/src/lib/i18n/de.ts`):**
```typescript
{
  settings: {
    aiProvider: {
      title: 'AI Provider',
      description: 'Wähle deinen bevorzugten KI-Provider und das Standard-Modell',
      selectProvider: 'Provider auswählen',
      selectModel: 'Modell auswählen',
      apiKeys: 'API Keys',
      enterApiKey: 'API Key eingeben',
      validate: 'Validieren',
      remove: 'Entfernen',
      apiKeyConfigured: 'API Key konfiguriert',
      apiKeyMissing: 'API Key fehlt',
      free: 'Kostenlos',
      paid: 'Kostenpflichtig',
      contextWindow: 'Context Window',
      pricing: 'Preis pro 1M Tokens',
    },
    providers: {
      openrouter: {
        name: 'OpenRouter',
        description: 'Zugriff auf alle Modelle über einen einzigen API Key',
      },
      groq: {
        name: 'Groq',
        description: 'Ultra-schnelle Inference mit Llama und Mixtral Modellen',
      },
      cerebras: {
        name: 'Cerebras',
        description: 'Hochleistungs-Compute für Llama Modelle',
      },
    },
  },
}
```

**Englisch (`client/src/lib/i18n/en.ts`):**
```typescript
{
  settings: {
    aiProvider: {
      title: 'AI Provider',
      description: 'Choose your preferred AI provider and default model',
      // ... entsprechende englische Übersetzungen
    },
    // ...
  },
}
```

---

## KOSTEN-ÜBERSICHT

### Groq Modelle

| Modell | Kontext | Input (1M) | Output (1M) | Status |
|--------|---------|-----------|------------|--------|
| **llama-3.1-8b-instant** | 128k | $0.05 | $0.08 | ✅ Verfügbar |
| **llama-3.1-70b-versatile** | 128k | $0.59 | $0.79 | ✅ Verfügbar |
| **llama-3.1-405b-reasoning** | 128k | $0.59 | $0.79 | ⏳ Demnächst |
| **mixtral-8x7b-32768** | 32k | $0.24 | $0.24 | ✅ Verfügbar |
| **gemma2-9b-it** | 8k | $0.20 | $0.20 | ✅ Verfügbar |

### Cerebras Modelle

| Modell | Kontext | Input (1M) | Output (1M) | Status |
|--------|---------|-----------|------------|--------|
| **llama-3.1-8b** | 128k | $0.10 | $0.10 | ✅ Verfügbar |
| **llama-3.1-70b** | 128k | $0.60 | $0.60 | ✅ Verfügbar |

### OpenRouter Referenz (bestehend)

| Modell | Provider | Input (1M) | Output (1M) |
|--------|----------|-----------|------------|
| Claude 3.5 Sonnet | Anthropic | $3.00 | $15.00 |
| GPT-4o | OpenAI | $5.00 | $15.00 |
| Llama 3.1 70B | Meta | $0.52 | $0.75 |

### Kostenvergleich (Beispiel: 1M Input + 1M Output Tokens)

| Provider/Modell | Gesamtkosten |
|-----------------|-------------|
| Groq llama-3.1-8b-instant | **$0.13** 💰 |
| Cerebras llama-3.1-8b | **$0.20** 💰 |
| Groq llama-3.1-70b-versatile | **$1.38** |
| Cerebras llama-3.1-70b | **$1.20** |
| OpenRouter Llama 3.1 70B | **$1.27** |
| Claude 3.5 Sonnet | **$18.00** |

---

## UMSETZUNGSREIHENFOLGE

### Phase 1: Backend-Grundlagen ⏱️ 2-3 Tage

- [ ] `server/providers/base.ts` erstellen (inkl. `isAvailable()` Abstract-Methode)
- [ ] `server/providers/groq.ts` implementieren
- [ ] `server/providers/cerebras.ts` implementieren
- [ ] `server/providers/index.ts` Factory erstellen
- [ ] Feature-Flag `ENABLE_MULTI_PROVIDER` einführen:
  - [ ] Umgebungsvariable in `.env.example` dokumentieren (`ENABLE_MULTI_PROVIDER=false`)
  - [ ] Flag-Auswertung in `ProviderFactory.getAvailableProviders()` einbauen (Flag=off → nur OpenRouter)
  - [ ] Unit-Tests für Flag-On und Flag-Off Pfade schreiben
- [ ] Unit-Tests für Provider schreiben

**Abhängigkeiten:** Keine

### Phase 2: Datenbank-Änderungen ⏱️ 1 Tag

- [ ] Migration für `ai_usage_logs` erstellen (Spalte `provider`)
- [ ] Migration für `user_settings` erstellen (Provider-Präferenzen)
- [ ] Seed-Daten für Provider-Modelle erstellen
- [ ] Datenbank-Tests aktualisieren

**Abhängigkeiten:** Phase 1

### Phase 3: Frontend-Integration ⏱️ 2-3 Tage

- [ ] `ProviderSelector.tsx` Komponente erstellen
- [ ] `ModelList.tsx` Komponente erstellen
- [ ] `Settings.tsx` erweitern (neuer Abschnitt)
- [ ] API-Integration für Provider/Models laden
- [ ] i18n Übersetzungen hinzufügen (DE/EN)
- [ ] Komponenten-Tests schreiben

**Abhängigkeiten:** Phase 2

### Phase 4: Service-Integration ⏱️ 2 Tage

- [ ] `server/openrouter.ts` als Provider-Klasse refactoren
- [ ] `server/dualAiService.ts` anpassen (Provider-Routing)
- [ ] `server/guidedAiService.ts` anpassen (Provider-Routing)
- [ ] `server/aiUsageLogger.ts` erweitern (Pricing)
- [ ] Integration-Tests schreiben

**Abhängigkeiten:** Phase 1, Phase 3

### Phase 5: Env-Config & Cleanup ⏱️ 1 Tag

- [ ] `.env.example` erweitern (`GROQ_API_KEY`, `CEREBRAS_API_KEY`)
- [ ] `server/anthropic.ts` löschen
- [ ] Dokumentation aktualisieren
- [ ] End-to-End Tests durchführen
- [ ] Code-Review und Cleanup

**Abhängigkeiten:** Phase 4

### Gesamtdauer: **8-10 Tage**

---

## UI-MOCKUP

### Settings - AI Provider Abschnitt

```
┌─────────────────────────────────────────────────────────────────────┐
│ ⚙️ Einstellungen                                    [DE] [×]        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────┬───────────────┬────────────────┬─────────────────┐   │
│  │ Profil   │ AI Provider   │ Benachrichtig. │ API Keys        │   │
│  │          │    [active]   │                │                 │   │
│  └──────────┴───────────────┴────────────────┴─────────────────┘   │
│                                                                     │
│  ═══════════════════════════════════════════════════════════════   │
│                                                                     │
│  🤖 AI Provider Einstellungen                                       │
│  ──────────────────────────────────────────────────────────────    │
│                                                                     │
│  Wähle deinen bevorzugten KI-Provider und das Standard-Modell      │
│  für PRD-Generierung und Analyse.                                  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Provider auswählen                                         │   │
│  │                                                             │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │   │
│  │  │             │  │             │  │             │         │   │
│  │  │  OpenRouter │  │    Groq     │  │  Cerebras   │         │   │
│  │  │   ┌───┐    │  │   ┌───┐    │  │   ┌───┐    │         │   │
│  │  │   │ ✓ │    │  │   │   │    │  │   │   │    │         │   │
│  │  │   └───┘    │  │   └───┘    │  │   └───┘    │         │   │
│  │  │  Alle Modele│  │  Schnelle  │  │  Hochleist.│         │   │
│  │  │  verfügbar │  │  Inference │  │  Compute   │         │   │
│  │  │            │  │            │  │            │         │   │
│  │  │  [Active]  │  │            │  │            │         │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘         │   │
│  │                                                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Verfügbare Modelle - OpenRouter                            │   │
│  │  ─────────────────────────────────────────────────────      │   │
│  │                                                             │   │
│  │  ○ Claude 3.5 Sonnet                                        │   │
│  │    Anthropic • Context: 200k • $3.00/$15.00 per 1M         │   │
│  │                                                             │   │
│  │  ● Llama 3.1 70B [FREE]                                     │   │
│  │    Meta • Context: 128k • Kostenlos                         │   │
│  │                                                             │   │
│  │  ○ GPT-4o                                                   │   │
│  │    OpenAI • Context: 128k • $5.00/$15.00 per 1M            │   │
│  │                                                             │   │
│  │  ── Weitere Modelle laden... ──                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  API Keys                                                   │   │
│  │  ─────────────────────────────────────────────────────      │   │
│  │                                                             │   │
│  │  OpenRouter API Key                                         │   │
│  │  [••••••••••••••••••••••••••••••••••] [👁] [Löschen]      │   │
│  │  ✅ Gültig - Letzte Prüfung: 02.03.2026                     │   │
│  │                                                             │   │
│  │  Groq API Key                                               │   │
│  │  [sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx] [👁] [Speichern]    │   │
│  │  [Validieren]                                               │   │
│  │                                                             │   │
│  │  Cerebras API Key                                           │   │
│  │  [Noch nicht konfiguriert] [Konfigurieren]                  │   │
│  │                                                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│                                    [Abbrechen]  [Speichern]        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Provider Cards Detail

```
Groq Card (Hover State):
┌─────────────────────────────────┐
│                                 │
│        ⚡ GROQ ⚡               │
│                                 │
│     ┌─────────────┐             │
│     │             │             │
│     │   Logo      │             │
│     │             │             │
│     └─────────────┘             │
│                                 │
│    Ultra-schnelle Inference     │
│                                 │
│    ✓ Llama 3.1 (8B/70B)        │
│    ✓ Mixtral 8x7B              │
│    ✓ Bis zu 800 T/s            │
│                                 │
│    [Provider auswählen]         │
│                                 │
└─────────────────────────────────┘

Cerebras Card (Hover State):
┌─────────────────────────────────┐
│                                 │
│      🧠 CEREBRAS 🧠             │
│                                 │
│     ┌─────────────┐             │
│     │             │             │
│     │   Logo      │             │
│     │             │             │
│     └─────────────┘             │
│                                 │
│    Hochleistungs-Compute        │
│                                 │
│    ✓ Llama 3.1 (8B/70B)        │
│    ✓ Wafer-Scale Engine        │
│    ✓ Optimiert für LLMs        │
│                                 │
│    [Provider auswählen]         │
│                                 │
└─────────────────────────────────┘
```

---

## TESTSTRATEGIE

### Unit Tests
- **Provider-Factory:**
  - Registrierung und Abruf eines bekannten Providers
  - Fehlerbehandlung bei unbekanntem Provider (`getProvider('unknown')` → Error)
  - Feature-Flag-Off → `getAvailableProviders()` liefert nur OpenRouter
  - Feature-Flag-On → alle registrierten Provider werden gelistet
- **Groq/Cerebras Client-Methoden:**
  - HTTP-Mocking via MSW oder Nock für API-Aufrufe
  - `generateResponse()` mit gültigem/ungültigem API-Key
  - `streamResponse()` mit partieller Antwort und Abbruch
  - `isAvailable()` bei erreichbarem/nicht erreichbarem Service
- **API-Key-Szenarien:**
  - Gültiger Key → Success
  - Ungültiger Key → 401 Error mit klarer Meldung
  - Abgelaufener/revoked Key → spezifischer Fehlercode
  - Fehlender Key → `isAvailable()` = false
- **Pricing:**
  - `getPricingForModelAtTimestamp()` mit aktuellem und historischem Timestamp
  - Unbekanntes Modell → Fallback-Preis oder Error
  - Edge Cases: 0 Tokens, maximale Token-Anzahl

### Integration Tests
- **Fallback-Matrix:**
  - Primary Provider verfügbar → Primary wird genutzt
  - Primary down → Fallback zu OpenRouter
  - Alle Provider down → klare Fehlermeldung an Nutzer
- **Rate Limiting:**
  - 429-Response → exponentieller Backoff
  - Wiederholte 429 → Circuit Breaker öffnet
  - Circuit Breaker Reset nach Timeout
- **Streaming:**
  - Partielle Antworten werden korrekt zusammengesetzt
  - Client-Abbruch wird sauber behandelt
  - Reconnection bei Verbindungsabbruch
- **API-Routen:**
  - `GET /api/providers` → Provider-Liste mit Status
  - `POST /api/providers/:id/validate` → Key-Validierung
  - `POST /api/user/provider-preferences` → Speicherung + Verschlüsselung
- **Provider Error Simulation:** HTTP-Interceptoren für 500, Timeout, Malformed JSON

### Performance Tests
- **Tooling:** k6 oder artillery
- **Szenarien:**
  - 10/50/100 parallele Requests an verschiedene Provider
  - Response-Time SLAs: p50 < 200ms, p95 < 500ms (exkl. Provider-Latenz)
  - Memory- und Throughput-Messung unter Last
  - Streaming-Throughput: Tokens/s bei Concurrent Streams

### E2E Tests
- **Happy Path:**
  - Provider in Settings auswählen → API-Key eingeben → Validieren → PRD generieren
  - Modell wechseln → PRD generieren → Usage-Log zeigt korrekten Provider/Modell
- **Error Path:**
  - Ungültiger API-Key → Fehlermeldung → automatischer Fallback zu OpenRouter
  - Provider nicht erreichbar → Timeout → Fallback mit Nutzerhinweis
- **API-Key Lifecycle:**
  - Key hinzufügen → Validieren → Verwenden → Rotieren → Löschen
  - Nach Löschung: Provider nicht mehr in `getAvailableProviders()`
- **Akzeptanzkriterien:**
  - Jeder Flow hat definierte Expected-Outcomes
  - Mocks/Stubs für Provider-APIs im CI; optionale Real-Provider-Tests mit Test-Accounts in Staging

---

## ROLLBACK-STRATEGIE

1. **Datenbank:** Migrationen sind reversibel
2. **Code:** Feature-Flag `ENABLE_MULTI_PROVIDER` (eingeführt in Phase 1) auf `false` setzen
3. **Fallback:** Bei Provider-Fehlern automatisch zu OpenRouter wechseln
4. **Backup:** `server/anthropic.ts` vor Löschung sichern

---

## NÄCHSTE SCHRITTE

1. ✅ Diesen Plan reviewen und freigeben
2. Phase 1 starten (Backend-Grundlagen)
3. Parallel: API Keys für Groq und Cerebras beschaffen
4. Nach Phase 3: Usability-Test mit Stakeholdern

---

## ANHANG

### API Dokumentation

- Groq API: https://console.groq.com/docs
- Cerebras API: https://inference-docs.cerebras.ai/
- OpenRouter API: https://openrouter.ai/docs

### Nützliche Ressourcen

- Groq Modelle: https://console.groq.com/docs/models
- Cerebras Modelle: https://inference-docs.cerebras.ai/introduction

---

*Dieser Plan wurde am 03.03.2026 erstellt und ist verbindlich für die Implementierung.*
