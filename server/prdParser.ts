import type { PRDStructure, FeatureSpec } from './prdStructure';

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

interface RawSection {
  heading: string;
  level: number;
  body: string;
}

function splitIntoSections(markdown: string): RawSection[] {
  const sections: RawSection[] = [];
  const lines = markdown.split('\n');

  let currentHeading = '';
  let currentLevel = 0;
  let currentBody: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);

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
  { num: '1', field: 'purpose' as const, label: 'Purpose' },
  { num: '2', field: 'actors' as const, label: 'Actors' },
  { num: '3', field: 'trigger' as const, label: 'Trigger' },
  { num: '4', field: 'preconditions' as const, label: 'Preconditions' },
  { num: '5', field: 'mainFlow' as const, label: 'Main Flow' },
  { num: '6', field: 'alternateFlows' as const, label: 'Alternate Flows' },
  { num: '7', field: 'postconditions' as const, label: 'Postconditions' },
  { num: '8', field: 'dataImpact' as const, label: 'Data Impact' },
  { num: '9', field: 'uiImpact' as const, label: 'UI Impact' },
  { num: '10', field: 'acceptanceCriteria' as const, label: 'Acceptance Criteria' },
];

function splitNumberedItems(text: string): string[] {
  const items: string[] = [];
  const lines = text.split('\n');
  let currentItem = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isNumbered = /^\d+[\.\)]\s+/.test(trimmed);
    const isBullet = /^[-*]\s+/.test(trimmed);

    if (isNumbered || isBullet) {
      if (currentItem.trim()) {
        items.push(currentItem.trim());
      }
      currentItem = trimmed.replace(/^\d+[\.\)]\s+/, '').replace(/^[-*]\s+/, '');
    } else {
      currentItem += ' ' + trimmed;
    }
  }
  if (currentItem.trim()) {
    items.push(currentItem.trim());
  }

  return items;
}

function parseFeatureSubsections(rawContent: string): Partial<Pick<FeatureSpec, 'purpose' | 'actors' | 'trigger' | 'preconditions' | 'mainFlow' | 'alternateFlows' | 'postconditions' | 'dataImpact' | 'uiImpact' | 'acceptanceCriteria'>> {
  const result: any = {};

  try {
    const subsectionBoundaries: { field: string; matchStart: number; contentStart: number; isArray: boolean }[] = [];

    for (const sub of SUBSECTION_ORDER) {
      const pattern = new RegExp(`(?:^|\\n)\\s*(?:\\*\\*)?${sub.num}\\.\\s*(?:\\*\\*)?\\s*${sub.label}\\s*[:\\s]*(?:\\*\\*)?`, 'i');
      const match = rawContent.match(pattern);
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
  }

  return result;
}

function parseFeatureBlocks(body: string): { features: FeatureSpec[]; introText: string } {
  const features: FeatureSpec[] = [];
  const bodyWithNewline = '\n' + body;

  const splitPoints: { index: number; id: string; name: string }[] = [];

  const inlinePattern = /(?:^|\n)(?:#{2,4}\s+)?(?:\*{0,2})(?:Feature\s+(?:ID:\s*)?|Feature\s+ID:\s*)(F-\d+)(?:\*{0,2})[: —–-]+(?!\n)(?:\*{0,2})([^\n]+?)(?:\*{0,2})(?:\n|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = inlinePattern.exec(bodyWithNewline)) !== null) {
    const name = match[2].trim().replace(/\*+/g, '').trim();
    if (name && !name.toLowerCase().startsWith('feature name')) {
      splitPoints.push({
        index: match.index,
        id: match[1].toUpperCase(),
        name,
      });
    }
  }

  if (splitPoints.length === 0) {
    const twoLinePattern = /(?:^|\n)\s*(?:#{1,6}\s+)?(?:\*{0,2})Feature\s+ID:\s*(F-\d+)(?:\*{0,2})\s*\n\s*\*{0,2}Feature\s+Name:?\*{0,2}\s*(.+?)(?:\*{0,2})\s*(?:\n|$)/gi;
    let twoLineMatch: RegExpExecArray | null;
    while ((twoLineMatch = twoLinePattern.exec(bodyWithNewline)) !== null) {
      const rawName = twoLineMatch[2].trim().replace(/\*+/g, '').trim();
      splitPoints.push({
        index: twoLineMatch.index,
        id: twoLineMatch[1].toUpperCase(),
        name: rawName || twoLineMatch[1].toUpperCase(),
      });
    }
  }

  if (splitPoints.length === 0) {
    const boldIdPattern = /(?:^|\n)\s*\*{2}Feature\s+ID:\s*(F-\d+)\*{2}\s*\n/gi;
    const featureNamePattern = /\*{0,2}Feature\s+Name:?\*{0,2}\s*(.+?)(?:\*{0,2})\s*$/im;

    let boldMatch: RegExpExecArray | null;
    while ((boldMatch = boldIdPattern.exec(bodyWithNewline)) !== null) {
      const featureId = boldMatch[1].toUpperCase();
      const afterIndex = boldMatch.index + boldMatch[0].length;
      const nextChunk = bodyWithNewline.substring(afterIndex, afterIndex + 200);
      const nameMatch = nextChunk.match(featureNamePattern);
      const rawName = nameMatch
        ? nameMatch[1].trim().replace(/\*+/g, '').trim()
        : featureId;
      const featureName = rawName.replace(/^Feature\s+Name:\s*/i, '').trim() || featureId;

      splitPoints.push({
        index: boldMatch.index,
        id: featureId,
        name: featureName,
      });
    }
  }

  if (splitPoints.length === 0) {
    const headingPattern = /(?:^|\n)(#{2,4})\s+(?:\*{0,2})(?:Feature\s+)?(?:ID:\s*)?(F-\d+)(?:\*{0,2})[:\s—–-]*(?:\*{0,2})(.*?)(?:\*{0,2})\s*(?:\n|$)/gi;
    let headingMatch: RegExpExecArray | null;
    while ((headingMatch = headingPattern.exec(bodyWithNewline)) !== null) {
      splitPoints.push({
        index: headingMatch.index,
        id: headingMatch[2].toUpperCase(),
        name: headingMatch[3].trim().replace(/\*+/g, '').trim() || headingMatch[2].toUpperCase(),
      });
    }
  }

  const firstFeatureIndex = splitPoints.length > 0 ? splitPoints[0].index : bodyWithNewline.length;
  const introText = bodyWithNewline.substring(0, firstFeatureIndex).trim();

  for (let i = 0; i < splitPoints.length; i++) {
    const start = splitPoints[i].index;
    const end = i + 1 < splitPoints.length ? splitPoints[i + 1].index : bodyWithNewline.length;
    const rawContent = bodyWithNewline.substring(start, end).trim();

    features.push({
      id: splitPoints[i].id,
      name: splitPoints[i].name,
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

    const isFeatureCatalogue = FEATURE_CATALOGUE_HEADINGS.some(
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

    const mappedKey = Object.entries(KNOWN_SECTION_MAP).find(
      ([pattern]) => normalizedHeading.includes(pattern)
    );

    if (mappedKey) {
      const key = mappedKey[1];
      if (key !== 'features' && key !== 'otherSections') {
        (structure as any)[key] = section.body;
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
          id: featureId,
          name: featureName || featureId,
          rawContent: section.body,
          ...parseFeatureSubsections(section.body),
        });
      } else {
        structure.otherSections[section.heading] = section.body;
      }
    }
  }

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

  console.log(`📊 PRD Structure Analysis:`);
  console.log(`  Features found: ${structure.features.length}`);
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
      console.log(`    - ${f.id}: ${f.name} (${f.rawContent.length} chars) [${parsedFields.length}/${STRUCTURED_FIELDS.length} fields]`);
      if (parsedFields.length > 0) {
        console.log(`      Parsed: ${parsedFields.join(', ')}`);
      }
      if (missingFields.length > 0 && parsedFields.length > 0) {
        console.log(`      Missing: ${missingFields.join(', ')}`);
      }
    }
    const pct = structure.features.length > 0
      ? Math.round((structuredCount / structure.features.length) * 100)
      : 0;
    console.log(`  Structured features: ${structuredCount}/${structure.features.length} (${pct}%)`);
  }
  console.log(`  Sections detected: ${detectedSections.join(', ')}`);
  if (missingSections.length > 0) {
    console.log(`  Missing sections: ${missingSections.join(', ')}`);
  }
  if (otherKeys.length > 0) {
    console.log(`  Other sections: ${otherKeys.join(', ')}`);
  }
}
