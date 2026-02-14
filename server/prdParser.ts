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
    for (const f of structure.features) {
      console.log(`    - ${f.id}: ${f.name} (${f.rawContent.length} chars)`);
    }
  }
  console.log(`  Sections detected: ${detectedSections.join(', ')}`);
  if (missingSections.length > 0) {
    console.log(`  Missing sections: ${missingSections.join(', ')}`);
  }
  if (otherKeys.length > 0) {
    console.log(`  Other sections: ${otherKeys.join(', ')}`);
  }
}
