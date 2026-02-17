import type { PRDStructure, FeatureSpec } from './prdStructure';

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

const STRUCTURED_SUBSECTIONS: { field: keyof FeatureSpec; label: string; num: string; isArray: boolean }[] = [
  { field: 'purpose', label: 'Purpose', num: '1', isArray: false },
  { field: 'actors', label: 'Actors', num: '2', isArray: false },
  { field: 'trigger', label: 'Trigger', num: '3', isArray: false },
  { field: 'preconditions', label: 'Preconditions', num: '4', isArray: false },
  { field: 'mainFlow', label: 'Main Flow', num: '5', isArray: true },
  { field: 'alternateFlows', label: 'Alternate Flows', num: '6', isArray: true },
  { field: 'postconditions', label: 'Postconditions', num: '7', isArray: false },
  { field: 'dataImpact', label: 'Data Impact', num: '8', isArray: false },
  { field: 'uiImpact', label: 'UI Impact', num: '9', isArray: false },
  { field: 'acceptanceCriteria', label: 'Acceptance Criteria', num: '10', isArray: true },
];

function hasStructuredFields(feature: FeatureSpec): boolean {
  return STRUCTURED_SUBSECTIONS.some(sub => {
    const val = feature[sub.field];
    if (sub.isArray) {
      return Array.isArray(val) && val.length > 0;
    }
    return typeof val === 'string' && val.trim().length > 0;
  });
}

function renderFeatureFromStructure(feature: FeatureSpec): string {
  const lines: string[] = [];

  lines.push(`### ${feature.id}: ${feature.name}`);
  lines.push('');

  for (const sub of STRUCTURED_SUBSECTIONS) {
    const val = feature[sub.field];

    if (sub.isArray) {
      const arr = val as string[] | undefined;
      if (arr && arr.length > 0) {
        lines.push(`**${sub.num}. ${sub.label}**`);
        lines.push('');
        for (let i = 0; i < arr.length; i++) {
          lines.push(`${i + 1}. ${arr[i]}`);
        }
        lines.push('');
      }
    } else {
      const str = val as string | undefined;
      if (str && str.trim()) {
        lines.push(`**${sub.num}. ${sub.label}**`);
        lines.push('');
        lines.push(str.trim());
        lines.push('');
      }
    }
  }

  return lines.join('\n').trim();
}

function stripFeaturePreamble(raw: string): string {
  const lines = raw.split('\n');
  const out: string[] = [];
  let skipping = true;

  for (const line of lines) {
    const trimmed = line.trim();
    if (skipping) {
      const isPreamble =
        /^#{1,6}\s*feature\s+specification\b/i.test(trimmed) ||
        /^#{1,6}\s*f-\d{2,}\b/i.test(trimmed) ||
        /^\*{0,2}feature\s+id\*{0,2}\s*:/i.test(trimmed) ||
        /^\*{0,2}feature\s+name\*{0,2}\s*:/i.test(trimmed) ||
        /^feature\s+id\s*:/i.test(trimmed) ||
        /^feature\s+name\s*:/i.test(trimmed) ||
        /^[-=]{3,}$/.test(trimmed);
      if (isPreamble || !trimmed) {
        continue;
      }
      skipping = false;
    }
    out.push(line);
  }

  return out.join('\n').trim();
}

function renderFeatureRawCanonical(feature: FeatureSpec): string {
  const lines: string[] = [];
  lines.push(`### ${feature.id}: ${feature.name}`);
  lines.push('');
  const cleaned = stripFeaturePreamble(feature.rawContent || '');
  lines.push(cleaned || 'No additional details provided.');
  return lines.join('\n').trim();
}

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
      if (hasStructuredFields(feature)) {
        featureLines.push(renderFeatureFromStructure(feature));
      } else {
        featureLines.push(renderFeatureRawCanonical(feature));
      }
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
