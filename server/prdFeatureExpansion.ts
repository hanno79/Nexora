// Shared Feature Expansion Pipeline — single source of truth for all flows.
// Runs: vision extraction → feature list → expand all features → parse → merge → assemble.
import type { OpenRouterClient } from './openrouter';
import type { PRDStructure } from './prdStructure';
import { generateFeatureList } from './services/llm/generateFeatureList';
import { expandAllFeatures } from './services/llm/expandFeature';
import { parsePRDToStructure } from './prdParser';
import { mergeExpansionIntoStructure } from './prdStructureMerger';
import { assembleStructureToMarkdown } from './prdAssembler';

// ÄNDERUNG 01.03.2026: Strukturelle Vollständigkeitsprüfung statt Längenprüfung
/**
 * Extrahiert alle Markdown-Überschriften (## und ###) aus dem Text.
 * Normalisiert für Vergleich (lowercase, trim).
 */
function extractHeadings(content: string): string[] {
  const headings: string[] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^#{2,3}\s+(.+)$/);
    if (match) {
      headings.push(match[1].trim().toLowerCase());
    }
  }
  return headings;
}

/**
 * Prüft ob der angereicherte Text strukturell vollständig ist.
 * Vergleicht ob alle wichtigen Überschriften aus dem Draft im assembled Text vorhanden sind.
 */
function isStructurallyComplete(assembled: string, draftContent: string): boolean {
  const draftHeadings = extractHeadings(draftContent);
  const assembledHeadings = extractHeadings(assembled);
  const assembledSet = new Set(assembledHeadings);

  // Wenn der Draft keine Überschriften hat, können wir keine strukturelle Prüfung durchführen
  if (draftHeadings.length === 0) {
    return assembled.length >= draftContent.length * 0.8;
  }

  // Prüfe ob alle Draft-Überschriften im assembled vorhanden sind
  const missingHeadings = draftHeadings.filter(h => !assembledSet.has(h));

  // Erlaube maximal 20% fehlende Überschriften (für optionale/gemergte Abschnitte)
  // Mindestens 1 erlaubte Abweichung für kleine Dokumente
  const threshold = Math.max(1, Math.ceil(draftHeadings.length * 0.2));
  return missingHeadings.length <= threshold;
}

export interface FeatureExpansionResult {
  enrichedStructure: PRDStructure | undefined;
  assembledContent: string | undefined;
  expandedFeatureCount: number;
  expansionTokens: number;
  featureListModel: string | undefined;
  expandedFeatures: any[];
}

/**
 * Extract vision/summary from PRD content for use in feature generation prompts.
 */
export function extractVisionFromContent(content: string): string {
  const visionPatterns = [
    /##\s*(?:1\.\s*)?System Vision\s*\n([\s\S]*?)(?=\n##\s)/i,
    /##\s*(?:1\.\s*)?Executive Summary\s*\n([\s\S]*?)(?=\n##\s)/i,
    /##\s*Vision\s*\n([\s\S]*?)(?=\n##\s)/i,
  ];

  for (const pattern of visionPatterns) {
    const match = content.match(pattern);
    if (match && match[1]?.trim().length > 20) {
      return match[1].trim();
    }
  }

  const firstParagraphs = content.split('\n').filter(l => l.trim().length > 0).slice(0, 5).join('\n');
  return firstParagraphs || content.substring(0, 500);
}

/**
 * Run the full feature expansion pipeline: identify features → expand each one →
 * merge into PRD structure → assemble to markdown.
 *
 * This is the shared implementation used by Simple, Iterative, and Guided flows.
 * Flow-specific logic (freeze activation, cancellation) should be handled by the caller.
 */
export async function runFeatureExpansionPipeline(params: {
  inputText: string;
  draftContent: string;
  client: OpenRouterClient;
  language: 'de' | 'en';
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
}): Promise<FeatureExpansionResult> {
  const { inputText, draftContent, client, language } = params;
  const logFn = params.log ?? (() => {});
  const warnFn = params.warn ?? (() => {});

  const empty: FeatureExpansionResult = {
    enrichedStructure: undefined,
    assembledContent: undefined,
    expandedFeatureCount: 0,
    expansionTokens: 0,
    featureListModel: undefined,
    expandedFeatures: [],
  };

  try {
    logFn('🧩 Feature Identification Layer: Extracting atomic features...');
    const vision = extractVisionFromContent(draftContent);
    // Extract existing domain context to help feature identification produce more features
    const domainModelMatch = draftContent.match(/##\s*Domain Model\s*\n([\s\S]*?)(?=\n##\s|\n---\s|$)/i);
    const boundariesMatch = draftContent.match(/##\s*System Boundaries\s*\n([\s\S]*?)(?=\n##\s|\n---\s|$)/i);
    const featureContext = (domainModelMatch || boundariesMatch) ? {
      domainModel: domainModelMatch?.[1]?.trim(),
      systemBoundaries: boundariesMatch?.[1]?.trim(),
    } : undefined;
    const featureResult = await generateFeatureList(inputText, vision, client, featureContext);
    const topLevelFeatureLines = featureResult.featureList
      .split('\n')
      .filter((line) => line.trim().startsWith('- '))
      .length;
    logFn(
      `🧩 Feature List generated (model: ${featureResult.model}, retried: ${featureResult.retried}, ` +
      `${topLevelFeatureLines} lines, ${featureResult.featureList.length} chars)`
    );

    try {
      logFn('🏗️ Feature Expansion Engine: Starting modular expansion...');
      const expansionResult = await expandAllFeatures(
        inputText,
        vision,
        featureResult.featureList,
        client,
        language,
      );
      logFn(`🏗️ Feature Expansion complete: ${expansionResult.expandedFeatures.length} features, ${expansionResult.totalTokens} tokens`);

      if (expansionResult.expandedFeatures.length === 0) {
        return { ...empty, featureListModel: featureResult.model };
      }

      // Parse draft content into structure and merge expanded features
      let enrichedStructure: PRDStructure | undefined;
      let assembledContent: string | undefined;
      try {
        const baseStructure = parsePRDToStructure(draftContent);
        enrichedStructure = mergeExpansionIntoStructure(baseStructure, expansionResult.expandedFeatures);
        logFn(`📦 Structure enriched: ${enrichedStructure.features.length} features with structured fields`);

        const assembled = assembleStructureToMarkdown(enrichedStructure);
        // ÄNDERUNG 01.03.2026: Längenprüfung durch strukturelle Vollständigkeitsprüfung ersetzt
        if (isStructurallyComplete(assembled, draftContent)) {
          assembledContent = assembled;
        }
      } catch (mergeError: any) {
        warnFn('⚠️ Structure merge failed (non-blocking): ' + mergeError.message);
      }

      return {
        enrichedStructure,
        assembledContent,
        expandedFeatureCount: expansionResult.expandedFeatures.length,
        expansionTokens: expansionResult.totalTokens,
        featureListModel: featureResult.model,
        expandedFeatures: expansionResult.expandedFeatures,
      };
    } catch (expansionError: any) {
      warnFn('⚠️ Feature Expansion Engine failed (non-blocking): ' + expansionError.message);
      return { ...empty, featureListModel: featureResult.model };
    }
  } catch (error: any) {
    warnFn('⚠️ Feature Identification Layer failed (non-blocking): ' + error.message);
    return empty;
  }
}
