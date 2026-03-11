// Shared Feature Expansion Pipeline — single source of truth for all flows.
// Runs: vision extraction → feature list → expand all features → parse → merge → assemble.
import type { OpenRouterClient } from './openrouter';
import type { PRDStructure, FeatureSpec } from './prdStructure';
import { generateFeatureList } from './services/llm/generateFeatureList';
import { expandAllFeatures } from './services/llm/expandFeature';
import { normalizeFeatureId, parsePRDToStructure } from './prdParser';
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
  // Mindestens eine Überschrift muss auch bei kleinen Dokumenten erhalten bleiben
  const threshold = Math.min(
    Math.max(1, Math.ceil(draftHeadings.length * 0.2)),
    draftHeadings.length - 1,
  );
  return missingHeadings.length <= threshold;
}

function isAbortError(error: any, abortSignal?: AbortSignal): boolean {
  return Boolean(
    abortSignal?.aborted
    || error?.name === 'AbortError'
    || error?.code === 'ERR_CLIENT_DISCONNECT'
  );
}

function toAbortError(error: any, message: string): Error {
  if (error?.name === 'AbortError' || error?.code === 'ERR_CLIENT_DISCONNECT') {
    return error;
  }
  const abortError: any = new Error(message);
  abortError.name = 'AbortError';
  abortError.code = 'ERR_CLIENT_DISCONNECT';
  return abortError;
}

function throwIfAborted(abortSignal: AbortSignal | undefined, message: string): void {
  if (!abortSignal?.aborted) return;
  throw toAbortError(undefined, message);
}

function normalizeFeatures(features: FeatureSpec[]): FeatureSpec[] {
  return features
    .map((feature) => {
      const rawId = String(feature.id || '').trim();
      const canonicalId = normalizeFeatureId(feature.id) || rawId.toUpperCase();
      if (!canonicalId) return null;
      return { ...feature, id: canonicalId };
    })
    .filter((feature): feature is FeatureSpec => Boolean(feature));
}

export interface FeatureExpansionResult {
  enrichedStructure: PRDStructure | undefined;
  assembledContent: string | undefined;
  expandedFeatureCount: number;
  expansionTokens: number;
  featureListModel: string | undefined;
  expandedFeatures: any[];
  blockedFeatureIds?: string[];
}

function buildFeatureListFromStructureFeatures(features: FeatureSpec[]): string {
  const lines = ['Feature List:', ''];
  let currentParentKey = '__NONE__';

  for (const feature of features) {
    const rawId = String(feature.id || '').trim();
    const normalizedId = normalizeFeatureId(feature.id);
    const safeId = normalizedId || rawId.toUpperCase();
    const rawName = String(feature.name || '').trim();
    let safeName = rawName;
    if (!safeName) {
      safeName = safeId;
    }
    if (!safeName) {
      safeName = 'Feature';
    }
    const summarySource =
      String(feature.purpose || '').trim()
      || String(feature.trigger || '').trim()
      || String(feature.rawContent || '').trim();
    const shortDescription = summarySource
      .replace(/\s+/g, ' ')
      .replace(/^Feature ID:.*$/im, '')
      .replace(/^Feature Name:.*$/im, '')
      .replace(/^Parent Task:.*$/im, '')
      .replace(/^Parent Task Description:.*$/im, '')
      .trim()
      .slice(0, 180) || safeName;
    const parentTaskName = String(feature.parentTaskName || '').trim();
    const parentTaskDescription = String(feature.parentTaskDescription || '').trim();
    const parentKey = (parentTaskName || parentTaskDescription)
      ? `${parentTaskName}::${parentTaskDescription}`
      : '__NONE__';

    if (parentTaskName && parentKey !== currentParentKey) {
      if (lines[lines.length - 1] !== '') {
        lines.push('');
      }
      lines.push(`Main Task: ${parentTaskName}`);
      if (parentTaskDescription) {
        lines.push(`Task Summary: ${parentTaskDescription}`);
      }
      lines.push('');
      currentParentKey = parentKey;
    } else if (parentKey !== currentParentKey) {
      currentParentKey = parentKey;
    }

    lines.push(`${safeId}: ${safeName}`);
    lines.push(`Short description: ${shortDescription}`);
    lines.push('');
  }

  return lines.join('\n').trim();
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
  allowedFeatureIds?: string[];
  allowFeatureDiscovery?: boolean;
  seedFeatures?: FeatureSpec[];
  abortSignal?: AbortSignal;
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
    blockedFeatureIds: undefined,
  };

  try {
    throwIfAborted(params.abortSignal, 'Feature expansion aborted before identification.');
    logFn('🧩 Feature Identification Layer: Extracting atomic features...');
    const vision = extractVisionFromContent(draftContent);
    // Extract existing domain context to help feature identification produce more features
    const domainModelMatch = draftContent.match(/##\s*Domain Model\s*\n([\s\S]*?)(?=\n##\s|\n---\s|$)/i);
    const boundariesMatch = draftContent.match(/##\s*System Boundaries\s*\n([\s\S]*?)(?=\n##\s|\n---\s|$)/i);
    const featureContext = (domainModelMatch || boundariesMatch) ? {
      domainModel: domainModelMatch?.[1]?.trim(),
      systemBoundaries: boundariesMatch?.[1]?.trim(),
    } : undefined;
    const allowFeatureDiscovery = params.allowFeatureDiscovery !== false;
    const allowedFeatureIds = new Set(
      (params.allowedFeatureIds || [])
        .map(id => normalizeFeatureId(id) || String(id || '').trim().toUpperCase())
        .filter(Boolean)
    );
    let featureResult: { featureList: string; model: string; usage?: unknown; retried: boolean };
    let blockedFeatureIds: string[] | undefined;

    if (!allowFeatureDiscovery) {
      const baseStructure = parsePRDToStructure(draftContent);
      const normalizedSeedFeatures = normalizeFeatures(params.seedFeatures || []);
      const normalizedDraftFeatures = normalizeFeatures(baseStructure.features || []);
      const featureSource = normalizedSeedFeatures.length > 0 ? normalizedSeedFeatures : normalizedDraftFeatures;
      blockedFeatureIds = featureSource
        .filter(feature => allowedFeatureIds.size > 0 && !allowedFeatureIds.has(feature.id))
        .map(feature => `${feature.id}: ${feature.name}`);
      const eligibleFeatures = featureSource.filter(feature =>
        allowedFeatureIds.size === 0 || allowedFeatureIds.has(feature.id)
      );
      if (eligibleFeatures.length === 0) {
        logFn('🧩 Feature Expansion skipped: no eligible baseline features available for improve mode');
        return { ...empty, blockedFeatureIds };
      }
      featureResult = {
        featureList: buildFeatureListFromStructureFeatures(eligibleFeatures),
        model: 'existing-feature-catalogue',
        retried: false,
      };
    } else {
      try {
        featureResult = await generateFeatureList(inputText, vision, client, featureContext, params.abortSignal);
      } catch (error: any) {
        if (isAbortError(error, params.abortSignal)) {
          throw toAbortError(error, 'Feature identification aborted by caller.');
        }
        throw error;
      }
    }
    throwIfAborted(params.abortSignal, 'Feature identification aborted by caller.');
    const mainTaskCount = featureResult.featureList
      .split('\n')
      .filter((line) => /^\s*Main Task\s*:/i.test(line.trim()))
      .length;
    const subtaskCount = featureResult.featureList
      .split('\n')
      .filter((line) => /^\s*(?:-\s+)?F[- ]?\d+\s*:/i.test(line.trim()))
      .length;
    logFn(
      `🧩 Feature List generated (model: ${featureResult.model}, retried: ${featureResult.retried}, ` +
      `${mainTaskCount} main tasks, ${subtaskCount} subtasks, ${featureResult.featureList.length} chars)`
    );

    try {
      logFn('🏗️ Feature Expansion Engine: Starting modular expansion...');
      let expansionResult;
      try {
        expansionResult = await expandAllFeatures(
          inputText,
          vision,
          featureResult.featureList,
          client,
          language,
          params.abortSignal,
        );
      } catch (error: any) {
        if (isAbortError(error, params.abortSignal)) {
          throw toAbortError(error, 'Feature expansion aborted by caller.');
        }
        throw error;
      }
      throwIfAborted(params.abortSignal, 'Feature expansion aborted by caller.');
      logFn(`🏗️ Feature Expansion complete: ${expansionResult.expandedFeatures.length} features, ${expansionResult.totalTokens} tokens`);

      if (expansionResult.expandedFeatures.length === 0) {
        return { ...empty, featureListModel: featureResult.model, blockedFeatureIds };
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
        blockedFeatureIds,
      };
    } catch (expansionError: any) {
      if (isAbortError(expansionError, params.abortSignal)) {
        throw toAbortError(expansionError, 'Feature expansion aborted by caller.');
      }
      warnFn('⚠️ Feature Expansion Engine failed (non-blocking): ' + expansionError.message);
      return { ...empty, featureListModel: featureResult.model, blockedFeatureIds };
    }
  } catch (error: any) {
    if (isAbortError(error, params.abortSignal)) {
      throw toAbortError(error, 'Feature expansion aborted by caller.');
    }
    warnFn('⚠️ Feature Identification Layer failed (non-blocking): ' + error.message);
    return empty;
  }
}
