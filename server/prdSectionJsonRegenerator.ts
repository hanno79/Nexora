import type { PRDStructure } from './prdStructure';
import type { SectionUpdateResult } from './prdJsonSchemas';
import type { OpenRouterClient } from './openrouter';

const MAX_JSON_RETRIES = 3;

const SECTION_DISPLAY_NAMES: Partial<Record<keyof PRDStructure, string>> = {
  systemVision: 'System Vision',
  systemBoundaries: 'System Boundaries',
  domainModel: 'Domain Model',
  globalBusinessRules: 'Global Business Rules',
  nonFunctional: 'Non-Functional Requirements',
  errorHandling: 'Error Handling & Recovery',
  deployment: 'Deployment & Infrastructure',
  definitionOfDone: 'Definition of Done',
};

const JSON_REGEN_SYSTEM_PROMPT = `You are part of the Nexora Requirements Compiler.

Your task is to update ONE section of the PRD structure.

You MUST return valid JSON only. No markdown, no code blocks, no explanations.`;

const JSON_REGEN_RETRY_SUFFIX = `

CRITICAL: Your previous response was NOT valid JSON. You MUST respond with ONLY a JSON object.
No text before the opening {. No text after the closing }. No markdown code fences.
The response must be parseable by JSON.parse() directly.`;

const JSON_REGEN_FINAL_SUFFIX = `

ABSOLUTE REQUIREMENT: Respond with NOTHING except a single JSON object.
Start your response with { and end with }. Any other character before { or after } will cause a fatal error.`;

export interface JsonRegenDiagnostics {
  retryAttempts: number;
  repairSuccesses: number;
}

export async function regenerateSectionAsJson(
  sectionName: keyof PRDStructure,
  currentStructure: PRDStructure,
  feedback: string,
  visionContext: string,
  client: OpenRouterClient,
  langInstruction: string = ''
): Promise<SectionUpdateResult & { diagnostics: JsonRegenDiagnostics }> {
  const currentContent = currentStructure[sectionName];
  const displayName = SECTION_DISPLAY_NAMES[sectionName] || String(sectionName);
  const normalizedCurrentContent = typeof currentContent === 'string' ? currentContent.trim() : '';
  const sectionContext = normalizedCurrentContent.length > 0
    ? normalizedCurrentContent
    : '(This section is currently empty and must be created from reviewer feedback and system vision.)';

  const baseUserPrompt = `INPUT

System Vision:
${visionContext}

Current Section Name:
${displayName}

Current Section Content:
${sectionContext}

Reviewer Feedback:
${feedback}

OBJECTIVE

Return ONLY a JSON object in this exact format:

{
  "sectionName": "${sectionName}",
  "updatedContent": "<fully regenerated section markdown>"
}

Rules:
- Do NOT include explanations
- Do NOT include markdown outside JSON
- Do NOT modify other sections
- Do NOT change Feature Specifications
- Keep formatting consistent
- Ensure completeness and technical precision

Return JSON only.`;

  const diagnostics: JsonRegenDiagnostics = { retryAttempts: 0, repairSuccesses: 0 };
  const errors: string[] = [];

  for (let attempt = 1; attempt <= MAX_JSON_RETRIES; attempt++) {
    diagnostics.retryAttempts = attempt;

    // Escalate prompt strictness with each retry
    let userPrompt = baseUserPrompt;
    let temperature: number | undefined;
    if (attempt === 2) {
      userPrompt += JSON_REGEN_RETRY_SUFFIX;
    } else if (attempt >= 3) {
      userPrompt += JSON_REGEN_FINAL_SUFFIX;
      temperature = 0.3;
    }

    try {
      const result = await client.callWithFallback(
        'reviewer',
        JSON_REGEN_SYSTEM_PROMPT + langInstruction,
        userPrompt,
        2000,
        { type: 'json_object' },
        temperature
      );

      const rawResponse = result.content.trim();

      // Try repair before parsing
      const repaired = attemptJsonRepair(rawResponse);
      const wasRepaired = repaired !== rawResponse;

      const parsed = parseJsonResponse(repaired, sectionName);

      if (!parsed.updatedContent || parsed.updatedContent.trim().length < 20) {
        throw new Error(`JSON section regeneration produced insufficient content (${parsed.updatedContent?.length || 0} chars)`);
      }

      if (wasRepaired) {
        diagnostics.repairSuccesses++;
        console.log(`🔧 JSON repair successful on attempt ${attempt} for "${displayName}"`);
      }

      console.log(`📋 Section "${displayName}" JSON-regenerated: ${result.usage.completion_tokens} tokens using ${result.model} (attempt ${attempt}/${MAX_JSON_RETRIES})`);

      return { ...parsed, diagnostics };
    } catch (err: any) {
      errors.push(`Attempt ${attempt}: ${err.message}`);
      console.warn(`⚠️ JSON attempt ${attempt}/${MAX_JSON_RETRIES} for "${displayName}" failed: ${err.message}`);

      if (attempt >= MAX_JSON_RETRIES) {
        const finalError = new Error(
          `JSON section regeneration failed after ${MAX_JSON_RETRIES} attempts for "${displayName}". Errors:\n${errors.join('\n')}`
        );
        (finalError as any).retryCount = MAX_JSON_RETRIES;
        throw finalError;
      }
    }
  }

  // Unreachable, but TypeScript needs it
  throw new Error('JSON regeneration exhausted all retries');
}

/**
 * Attempt to repair malformed JSON responses from AI models.
 * Common issues: leading text, trailing text, code blocks, embedded explanations.
 */
function attemptJsonRepair(raw: string): string {
  let str = raw.trim();

  // 1. Extract from markdown code blocks (```json ... ``` or ``` ... ```)
  const codeBlockMatch = str.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    str = codeBlockMatch[1].trim();
  }

  // 2. Remove leading text before first {
  const firstBrace = str.indexOf('{');
  if (firstBrace > 0) {
    str = str.substring(firstBrace);
  }

  // 3. Remove trailing text after last }
  const lastBrace = str.lastIndexOf('}');
  if (lastBrace >= 0 && lastBrace < str.length - 1) {
    str = str.substring(0, lastBrace + 1);
  }

  // 4. Handle case where AI wraps JSON in single quotes instead of double
  // Only if it's clearly not valid JSON as-is
  try {
    JSON.parse(str);
    return str;
  } catch {
    // Continue with more aggressive repair
  }

  // 5. Fix common escape issues: unescaped newlines in string values
  // Replace literal newlines inside JSON string values with \n
  str = str.replace(/(?<=":[ ]*"[^"]*)\n(?=[^"]*")/g, '\\n');

  return str;
}

function parseJsonResponse(raw: string, expectedSection: keyof PRDStructure): SectionUpdateResult {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`JSON parse failed: ${(e as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('JSON response is not an object');
  }

  if (typeof parsed.updatedContent !== 'string') {
    throw new Error('JSON response missing "updatedContent" string field');
  }

  if (parsed.sectionName && parsed.sectionName !== expectedSection) {
    console.warn(`⚠️ JSON response sectionName mismatch: expected "${expectedSection}", got "${parsed.sectionName}" — using expected value`);
  }

  return {
    sectionName: expectedSection,
    updatedContent: parsed.updatedContent.trim()
  };
}
