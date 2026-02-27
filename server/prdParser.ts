import type { PRDStructure, FeatureSpec } from './prdStructure';
import { logger } from './logger';

const KNOWN_SECTION_MAP: Record<string, keyof PRDStructure> = {
  'system vision': 'systemVision',
  'executive summary': 'systemVision',
  'vision': 'systemVision',
  'system boundaries': 'systemBoundaries',
  'boundaries': 'systemBoundaries',
  'scope': 'systemBoundaries',
  'system scope': 'systemBoundaries',
  'domain model': 'domainModel',
  'data model': 'domainModel',
  'domain': 'domainModel',
  'global business rules': 'globalBusinessRules',
  'business rules': 'globalBusinessRules',
  'non-functional requirements': 'nonFunctional',
  'non functional requirements': 'nonFunctional',
  'nfr': 'nonFunctional',
  'quality attributes': 'nonFunctional',
  'error handling': 'errorHandling',
  'error handling & recovery': 'errorHandling',
  'error handling and recovery': 'errorHandling',
  'deployment': 'deployment',
  'deployment & infrastructure': 'deployment',
  'deployment and infrastructure': 'deployment',
  'infrastructure': 'deployment',
  'definition of done': 'definitionOfDone',
  'done criteria': 'definitionOfDone',
  'out of scope': 'outOfScope',
  'timeline & milestones': 'timelineMilestones',
  'timeline and milestones': 'timelineMilestones',
  'timeline': 'timelineMilestones',
  'success criteria & acceptance testing': 'successCriteria',
  'success criteria and acceptance testing': 'successCriteria',
  'success criteria': 'successCriteria',
  'acceptance testing': 'successCriteria',
};

const FEATURE_CATALOGUE_HEADINGS = [
  'functional feature catalogue',
  'feature catalogue',
  'features',
  'functional requirements',
  'feature specifications',
  'must-have features',
  'must have features',
  'nice-to-have features',
  'nice to have features',
  'core features',
  'required features',
];

const FEATURE_CATALOGUE_INTRO_HEADINGS = [
  'user stories',
  'nutzergeschichten',
];

function mergeSectionContent(currentValue: string, incomingValue: string): string {
  const current = String(currentValue || '').trim();
  const incoming = String(incomingValue || '').trim();
  if (!current) return incoming;
  if (!incoming) return current;

  const currentNormalized = current.toLowerCase().replace(/\s+/g, ' ').trim();
  const incomingNormalized = incoming.toLowerCase().replace(/\s+/g, ' ').trim();
  if (currentNormalized.includes(incomingNormalized)) return current;
  if (incomingNormalized.includes(currentNormalized)) return incoming;
  return `${current}\n\n${incoming}`.trim();
}

function resolveTemplateAliasTarget(normalizedHeading: string): keyof PRDStructure | null {
  if (/(^|\b)problem\s*statement(\b|$)|(^|\b)problemstellung(\b|$)/i.test(normalizedHeading)) {
    return 'systemVision';
  }
  if (
    /(^|\b)goals?\s*(?:&|and)\s*success\s*metrics?(\b|$)|(^|\b)ziele?\s*(?:&|und)\s*(?:erfolgsmetriken|success\s*metrics?)(\b|$)/i.test(
      normalizedHeading
    )
  ) {
    return 'successCriteria';
  }
  if (
    /(^|\b)target\s*(?:audience|users?)\b|(^|\b)user\s*personas?(\b|$)|(^|\b)zielgruppe(\b|$)|(^|\b)persona?s?(\b|$)/i.test(
      normalizedHeading
    )
  ) {
    return 'systemBoundaries';
  }
  if (
    /(^|\b)user\s*interface\s*guidelines?(\b|$)|(^|\b)ui\s*guidelines?(\b|$)|(^|\b)ux\s*guidelines?(\b|$)|(^|\b)benutzeroberfl[aä]chen?\s*richtlinien(\b|$)/i.test(
      normalizedHeading
    )
  ) {
    return 'nonFunctional';
  }
  return null;
}

interface RawSection {
  heading: string;
  level: number;
  body: string;
}

export function normalizeBrokenHeadingBoundaries(markdown: string): string {
  // Some model outputs place "## Heading" inline after a sentence.
  // Normalize these cases so section splitting remains deterministic.
  return markdown.replace(/([^\n])[ \t]+(#{1,2}\s+[^\n#]+)/g, '$1\n\n$2');
}

export function normalizeFeatureId(value: string): string {
  const match = String(value || '').toUpperCase().match(/F-(\d+)/);
  if (!match) return '';
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return '';
  return `F-${String(parsed).padStart(2, '0')}`;
}

export function dedupeFeatures(features: FeatureSpec[]): FeatureSpec[] {
  const byId = new Map<string, FeatureSpec>();
  for (const feature of features) {
    const id = normalizeFeatureId(feature.id);
    if (!id) continue;

    const normalized: FeatureSpec = { ...feature, id };
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, normalized);
      continue;
    }

    // Prefer richer content when duplicate IDs appear.
    const currentLen = (normalized.rawContent || '').length;
    const existingLen = (existing.rawContent || '').length;
    if (currentLen > existingLen) {
      byId.set(id, normalized);
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true })
  );
}

export function splitIntoSections(markdown: string): RawSection[] {
  const sections: RawSection[] = [];
  const normalizedMarkdown = normalizeBrokenHeadingBoundaries(markdown);
  const lines = normalizedMarkdown.split('\n');

  let currentHeading = '';
  let currentLevel = 0;
  let currentBody: string[] = [];

  for (const line of lines) {
    // Treat only H1/H2 as top-level section boundaries.
    // H3+ is commonly used inside feature specs and must stay in-section.
    const headingMatch = line.match(/^(#{1,2})\s+(.+)$/);

    if (headingMatch) {
      if (currentHeading || currentBody.length > 0) {
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          body: currentBody.join('\n').trim(),
        });
      }
      currentLevel = headingMatch[1].length;
      currentHeading = headingMatch[2].trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }

  if (currentHeading || currentBody.length > 0) {
    sections.push({
      heading: currentHeading,
      level: currentLevel,
      body: currentBody.join('\n').trim(),
    });
  }

  return sections;
}

const SUBSECTION_ORDER = [
  { num: '1', field: 'purpose' as const, labels: ['Purpose', 'Zweck', 'Ziel', 'Nutzen'] },
  { num: '2', field: 'actors' as const, labels: ['Actors', 'Akteure', 'Beteiligte', 'Rollen'] },
  { num: '3', field: 'trigger' as const, labels: ['Trigger', 'Ausloeser', 'Ausloser'] },
  { num: '4', field: 'preconditions' as const, labels: ['Preconditions', 'Vorbedingungen', 'Voraussetzungen'] },
  { num: '5', field: 'mainFlow' as const, labels: ['Main Flow', 'Hauptablauf', 'Hauptfluss', 'Ablauf'] },
  { num: '6', field: 'alternateFlows' as const, labels: ['Alternate Flows', 'Alternative Ablaeufe', 'Alternativablaeufe', 'Alternative Flows', 'Ausnahmefaelle'] },
  { num: '7', field: 'postconditions' as const, labels: ['Postconditions', 'Nachbedingungen', 'Ergebniszustand'] },
  { num: '8', field: 'dataImpact' as const, labels: ['Data Impact', 'Datenauswirkungen', 'Datenwirkungen', 'Datenwirkung'] },
  { num: '9', field: 'uiImpact' as const, labels: ['UI Impact', 'UI-Auswirkungen', 'Benutzeroberflaechen-Auswirkungen', 'Oberflaechen-Auswirkungen'] },
  { num: '10', field: 'acceptanceCriteria' as const, labels: ['Acceptance Criteria', 'Akzeptanzkriterien', 'Abnahmekriterien'] },
];

function splitNumberedItems(text: string): string[] {
  const items: string[] = [];
  const lines = text.split('\n');
  let currentItem = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isNumbered = /^\d+[\.\)]\s+/.test(trimmed);
    const isChecklist = /^[-*+]\s+\[[ xX]\]\s+/.test(trimmed);
    const isBullet = /^[-*+]\s+/.test(trimmed);

    if (isNumbered || isChecklist || isBullet) {
      if (currentItem.trim()) {
        items.push(currentItem.trim());
      }
      currentItem = trimmed
        .replace(/^\d+[\.\)]\s+/, '')
        .replace(/^[-*+]\s+\[[ xX]\]\s+/, '')
        .replace(/^[-*+]\s+/, '');
    } else {
      currentItem += ' ' + trimmed;
    }
  }
  if (currentItem.trim()) {
    items.push(currentItem.trim());
  }

  return items;
}

export function parseFeatureSubsections(rawContent: string): Partial<Pick<FeatureSpec, 'purpose' | 'actors' | 'trigger' | 'preconditions' | 'mainFlow' | 'alternateFlows' | 'postconditions' | 'dataImpact' | 'uiImpact' | 'acceptanceCriteria'>> {
  const result: any = {};

  try {
    const subsectionBoundaries: { field: string; matchStart: number; contentStart: number; isArray: boolean }[] = [];

    for (const sub of SUBSECTION_ORDER) {
      const labelsPattern = sub.labels
        .map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
        .join('|');
      const pattern = new RegExp(
        `(?:^|\\n)\\s*` +
        `(?:#{1,6}\\s*)?` +
        `(?:\\*\\*)?` +
        `(?:${sub.num}\\s*[\\.)\\-:]\\s*)?` +
        `(?:${labelsPattern})` +
        `\\s*(?:\\*\\*)?\\s*[:\\-\\s]*(?:\\*\\*)?`,
        'i'
      );
      const match = pattern.exec(rawContent);
      if (match && match.index !== undefined) {
        const isArray = sub.field === 'mainFlow' || sub.field === 'alternateFlows' || sub.field === 'acceptanceCriteria';
        subsectionBoundaries.push({
          field: sub.field,
          matchStart: match.index,
          contentStart: match.index + match[0].length,
          isArray,
        });
      }
    }

    subsectionBoundaries.sort((a, b) => a.matchStart - b.matchStart);

    for (let i = 0; i < subsectionBoundaries.length; i++) {
      const boundary = subsectionBoundaries[i];
      const endIndex = i + 1 < subsectionBoundaries.length
        ? subsectionBoundaries[i + 1].matchStart
        : rawContent.length;

      const content = rawContent.substring(boundary.contentStart, endIndex).trim();
      if (!content) continue;

      if (boundary.isArray) {
        const items = splitNumberedItems(content);
        if (items.length > 0) {
          result[boundary.field] = items;
        }
      } else {
        result[boundary.field] = content;
      }
    }
  } catch (e) {
    console.error('[parseFeatureSubsections] Failed to parse feature subsections:', e);
  }

  return result;
}

function parseFeatureBlocks(body: string): { features: FeatureSpec[]; introText: string } {
  const features: FeatureSpec[] = [];
  const bodyWithNewline = '\n' + body;

  const splitPoints: { index: number; id: string; name: string }[] = [];
  const addSplitPoint = (index: number, id: string, name: string) => {
    const normalizedId = normalizeFeatureId(id);
    if (!normalizedId) return;
    splitPoints.push({
      index,
      id: normalizedId,
      name: (name || normalizedId).trim() || normalizedId,
    });
  };

  const inlinePattern = /(?:^|\n)(?:#{2,4}\s+)?(?:\*{0,2})(?:Feature\s+(?:ID:\s*)?|Feature\s+ID:\s*)(F-\d+)(?:\*{0,2})[: —–-]+(?!\n)(?:\*{0,2})([^\n]+?)(?:\*{0,2})(?:\n|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = inlinePattern.exec(bodyWithNewline)) !== null) {
    const name = match[2].trim().replace(/\*+/g, '').trim();
    if (name && !name.toLowerCase().startsWith('feature name')) {
      addSplitPoint(match.index, match[1], name);
    }
  }

  const twoLinePattern = /(?:^|\n)\s*(?:#{1,6}\s+)?(?:\*{0,2})Feature\s+ID(?:\*{0,2})?\s*:?\s*(?:\*{0,2})\s*(F-\d+)\b[^\n]*\n\s*(?:\*{0,2})Feature\s+Name(?:\*{0,2})?\s*:?\s*(?:\*{0,2})\s*(.+?)\s*(?:\n|$)/gi;
  let twoLineMatch: RegExpExecArray | null;
  while ((twoLineMatch = twoLinePattern.exec(bodyWithNewline)) !== null) {
    const rawName = twoLineMatch[2].trim().replace(/\*+/g, '').trim();
    addSplitPoint(twoLineMatch.index, twoLineMatch[1], rawName || twoLineMatch[1]);
  }

  const boldIdPattern = /(?:^|\n)\s*\*{2}Feature\s+ID\s*:?\s*(F-\d+)\*{2}\s*\n/gi;
  const featureNamePattern = /\*{0,2}Feature\s+Name:?\*{0,2}\s*(.+?)(?:\*{0,2})\s*$/im;

  let boldMatch: RegExpExecArray | null;
  while ((boldMatch = boldIdPattern.exec(bodyWithNewline)) !== null) {
    const featureId = normalizeFeatureId(boldMatch[1]);
    const afterIndex = boldMatch.index + boldMatch[0].length;
    const nextChunk = bodyWithNewline.substring(afterIndex, afterIndex + 200);
    const nameMatch = nextChunk.match(featureNamePattern);
    const rawName = nameMatch
      ? nameMatch[1].trim().replace(/\*+/g, '').trim()
      : featureId;
    const featureName = rawName.replace(/^Feature\s+Name:\s*/i, '').trim() || featureId;

    addSplitPoint(boldMatch.index, featureId, featureName);
  }

  // Common output format:
  // **Feature ID:** F-01
  // **Feature Name:** ...
  const featureIdLinePattern = /(?:^|\n)\s*(?:\*{0,2})Feature\s+ID(?:\*{0,2})?\s*:?\s*(?:\*{0,2})\s*(F-\d+)\b[^\n]*(?:\n|$)/gi;
  let featureIdLineMatch: RegExpExecArray | null;
  while ((featureIdLineMatch = featureIdLinePattern.exec(bodyWithNewline)) !== null) {
    const featureId = normalizeFeatureId(featureIdLineMatch[1]);
    const afterIndex = featureIdLineMatch.index + featureIdLineMatch[0].length;
    const preview = bodyWithNewline.substring(afterIndex, afterIndex + 320);
    const nameMatch = preview.match(/(?:^|\n)\s*(?:\*{0,2})Feature\s+Name(?:\*{0,2})?\s*:?\s*(?:\*{0,2})\s*(.+?)\s*(?:\n|$)/i);
    let featureName = nameMatch
      ? nameMatch[1].trim().replace(/\*+/g, '').trim()
      : featureId;
    if (!nameMatch) {
      // Fallback: detect nearby "Feature Specification: <Name>" heading.
      const prefix = bodyWithNewline.substring(Math.max(0, featureIdLineMatch.index - 220), featureIdLineMatch.index);
      const specHeadingMatch = prefix.match(/Feature\s+Specification\s*:\s*([^\n#]+)/i);
      if (specHeadingMatch) {
        featureName = specHeadingMatch[1].trim();
      }
    }
    addSplitPoint(featureIdLineMatch.index, featureId, featureName || featureId);
  }

  const headingPattern = /(?:^|\n)(#{2,4})\s+(?:\*{0,2})(?:Feature\s+)?(?:ID:\s*)?(F-\d+)(?:\*{0,2})[:\s—–-]*(?:\*{0,2})(.*?)(?:\*{0,2})\s*(?:\n|$)/gi;
  let headingMatch: RegExpExecArray | null;
  while ((headingMatch = headingPattern.exec(bodyWithNewline)) !== null) {
    addSplitPoint(
      headingMatch.index,
      headingMatch[2],
      headingMatch[3].trim().replace(/\*+/g, '').trim() || headingMatch[2]
    );
  }

  splitPoints.sort((a, b) => a.index - b.index);
  const uniqueSplitPoints: typeof splitPoints = [];
  const seenAt = new Set<string>();
  for (const point of splitPoints) {
    const key = `${point.index}:${point.id}`;
    if (seenAt.has(key)) continue;
    seenAt.add(key);
    uniqueSplitPoints.push(point);
  }

  const firstFeatureIndex = uniqueSplitPoints.length > 0 ? uniqueSplitPoints[0].index : bodyWithNewline.length;
  const introText = bodyWithNewline.substring(0, firstFeatureIndex).trim();

  for (let i = 0; i < uniqueSplitPoints.length; i++) {
    const start = uniqueSplitPoints[i].index;
    const end = i + 1 < uniqueSplitPoints.length ? uniqueSplitPoints[i + 1].index : bodyWithNewline.length;
    const rawContent = bodyWithNewline.substring(start, end).trim();

    features.push({
      id: uniqueSplitPoints[i].id,
      name: uniqueSplitPoints[i].name,
      rawContent,
      ...parseFeatureSubsections(rawContent),
    });
  }

  return { features, introText };
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
      h => normalizedHeading.includes(h)
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
      h => normalizedHeading.includes(h)
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
      const key = mappedKey[1];
      if (key !== 'features' && key !== 'otherSections') {
        const currentVal = (structure as any)[key];
        const currentLen = typeof currentVal === 'string' ? currentVal.trim().length : 0;
        const nextLen = typeof section.body === 'string' ? section.body.trim().length : 0;
        // Keep the richer section when duplicate headings/aliases appear.
        if (nextLen >= currentLen) {
          (structure as any)[key] = section.body;
        }
      }
    } else {
      const featureMatch = normalizedHeading.match(/^(?:feature\s+(?:id:\s*)?)?(?:feature\s+id:\s*)?(f-\d+)/);
      if (featureMatch) {
        const featureId = featureMatch[1].toUpperCase();
        const featureName = section.heading
          .replace(/^\d+[\.\)]\s*/, '')
          .replace(/^(?:Feature\s+)?F-\d+[:\s]*/i, '')
          .replace(/\*+/g, '')
          .trim();
        structure.features.push({
          id: normalizeFeatureId(featureId),
          name: featureName || featureId,
          rawContent: section.body,
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

const REQUIRED_SECTIONS: (keyof PRDStructure)[] = [
  'systemVision',
  'systemBoundaries',
  'domainModel',
  'globalBusinessRules',
  'nonFunctional',
  'errorHandling',
  'deployment',
  'definitionOfDone',
  'outOfScope',
  'timelineMilestones',
  'successCriteria',
];

const STRUCTURED_FIELDS: (keyof FeatureSpec)[] = [
  'purpose', 'actors', 'trigger', 'preconditions',
  'mainFlow', 'alternateFlows', 'postconditions',
  'dataImpact', 'uiImpact', 'acceptanceCriteria',
];

export function logStructureValidation(structure: PRDStructure): void {
  const detectedSections: string[] = [];
  const missingSections: string[] = [];

  for (const key of REQUIRED_SECTIONS) {
    if (structure[key]) {
      detectedSections.push(key);
    } else {
      missingSections.push(key);
    }
  }

  if (structure.features.length > 0 || structure.featureCatalogueIntro) {
    detectedSections.push('featureCatalogue');
  } else {
    missingSections.push('featureCatalogue');
  }

  const otherKeys = Object.keys(structure.otherSections);

  logger.info(`📊 PRD Structure Analysis:`);
  logger.info(`  Features found: ${structure.features.length}`);
  if (structure.features.length > 0) {
    let structuredCount = 0;
    for (const f of structure.features) {
      const parsedFields: string[] = [];
      const missingFields: string[] = [];
      for (const field of STRUCTURED_FIELDS) {
        const val = f[field];
        const hasValue = Array.isArray(val) ? val.length > 0 : typeof val === 'string' && val.trim().length > 0;
        if (hasValue) {
          parsedFields.push(field);
        } else {
          missingFields.push(field);
        }
      }
      const isStructured = parsedFields.length >= 3;
      if (isStructured) structuredCount++;
      logger.debug(`    - ${f.id}: ${f.name} (${f.rawContent.length} chars) [${parsedFields.length}/${STRUCTURED_FIELDS.length} fields]`);
      if (parsedFields.length > 0) {
        logger.debug(`      Parsed: ${parsedFields.join(', ')}`);
      }
      if (missingFields.length > 0 && parsedFields.length > 0) {
        logger.debug(`      Missing: ${missingFields.join(', ')}`);
      }
    }
    const pct = structure.features.length > 0
      ? Math.round((structuredCount / structure.features.length) * 100)
      : 0;
    logger.info(`  Structured features: ${structuredCount}/${structure.features.length} (${pct}%)`);
  }
  logger.info(`  Sections detected: ${detectedSections.join(', ')}`);
  if (missingSections.length > 0) {
    logger.warn(`  Missing sections: ${missingSections.join(', ')}`);
  }
  if (otherKeys.length > 0) {
    logger.info(`  Other sections: ${otherKeys.join(', ')}`);
  }
}
