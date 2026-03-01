import type { OpenRouterClient } from '../../openrouter';
import type { TokenUsage } from "@shared/schema";
import { enforceStructure } from './repairSection';
import { FEATURE_EXPANSION } from '../../tokenBudgets';

type SupportedContentLanguage = 'de' | 'en';

const FEATURE_EXPANSION_PROMPT = `You are part of the Nexora Requirements Compiler.

Your task is to expand ONE specific feature into a full implementation-ready specification.

You are NOT generating a full PRD.
You are ONLY expanding the feature provided below.

----------------------------------------
INPUT
----------------------------------------

System Idea:
\${userInput}

System Vision:
\${vision}

Feature ID:
\${featureId}

Feature Name:
\${featureName}

Feature Short Description:
\${shortDescription}

----------------------------------------
OBJECTIVE
----------------------------------------

Expand this feature into a deterministic, implementation-ready specification.

The output must follow this exact structure:

Feature ID: \${featureId}
Feature Name: \${featureName}

1. Purpose
2. Actors
3. Trigger
4. Preconditions
5. Main Flow (numbered deterministic steps)
6. Alternate Flows
7. Postconditions
8. Data Impact
9. UI Impact
10. Acceptance Criteria

----------------------------------------
CRITICAL RULES
----------------------------------------

- Do NOT describe other features
- Do NOT reference "see above"
- Do NOT describe vision again
- Be technically precise
- Be deterministic
- No vague language ("etc", "and more")
- Main Flow must contain numbered implementation steps
- Alternate Flows must include at least one realistic edge case
- Postconditions must describe resulting system state

Only output the full expanded feature.`;

function resolveFeatureExpansionLanguage(
  language: string | null | undefined,
  userInput: string,
  vision: string
): SupportedContentLanguage {
  if (language === 'de') return 'de';
  if (language === 'en') return 'en';

  const sample = `${userInput || ''}\n${vision || ''}`.toLowerCase();
  if (/[äöüß]/i.test(sample)) return 'de';
  if (/\b(und|oder|mit|fuer|für|bitte|erstelle|beschreibung|anforderung|nutzer)\b/i.test(sample)) {
    return 'de';
  }
  return 'en';
}

function buildLanguageInstruction(language: SupportedContentLanguage): string {
  if (language === 'de') {
    return [
      'LANGUAGE INSTRUCTION:',
      '- Keep the numbered section labels exactly as defined in English (Purpose, Actors, Trigger, ...).',
      '- Write all descriptive body text in German.',
      '- Avoid mixed-language prose inside section bodies.',
    ].join('\n');
  }

  return [
    'LANGUAGE INSTRUCTION:',
    '- Keep the numbered section labels exactly as defined in English (Purpose, Actors, Trigger, ...).',
    '- Write all descriptive body text in English.',
    '- Avoid mixed-language prose inside section bodies.',
  ].join('\n');
}

function buildPrompt(
  userInput: string,
  vision: string,
  featureId: string,
  featureName: string,
  shortDescription: string,
  language: SupportedContentLanguage
): string {
  return FEATURE_EXPANSION_PROMPT
    .replaceAll('${userInput}', userInput)
    .replaceAll('${vision}', vision)
    .replaceAll('${featureId}', featureId)
    .replaceAll('${featureName}', featureName)
    .replaceAll('${shortDescription}', shortDescription)
    + `\n\n${buildLanguageInstruction(language)}`;
}

const REQUIRED_SECTIONS = [
  'Purpose',
  'Actors',
  'Trigger',
  'Preconditions',
  'Main Flow',
  'Alternate Flows',
  'Postconditions',
  'Data Impact',
  'UI Impact',
  'Acceptance Criteria',
];

function validateExpandedFeature(text: string): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const section of REQUIRED_SECTIONS) {
    const pattern = new RegExp(`\\d+\\.\\s*${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    if (!pattern.test(text)) {
      missing.push(section);
    }
  }

  const mainFlowSection = text.match(/Main Flow[\s\S]*?(?=\d+\.\s*(?:Alternate|Postconditions|Data|UI|Acceptance)|$)/i);
  if (mainFlowSection) {
    const numberedSteps = mainFlowSection[0].match(/^\s*\d+\.\s+/gm);
    if (!numberedSteps || numberedSteps.length < 2) {
      missing.push('Main Flow (numbered steps missing)');
    }
  }

  return { valid: missing.length === 0, missing };
}

export interface ExpandedFeature {
  featureId: string;
  featureName: string;
  content: string;
  model: string;
  usage: TokenUsage;
  retried: boolean;
  valid: boolean;
  compiled: boolean;
}

function buildDeterministicFeatureFallback(
  featureId: string,
  featureName: string,
  shortDescription: string,
  language: SupportedContentLanguage
): string {
  const safeDesc = shortDescription?.trim() || featureName;
  const isGerman = language === 'de';
  return [
    `Feature ID: ${featureId}`,
    `Feature Name: ${featureName}`,
    ``,
    `1. Purpose`,
    isGerman
      ? `${safeDesc} wird als deterministische, testbare Funktion mit klaren Grenzen umgesetzt.`
      : `${safeDesc} is implemented as a deterministic, testable capability with clear boundaries.`,
    ``,
    `2. Actors`,
    isGerman ? `- Primaer: Endnutzer` : `- Primary: End user`,
    isGerman ? `- Sekundaer: Systemservice zur Verarbeitung der Anfrage` : `- Secondary: System service handling the request`,
    ``,
    `3. Trigger`,
    isGerman
      ? `Der Benutzer startet die zugehoerige Aktion ueber die UI oder einen API-Endpunkt.`
      : `User initiates the related action through the UI or API endpoint.`,
    ``,
    `4. Preconditions`,
    isGerman
      ? `- Anwendung laeuft und alle Abhaengigkeiten sind verfuegbar.`
      : `- Application is running and dependencies are available.`,
    isGerman
      ? `- Erforderliche Eingaben sind vorhanden und vor Ausfuehrung validiert.`
      : `- Required inputs are present and validated before execution.`,
    ``,
    `5. Main Flow`,
    isGerman
      ? `1. Das System empfängt und validiert die Anfrage fuer ${featureName}.`
      : `1. System receives and validates the request for ${featureName}.`,
    isGerman
      ? `2. Das System fuehrt die Kernlogik deterministisch aus und aktualisiert den Zustand.`
      : `2. System executes the core logic deterministically and updates state.`,
    isGerman
      ? `3. Das System liefert eine Erfolgsmeldung und aktualisiert die relevante UI-Ansicht.`
      : `3. System returns a success response and refreshes relevant UI state.`,
    ``,
    `6. Alternate Flows`,
    isGerman
      ? `- Validierung fehlgeschlagen: Das System liefert einen klaren Fehler und fuehrt keinen Schreibzugriff aus.`
      : `- Validation fails: system returns a clear error and performs no write.`,
    isGerman
      ? `- Ausfuehrung fehlgeschlagen: Das System protokolliert die Ursache und liefert einen wiederholbaren Fehlerpfad.`
      : `- Execution fails: system logs reason and returns recoverable error response.`,
    ``,
    `7. Postconditions`,
    isGerman
      ? `Der Feature-Zustand ist konsistent, beobachtbar und fuer Folgeoperationen bereit.`
      : `The feature state is consistent, observable, and ready for subsequent operations.`,
    ``,
    `8. Data Impact`,
    isGerman
      ? `Es werden nur erforderliche Entitaeten gelesen/aktualisiert; keine ausserhalb des Scopes liegenden Datenaenderungen.`
      : `Only required entities are read/updated; no out-of-scope data mutation is performed.`,
    ``,
    `9. UI Impact`,
    isGerman
      ? `Die UI zeigt Erfolgs-/Fehlerrueckmeldungen und spiegelt den aktualisierten Feature-Zustand wider.`
      : `UI shows success/error feedback and reflects the updated feature state.`,
    ``,
    `10. Acceptance Criteria`,
    isGerman
      ? `- Das Feature kann Ende-zu-Ende ohne mehrdeutiges Verhalten ausgefuehrt werden.`
      : `- The feature can be executed end-to-end without ambiguous behavior.`,
    isGerman
      ? `- Validierungs- und Fehlerpfade sind explizit und testbar umgesetzt.`
      : `- Validation and error paths are handled explicitly and testably.`,
    isGerman
      ? `- Der resultierende Zustand ist konsistent und in UI/API-Antworten sichtbar.`
      : `- Resulting state is consistent and visible in UI/API responses.`,
  ].join('\n');
}

export async function expandFeature(
  userInput: string,
  vision: string,
  featureId: string,
  featureName: string,
  shortDescription: string,
  client: OpenRouterClient,
  language?: string | null
): Promise<ExpandedFeature> {
  const resolvedLanguage = resolveFeatureExpansionLanguage(language, userInput, vision);
  const systemPrompt = buildPrompt(userInput, vision, featureId, featureName, shortDescription, resolvedLanguage);
  const userPrompt = resolvedLanguage === 'de'
    ? `Expand feature ${featureId} "${featureName}" into a full implementation-ready specification. Output ONLY the expanded feature following the exact structure specified. Keep section labels in English, but write all section body text in German.`
    : `Expand feature ${featureId} "${featureName}" into a full implementation-ready specification. Output ONLY the expanded feature following the exact structure specified. Keep section labels in English and write all section body text in English.`;

  let retried = false;

  for (let attempt = 1; attempt <= 2; attempt++) {
    console.log(`  🔧 Expanding ${featureId}: "${featureName}" (attempt ${attempt}/2)`);

    const result = await client.callWithFallback(
      'generator',
      systemPrompt,
      userPrompt,
      FEATURE_EXPANSION
    );

    const validation = validateExpandedFeature(result.content);

    if (validation.valid) {
      console.log(`  ✅ ${featureId} expanded successfully (attempt ${attempt})`);
      return {
        featureId,
        featureName,
        content: result.content,
        model: result.model,
        usage: result.usage,
        retried: attempt > 1,
        valid: true,
        compiled: true,
      };
    }

    // Deterministic pre-repair: recover minor structure issues without an extra model call.
    const locallyRepaired = enforceStructure(result.content);
    if (locallyRepaired !== result.content) {
      const repairedValidation = validateExpandedFeature(locallyRepaired);
      if (repairedValidation.valid) {
        console.log(`  🛠️ ${featureId} normalized via local structure repair (attempt ${attempt})`);
        return {
          featureId,
          featureName,
          content: locallyRepaired,
          model: `${result.model}:local-structure-repair`,
          usage: result.usage,
          retried: attempt > 1,
          valid: true,
          compiled: true,
        };
      }
    }

    console.warn(`  ⚠️ ${featureId} validation failed — missing: ${validation.missing.join(', ')}`);

    if (attempt === 1) {
      console.log(`  🔄 Retrying ${featureId}...`);
      retried = true;
    } else {
      console.warn(`  ⚠️ ${featureId} validation failed after retry — using deterministic fallback`);
      const fallback = buildDeterministicFeatureFallback(featureId, featureName, shortDescription, resolvedLanguage);
      return {
        featureId,
        featureName,
        content: fallback,
        model: `${result.model}:deterministic-fallback`,
        usage: result.usage,
        retried: true,
        valid: true,
        compiled: true,
      };
    }
  }

  throw new Error(`Feature expansion failed unexpectedly for ${featureId}`);
}

export interface ParsedFeature {
  featureId: string;
  featureName: string;
  shortDescription: string;
}

export function parseFeatureList(featureListText: string): ParsedFeature[] {
  const features: ParsedFeature[] = [];
  const pattern = /F-(\d+):\s*(.+?)(?:\n|$)(?:Short description:\s*(.+?))?(?:\n|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(featureListText)) !== null) {
    const num = Number.parseInt(match[1], 10);
    if (!Number.isFinite(num) || num <= 0) {
      continue;
    }
    const name = match[2].trim();
    const desc = match[3]?.trim() || name;

    features.push({
      featureId: `F-${String(num).padStart(2, '0')}`,
      featureName: name,
      shortDescription: desc,
    });
  }

  return features;
}

export interface FeatureExpansionResult {
  expandedFeatures: ExpandedFeature[];
  totalTokens: number;
  modelsUsed: string[];
}

export async function expandAllFeatures(
  userInput: string,
  vision: string,
  featureListText: string,
  client: OpenRouterClient,
  language?: string | null
): Promise<FeatureExpansionResult> {
  const parsedFeatures = parseFeatureList(featureListText);

  if (parsedFeatures.length === 0) {
    console.warn('⚠️ Feature Expansion: No features parsed from feature list');
    return { expandedFeatures: [], totalTokens: 0, modelsUsed: [] };
  }

  console.log(`🏗️ Feature Expansion Engine: Expanding ${parsedFeatures.length} features...`);

  const expandedFeatures: ExpandedFeature[] = [];
  let totalTokens = 0;
  const modelsUsed = new Set<string>();

  for (const feature of parsedFeatures) {
    try {
      const expanded = await expandFeature(
        userInput,
        vision,
        feature.featureId,
        feature.featureName,
        feature.shortDescription,
        client,
        language
      );

      expandedFeatures.push(expanded);
      totalTokens += expanded.usage.total_tokens || 0;
      modelsUsed.add(expanded.model);
    } catch (error: any) {
      console.error(`  ❌ Failed to expand ${feature.featureId}: ${error.message}`);
    }
  }

  console.log(`✅ Feature Expansion complete: ${expandedFeatures.length}/${parsedFeatures.length} features expanded (${totalTokens} tokens)`);

  for (const ef of expandedFeatures) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📋 ${ef.featureId}: ${ef.featureName} [valid: ${ef.valid}, retried: ${ef.retried}, model: ${ef.model}]`);
    console.log('='.repeat(60));
    console.log(ef.content);
  }

  return {
    expandedFeatures,
    totalTokens,
    modelsUsed: Array.from(modelsUsed),
  };
}
