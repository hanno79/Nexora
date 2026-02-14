import type { PRDStructure } from './prdStructure';

interface SectionEntry {
  heading: string;
  key: keyof PRDStructure;
}

const CANONICAL_ORDER: SectionEntry[] = [
  { heading: 'System Vision', key: 'systemVision' },
  { heading: 'System Boundaries', key: 'systemBoundaries' },
  { heading: 'Domain Model', key: 'domainModel' },
  { heading: 'Global Business Rules', key: 'globalBusinessRules' },
];

const POST_FEATURE_SECTIONS: SectionEntry[] = [
  { heading: 'Non-Functional Requirements', key: 'nonFunctional' },
  { heading: 'Error Handling & Recovery', key: 'errorHandling' },
  { heading: 'Deployment & Infrastructure', key: 'deployment' },
  { heading: 'Definition of Done', key: 'definitionOfDone' },
];

export function assembleStructureToMarkdown(structure: PRDStructure): string {
  const parts: string[] = [];

  for (const entry of CANONICAL_ORDER) {
    const content = structure[entry.key];
    if (typeof content === 'string' && content.trim()) {
      parts.push(`## ${entry.heading}\n\n${content.trim()}`);
    }
  }

  if (structure.features.length > 0 || structure.featureCatalogueIntro) {
    const featureLines: string[] = [];
    featureLines.push('## Functional Feature Catalogue');
    featureLines.push('');

    if (structure.featureCatalogueIntro) {
      featureLines.push(structure.featureCatalogueIntro.trim());
      featureLines.push('');
    }

    for (const feature of structure.features) {
      featureLines.push(feature.rawContent);
      featureLines.push('');
    }

    parts.push(featureLines.join('\n').trim());
  }

  for (const entry of POST_FEATURE_SECTIONS) {
    const content = structure[entry.key];
    if (typeof content === 'string' && content.trim()) {
      parts.push(`## ${entry.heading}\n\n${content.trim()}`);
    }
  }

  for (const [heading, content] of Object.entries(structure.otherSections)) {
    if (content.trim()) {
      parts.push(`## ${heading}\n\n${content.trim()}`);
    }
  }

  return parts.join('\n\n') + '\n';
}
