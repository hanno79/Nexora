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
      const pattern = new RegExp(`(?:^|\\n)\\s*(?:\\*\\*)?${sub.num}\\.\\s*${sub.label}[:\\s]*(?:\\*\\*)?`, 'i');
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
  const featurePattern = /(?:^|\n)(?:#{2,4}\s+)?(?:Feature\s+(?:ID:\s*)?|Feature\s+ID:\s*)(F-\d+)[:\s]+(.+?)(?:\n|$)/gi;
  const bodyWithNewline = '\n' + body;

  const splitPoints: { index: number; id: string; name: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = featurePattern.exec(bodyWithNewline)) !== null) {
    splitPoints.push({
      index: match.index,
      id: match[1].toUpperCase(),
      name: match[2].trim().replace(/\*+/g, '').trim(),
    });
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

  // [DEBUG] Step 2 — Log feature header matching
  const featureHeaderMatches = markdown.match(/Feature\s+ID:/gi);
  console.log(`\n🔬 [parsePRDToStructure] Feature ID header matches: ${featureHeaderMatches?.length || 0}`);
  const debugMatches = markdown.match(/Feature\s+ID:[^\n]{0,100}/gi);
  if (debugMatches) {
    console.log(`🔬 [parsePRDToStructure] Feature Header Samples:`, debugMatches.slice(0, 5));
  }
  const altFeatureMatches = markdown.match(/(?:^|\n)#{2,4}\s+(?:Feature\s+)?F-\d+/gim);
  console.log(`🔬 [parsePRDToStructure] Alt feature heading matches (## F-XX): ${altFeatureMatches?.length || 0}`);
  if (altFeatureMatches) {
    console.log(`🔬 [parsePRDToStructure] Alt Feature Samples:`, altFeatureMatches.slice(0, 5).map(s => s.trim()));
  }

  const sections = splitIntoSections(markdown);

  // [DEBUG] Step 3 — Log section split results
  const detectedSectionTitles = sections.map(s => `[L${s.level}] ${s.heading || '(no heading)'}`);
  console.log(`🔬 [parsePRDToStructure] Top-level sections detected (${sections.length}):`, detectedSectionTitles);

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
      console.log(`🔬 [parsePRDToStructure] Feature catalogue section found: "${section.heading}" (body: ${section.body.length} chars)`);
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

  // [DEBUG] Step 4 — Log structure output
  console.log(`\n🔬 [parsePRDToStructure] Parsed Feature Count: ${structure.features.length}`);
  console.log(`🔬 [parsePRDToStructure] Feature IDs Parsed:`, structure.features.map(f => f.id));
  if (structure.features.length > 0) {
    console.log(`🔬 [parsePRDToStructure] Feature names:`, structure.features.map(f => `${f.id}: ${f.name}`));
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
