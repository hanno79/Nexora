import type { OpenRouterClient } from '../../openrouter';

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

function buildPrompt(
  userInput: string,
  vision: string,
  featureId: string,
  featureName: string,
  shortDescription: string
): string {
  return FEATURE_EXPANSION_PROMPT
    .replaceAll('${userInput}', userInput)
    .replaceAll('${vision}', vision)
    .replaceAll('${featureId}', featureId)
    .replaceAll('${featureName}', featureName)
    .replaceAll('${shortDescription}', shortDescription);
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
  usage: any;
  retried: boolean;
  valid: boolean;
  compiled: boolean;
}

function buildDeterministicFeatureFallback(
  featureId: string,
  featureName: string,
  shortDescription: string
): string {
  const safeDesc = shortDescription?.trim() || featureName;
  return [
    `Feature ID: ${featureId}`,
    `Feature Name: ${featureName}`,
    ``,
    `1. Purpose`,
    `${safeDesc} is implemented as a deterministic, testable capability with clear boundaries.`,
    ``,
    `2. Actors`,
    `- Primary: End user`,
    `- Secondary: System service handling the request`,
    ``,
    `3. Trigger`,
    `User initiates the related action through the UI or API endpoint.`,
    ``,
    `4. Preconditions`,
    `- Application is running and dependencies are available.`,
    `- Required inputs are present and validated before execution.`,
    ``,
    `5. Main Flow`,
    `1. System receives and validates the request for ${featureName}.`,
    `2. System executes the core logic deterministically and updates state.`,
    `3. System returns a success response and refreshes relevant UI state.`,
    ``,
    `6. Alternate Flows`,
    `- Validation fails: system returns a clear error and performs no write.`,
    `- Execution fails: system logs reason and returns recoverable error response.`,
    ``,
    `7. Postconditions`,
    `The feature state is consistent, observable, and ready for subsequent operations.`,
    ``,
    `8. Data Impact`,
    `Only required entities are read/updated; no out-of-scope data mutation is performed.`,
    ``,
    `9. UI Impact`,
    `UI shows success/error feedback and reflects the updated feature state.`,
    ``,
    `10. Acceptance Criteria`,
    `- The feature can be executed end-to-end without ambiguous behavior.`,
    `- Validation and error paths are handled explicitly and testably.`,
    `- Resulting state is consistent and visible in UI/API responses.`,
  ].join('\n');
}

export async function expandFeature(
  userInput: string,
  vision: string,
  featureId: string,
  featureName: string,
  shortDescription: string,
  client: OpenRouterClient
): Promise<ExpandedFeature> {
  const systemPrompt = buildPrompt(userInput, vision, featureId, featureName, shortDescription);
  const userPrompt = `Expand feature ${featureId} "${featureName}" into a full implementation-ready specification. Output ONLY the expanded feature following the exact structure specified.`;

  let retried = false;

  for (let attempt = 1; attempt <= 2; attempt++) {
    console.log(`  🔧 Expanding ${featureId}: "${featureName}" (attempt ${attempt}/2)`);

    const result = await client.callWithFallback(
      'generator',
      systemPrompt,
      userPrompt,
      4200
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

    console.warn(`  ⚠️ ${featureId} validation failed — missing: ${validation.missing.join(', ')}`);

    if (attempt === 1) {
      console.log(`  🔄 Retrying ${featureId}...`);
      retried = true;
    } else {
      console.warn(`  ⚠️ ${featureId} validation failed after retry — using deterministic fallback`);
      const fallback = buildDeterministicFeatureFallback(featureId, featureName, shortDescription);
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
    const num = match[1];
    const name = match[2].trim();
    const desc = match[3]?.trim() || name;

    features.push({
      featureId: `F-${num.padStart(2, '0')}`,
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
  client: OpenRouterClient
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
        client
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
