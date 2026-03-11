/**
 * PRD Parser - Hauptmodul
 * Author: rahn
 * Datum: 04.03.2026
 * Version: 2.0
 * Beschreibung: Haupt-Parser für PRD Dokumente, nutzt ausgelagerte Module
 */

import type { PRDStructure } from './prdStructure';
import { logger } from './logger';
import {
  normalizeFeatureId,
  dedupeFeatures,
  splitIntoSections,
  mergeSectionContent,
  normalizeHeadingForAliasMatching,
} from './prdParserUtils';
import {
  parseFeatureMetadata,
  parseFeatureSubsections,
  parseFeatureBlocks,
} from './prdFeatureParser';
import {
  KNOWN_SECTION_MAP,
  FEATURE_CATALOGUE_HEADINGS,
  FEATURE_CATALOGUE_INTRO_HEADINGS,
  resolveTemplateAliasTarget,
} from './prdSectionMappings';

export {
  normalizeFeatureId,
  dedupeFeatures,
  splitIntoSections,
  mergeSectionContent,
  normalizeBrokenHeadingBoundaries,
} from './prdParserUtils';

export {
  parseFeatureMetadata,
  parseFeatureSubsections,
  parseFeatureBlocks,
} from './prdFeatureParser';

/**
 * Logs structure validation details for debugging
 */
export function logStructureValidation(structure: PRDStructure | undefined | null): void {
  if (!structure) {
    logger.warn('Structure validation: No structure provided');
    return;
  }
  
  const featureCount = structure.features?.length || 0;
  const structuredFeatures = structure.features?.filter(f => 
    f.purpose || f.actors || f.mainFlow || f.acceptanceCriteria
  ).length || 0;
  
  logger.debug('Structure validation', {
    featureCount,
    structuredFeatures,
    hasSystemVision: !!structure.systemVision,
    hasSystemBoundaries: !!structure.systemBoundaries,
    hasDomainModel: !!structure.domainModel,
    hasNonFunctional: !!structure.nonFunctional,
    hasErrorHandling: !!structure.errorHandling,
    hasDeployment: !!structure.deployment,
    hasDefinitionOfDone: !!structure.definitionOfDone,
    hasOutOfScope: !!structure.outOfScope,
    hasTimelineMilestones: !!structure.timelineMilestones,
    hasSuccessCriteria: !!structure.successCriteria,
  });
}

export function parsePRDToStructure(markdown: string): PRDStructure {
  const structure: PRDStructure = {
    features: [],
    otherSections: {},
  };

  const sections = splitIntoSections(markdown);

  for (const section of sections) {
    if (!section.heading) {
      continue;
    }

    const normalizedHeading = section.heading
      .replace(/^\d+[\.\)]\s*/, '')
      .replace(/\*+/g, '')
      .trim()
      .toLowerCase();

    const isExplicitNonFunctional =
      normalizedHeading.includes('non-functional requirements') ||
      normalizedHeading.includes('non functional requirements') ||
      normalizedHeading.includes('nicht-funktionale anforderungen') ||
      normalizedHeading.includes('nicht funktionale anforderungen');

    const isFeatureCatalogue = !isExplicitNonFunctional && FEATURE_CATALOGUE_HEADINGS.some(
      (h: string) => normalizedHeading.includes(h)
    );

    if (isFeatureCatalogue) {
      const { features, introText } = parseFeatureBlocks(section.body);
      if (introText) {
        structure.featureCatalogueIntro = introText;
      }
      if (features.length > 0) {
        structure.features.push(...features);
      } else if (!introText) {
        structure.otherSections[section.heading] = section.body;
      }
      continue;
    }

    const isFeatureCatalogueIntroHeading = FEATURE_CATALOGUE_INTRO_HEADINGS.some(
      (h: string) => normalizedHeading.includes(h)
    );
    if (isFeatureCatalogueIntroHeading) {
      structure.featureCatalogueIntro = mergeSectionContent(
        structure.featureCatalogueIntro || '',
        section.body
      );
      continue;
    }

    const aliasTarget = resolveTemplateAliasTarget(normalizedHeading);
    if (aliasTarget) {
      const existing = String((structure as any)[aliasTarget] || '');
      (structure as any)[aliasTarget] = mergeSectionContent(existing, section.body);
      continue;
    }

    const mappedKey = Object.entries(KNOWN_SECTION_MAP).find(([pattern]) => {
      if (pattern === 'out of scope') {
        return /\bout\s+of\s+scope\b/i.test(normalizedHeading);
      }
      if (pattern === 'scope') {
        return /^\s*scope(?:\b|[\s:])/.test(normalizedHeading);
      }
      if (pattern.length <= 3) {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`, 'i').test(normalizedHeading);
      }
      return normalizedHeading.includes(pattern);
    });

    if (mappedKey) {
      const key = mappedKey[1] as keyof PRDStructure;
      if (key !== 'features' && key !== 'otherSections') {
        const currentVal = (structure as any)[key as string];
        const currentLen = typeof currentVal === 'string' ? currentVal.trim().length : 0;
        const nextLen = typeof section.body === 'string' ? section.body.trim().length : 0;
        // Keep the richer section when duplicate headings/aliases appear.
        if (nextLen >= currentLen) {
          (structure as any)[key as string] = section.body;
        }
      }
    } else {
      const featureMatch = normalizedHeading.match(/^(?:feature\s+(?:id:\s*)?)?(?:feature\s+id:\s*)?(f[- ]?\d+)/);
      if (featureMatch) {
        const featureId = featureMatch[1].toUpperCase();
        const featureName = section.heading
          .replace(/^\d+[\.\)]\s*/, '')
          .replace(/^(?:Feature\s+)?F[- ]?\d+[:\s—–-]*/i, '')
          .replace(/\*+/g, '')
          .trim();
        structure.features.push({
          id: normalizeFeatureId(featureId),
          name: featureName || featureId,
          rawContent: section.body,
          ...parseFeatureMetadata(section.body),
          ...parseFeatureSubsections(section.body),
        });
      } else {
        structure.otherSections[section.heading] = section.body;
      }
    }
  }

  // Global fallback: salvage feature specs even if section structure drifted.
  // Only add missing IDs so a broad fallback scan cannot overwrite cleaner
  // feature blocks parsed from the dedicated catalogue section.
  const globalFeatureScan = parseFeatureBlocks(markdown);
  if (globalFeatureScan.features.length > 0) {
    const existingFeatureIds = new Set(
      structure.features
        .map(feature => normalizeFeatureId(feature.id))
        .filter(Boolean),
    );

    for (const fallbackFeature of globalFeatureScan.features) {
      const fallbackId = normalizeFeatureId(fallbackFeature.id);
      if (!fallbackId || existingFeatureIds.has(fallbackId)) {
        continue;
      }

      structure.features.push(fallbackFeature);
      existingFeatureIds.add(fallbackId);
    }
  }
  structure.features = dedupeFeatures(structure.features);

  return structure;
}
