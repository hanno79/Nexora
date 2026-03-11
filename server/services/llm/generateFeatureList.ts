import type { OpenRouterClient } from '../../openrouter';
import type { TokenUsage } from "@shared/schema";
import { FEATURE_LIST_GENERATION } from '../../tokenBudgets';

const FEATURE_IDENTIFICATION_PROMPT = `You are part of the Nexora Requirements Compiler.

Your task is NOT to generate a full PRD.

Your task is ONLY to identify a two-level feature structure based on the given system idea and vision.

----------------------------------------
INPUT
----------------------------------------

System Idea:
\${userInput}

System Vision:
\${vision}

\${contextBlock}

----------------------------------------
OBJECTIVE
----------------------------------------

Identify a two-level structure with Main Tasks and Subtasks.

Main Tasks must:

- Represent one coherent business capability
- Group related Subtasks that belong to the same capability boundary
- Never become a third-level checklist

Subtasks must:

- Represent a single capability
- Can be implemented as standalone development tasks
- Are small, precise, and independently testable
- Are not vague
- Do not combine multiple capabilities
- Do not describe benefits or vision

The complete system must later be describable as the sum of these Subtasks.

\${featureTargetGuidance}

Think about:
- Each clear user-facing capability or workflow
- The smallest set of testable Subtasks needed inside that capability
- What belongs inside acceptance criteria later, instead of becoming a third task level
- Setup, deployment, generic validation, and generic error handling only when they are explicitly requested or truly standalone capabilities

\${featureMinimumGuidance}

----------------------------------------
OUTPUT FORMAT (STRICT)
----------------------------------------

Feature List:

Main Task: <Capability name>
Task Summary: <1 sentence that defines the boundary of this capability>

F-01: <Short Clear Subtask Name>
Short description: <1 sentence stating the concrete deliverable of this subtask>

F-02: <Short Clear Feature Name>
Short description: <1 sentence stating the concrete deliverable of this subtask>

Main Task: <Next capability name>
Task Summary: <1 sentence capability boundary>

F-03: ...

Rules:
- Use sequential numbering starting at F-01
- Do not skip numbers
- Every F-XX entry is a Subtask belonging to the most recent Main Task
- Output exactly 2 levels: Main Task -> Subtasks
- Do not create a third hierarchy level under the Subtasks
- Do not write detailed flows
- Do not write acceptance criteria yet
- Do not explain architecture
- Do not use vague language like "etc." or "and more"
- Do not combine multiple Subtasks into one
- Do not split generic validation, deployment, setup, logging, or generic error handling into separate Subtasks unless explicitly required by the request

Only output the feature list.`;

interface FeatureListScopeGuidance {
  targetGuidance: string;
  minimumGuidance: string;
  retryMinimumFeatures: number;
}

function buildPrompt(
  userInput: string,
  vision: string,
  context: { domainModel?: string; systemBoundaries?: string } | undefined,
  scopeGuidance: FeatureListScopeGuidance,
): string {
  let contextBlock = '';
  if (context?.domainModel || context?.systemBoundaries) {
    const parts: string[] = [];
    if (context.domainModel) parts.push(`Domain Model:\n${context.domainModel}`);
    if (context.systemBoundaries) parts.push(`System Boundaries:\n${context.systemBoundaries}`);
    contextBlock = `Additional Context:\n${parts.join('\n\n')}`;
  }
  return FEATURE_IDENTIFICATION_PROMPT
    .replaceAll('${userInput}', userInput)
    .replaceAll('${vision}', vision)
    .replaceAll('${featureTargetGuidance}', scopeGuidance.targetGuidance)
    .replaceAll('${featureMinimumGuidance}', scopeGuidance.minimumGuidance)
    .replaceAll('${contextBlock}', contextBlock);
}

// ÄNDERUNG 10.03.2026: Kleine/fokussierte Anforderungen dürfen nicht mehr pauschal auf 8+ Features hochgedrückt werden.
const DEFAULT_RETRY_MINIMUM_FEATURES = 5;
const HARD_MINIMUM_FEATURES = 3;
const SMALL_SCOPE_MAX_PRIMARY_INPUT_LENGTH = 240;

function resolveFeatureListScopeGuidance(
  userInput: string,
  vision: string,
  context?: { domainModel?: string; systemBoundaries?: string }
): FeatureListScopeGuidance {
  const primaryUserInput = String(userInput || '').trim();

  if (primaryUserInput.length <= SMALL_SCOPE_MAX_PRIMARY_INPUT_LENGTH) {
    return {
      targetGuidance: 'Choose the smallest complete set of Main Tasks and Subtasks. For a small or tightly scoped request, 1–2 Main Tasks with 3–5 Subtasks total are often enough. Only add more when the original user request clearly requires it.',
      minimumGuidance: 'If you identify fewer than 3 Subtasks, only revise when a clearly requested user-facing capability is still missing.',
      retryMinimumFeatures: HARD_MINIMUM_FEATURES,
    };
  }

  return {
    targetGuidance: 'Choose the smallest complete set of Main Tasks and Subtasks. For a typical application, 2–4 Main Tasks with 5–10 Subtasks total are often enough. Only exceed this when the original user request clearly requires it.',
    minimumGuidance: `If you identify fewer than ${DEFAULT_RETRY_MINIMUM_FEATURES} Subtasks, check whether clearly distinct user flows or business capabilities are still being merged too aggressively.`,
    retryMinimumFeatures: DEFAULT_RETRY_MINIMUM_FEATURES,
  };
}

function validateFeatureList(text: string, attempt: number, retryMinimumFeatures: number): { valid: boolean; reason?: string } {
  const featurePattern = /F-(\d+):/g;
  const matches: number[] = [];
  const lines = text.split('\n');
  let mainTaskCount = 0;
  let hasActiveMainTask = false;
  let match: RegExpExecArray | null;

  while ((match = featurePattern.exec(text)) !== null) {
    matches.push(parseInt(match[1], 10));
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^Main Task\s*:/i.test(line)) {
      mainTaskCount++;
      hasActiveMainTask = true;
      continue;
    }
    if (/^F[- ]?\d+\s*:/i.test(line) && !hasActiveMainTask) {
      return { valid: false, reason: 'Found a subtask before any Main Task heading' };
    }
  }

  // Hard minimum: always reject fewer than 3
  if (matches.length < HARD_MINIMUM_FEATURES) {
    return { valid: false, reason: `Only ${matches.length} features found (minimum ${HARD_MINIMUM_FEATURES} required)` };
  }

  if (mainTaskCount === 0) {
    return { valid: false, reason: 'No Main Task headings found in feature list output' };
  }

  if (matches[0] !== 1) {
    return { valid: false, reason: `Numbering does not start at F-01 (starts at F-${String(matches[0]).padStart(2, '0')})` };
  }

  for (let i = 1; i < matches.length; i++) {
    if (matches[i] !== matches[i - 1] + 1) {
      return { valid: false, reason: `Gap in numbering between F-${String(matches[i - 1]).padStart(2, '0')} and F-${String(matches[i]).padStart(2, '0')}` };
    }
  }

  // On first attempt, encourage more features by retrying if too few
  if (attempt === 1 && retryMinimumFeatures > HARD_MINIMUM_FEATURES && matches.length < retryMinimumFeatures) {
    return { valid: false, reason: `Only ${matches.length} features found (aiming for ${retryMinimumFeatures}+). Retrying for better decomposition.` };
  }

  return { valid: true };
}

export async function generateFeatureList(
  userInput: string,
  vision: string,
  client: OpenRouterClient,
  context?: { domainModel?: string; systemBoundaries?: string },
  abortSignal?: AbortSignal
): Promise<{ featureList: string; model: string; usage: TokenUsage; retried: boolean }> {
  const scopeGuidance = resolveFeatureListScopeGuidance(userInput, vision, context);
  const systemPrompt = buildPrompt(userInput, vision, context, scopeGuidance);
  const userPrompt = `Based on the system idea and vision provided, identify the Main Tasks and Subtasks. Output ONLY the two-level feature list in the strict format specified.`;

  let retried = false;

  for (let attempt = 1; attempt <= 2; attempt++) {
    console.log(`🔍 Feature Identification Layer: Attempt ${attempt}/2`);

    const result = await client.callWithFallback(
      'generator',
      systemPrompt,
      userPrompt,
      FEATURE_LIST_GENERATION
    );

    const validation = validateFeatureList(result.content, attempt, scopeGuidance.retryMinimumFeatures);

    if (validation.valid) {
      console.log(`✅ Feature list validated successfully (attempt ${attempt})`);
      return {
        featureList: result.content,
        model: result.model,
        usage: result.usage,
        retried: attempt > 1
      };
    }

    console.warn(`⚠️ Feature list validation failed: ${validation.reason}`);

    if (attempt === 1) {
      if (abortSignal?.aborted) {
        return { featureList: result.content, model: result.model, usage: result.usage, retried: false };
      }
      console.log('🔄 Retrying feature identification with higher target...');
      retried = true;
    } else {
      console.warn('⚠️ Feature list validation failed after retry — returning raw output');
      return {
        featureList: result.content,
        model: result.model,
        usage: result.usage,
        retried: true
      };
    }
  }

  throw new Error('Feature identification failed unexpectedly');
}
