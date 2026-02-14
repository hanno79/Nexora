import type { OpenRouterClient } from '../../openrouter';

const FEATURE_IDENTIFICATION_PROMPT = `You are part of the Nexora Requirements Compiler.

Your task is NOT to generate a full PRD.

Your task is ONLY to identify atomic, independently implementable features based on the given system idea and vision.

----------------------------------------
INPUT
----------------------------------------

System Idea:
\${userInput}

System Vision:
\${vision}

----------------------------------------
OBJECTIVE
----------------------------------------

Identify discrete features that:

- Represent a single capability
- Can be implemented as standalone development tasks
- Are not vague
- Do not combine multiple capabilities
- Do not describe benefits or vision

The complete system must later be describable as the sum of these features.

----------------------------------------
OUTPUT FORMAT (STRICT)
----------------------------------------

Feature List:

F-01: <Short Clear Feature Name>
Short description: <1–2 sentence capability summary>

F-02: <Short Clear Feature Name>
Short description: <1–2 sentence capability summary>

F-03: ...

Rules:
- Use sequential numbering starting at F-01
- Do not skip numbers
- Do not write detailed flows
- Do not write acceptance criteria
- Do not explain architecture
- Do not use vague language like "etc." or "and more"
- Do not combine multiple features into one

Only output the feature list.`;

function buildPrompt(userInput: string, vision: string): string {
  return FEATURE_IDENTIFICATION_PROMPT
    .replaceAll('${userInput}', userInput)
    .replaceAll('${vision}', vision);
}

function validateFeatureList(text: string): { valid: boolean; reason?: string } {
  const featurePattern = /F-(\d+):/g;
  const matches: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = featurePattern.exec(text)) !== null) {
    matches.push(parseInt(match[1], 10));
  }

  if (matches.length < 3) {
    return { valid: false, reason: `Only ${matches.length} features found (minimum 3 required)` };
  }

  if (matches[0] !== 1) {
    return { valid: false, reason: `Numbering does not start at F-01 (starts at F-${String(matches[0]).padStart(2, '0')})` };
  }

  for (let i = 1; i < matches.length; i++) {
    if (matches[i] !== matches[i - 1] + 1) {
      return { valid: false, reason: `Gap in numbering between F-${String(matches[i - 1]).padStart(2, '0')} and F-${String(matches[i]).padStart(2, '0')}` };
    }
  }

  return { valid: true };
}

export async function generateFeatureList(
  userInput: string,
  vision: string,
  client: OpenRouterClient
): Promise<{ featureList: string; model: string; usage: any; retried: boolean }> {
  const systemPrompt = buildPrompt(userInput, vision);
  const userPrompt = `Based on the system idea and vision provided, identify all atomic features. Output ONLY the feature list in the strict format specified.`;

  let retried = false;

  for (let attempt = 1; attempt <= 2; attempt++) {
    console.log(`🔍 Feature Identification Layer: Attempt ${attempt}/2`);

    const result = await client.callWithFallback(
      'generator',
      systemPrompt,
      userPrompt,
      3000
    );

    const validation = validateFeatureList(result.content);

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
      console.log('🔄 Retrying feature identification...');
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
