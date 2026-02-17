import type { PRDStructure } from './prdStructure';
import type { SectionUpdateResult } from './prdJsonSchemas';
import type { OpenRouterClient } from './openrouter';

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

You MUST return valid JSON only.`;

export async function regenerateSectionAsJson(
  sectionName: keyof PRDStructure,
  currentStructure: PRDStructure,
  feedback: string,
  visionContext: string,
  client: OpenRouterClient,
  langInstruction: string = ''
): Promise<SectionUpdateResult> {
  const currentContent = currentStructure[sectionName];
  const displayName = SECTION_DISPLAY_NAMES[sectionName] || String(sectionName);
  const normalizedCurrentContent = typeof currentContent === 'string' ? currentContent.trim() : '';
  const sectionContext = normalizedCurrentContent.length > 0
    ? normalizedCurrentContent
    : '(This section is currently empty and must be created from reviewer feedback and system vision.)';

  const userPrompt = `INPUT

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

  const result = await client.callWithFallback(
    'reviewer',
    JSON_REGEN_SYSTEM_PROMPT + langInstruction,
    userPrompt,
    2000
  );

  const rawResponse = result.content.trim();

  const parsed = parseJsonResponse(rawResponse, sectionName);

  if (!parsed.updatedContent || parsed.updatedContent.trim().length < 20) {
    throw new Error(`JSON section regeneration produced insufficient content (${parsed.updatedContent?.length || 0} chars)`);
  }

  console.log(`📋 Section "${displayName}" JSON-regenerated: ${result.usage.completion_tokens} tokens using ${result.model}`);

  return parsed;
}

function parseJsonResponse(raw: string, expectedSection: keyof PRDStructure): SectionUpdateResult {
  let jsonStr = raw;

  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
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
