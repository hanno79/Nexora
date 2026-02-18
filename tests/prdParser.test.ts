import { describe, it, expect } from 'vitest';
import {
  normalizeFeatureId,
  dedupeFeatures,
  normalizeBrokenHeadingBoundaries,
  splitIntoSections,
  parsePRDToStructure,
} from '../server/prdParser';
import type { FeatureSpec } from '../server/prdStructure';

describe('normalizeFeatureId', () => {
  it('normalizes "F-1" to "F-01"', () => {
    expect(normalizeFeatureId('F-1')).toBe('F-01');
  });

  it('normalizes "f-12" to "F-12"', () => {
    expect(normalizeFeatureId('f-12')).toBe('F-12');
  });

  it('normalizes "F-02: Something" to "F-02"', () => {
    expect(normalizeFeatureId('F-02: Something')).toBe('F-02');
  });

  it('returns empty string for invalid input', () => {
    expect(normalizeFeatureId('')).toBe('');
    expect(normalizeFeatureId('invalid')).toBe('');
    expect(normalizeFeatureId('Feature 1')).toBe('');
  });

  it('handles null/undefined gracefully', () => {
    expect(normalizeFeatureId(null as any)).toBe('');
    expect(normalizeFeatureId(undefined as any)).toBe('');
  });

  it('pads single digit IDs', () => {
    expect(normalizeFeatureId('F-3')).toBe('F-03');
    expect(normalizeFeatureId('F-9')).toBe('F-09');
  });

  it('keeps multi-digit IDs unchanged', () => {
    expect(normalizeFeatureId('F-10')).toBe('F-10');
    expect(normalizeFeatureId('F-123')).toBe('F-123');
  });
});

describe('dedupeFeatures', () => {
  function feat(id: string, rawContent: string): FeatureSpec {
    return { id, name: `Feature ${id}`, rawContent };
  }

  it('removes duplicate IDs keeping richer content', () => {
    const features = [
      feat('F-1', 'short'),
      feat('F-1', 'much longer content here'),
    ];
    const result = dedupeFeatures(features);
    expect(result).toHaveLength(1);
    expect(result[0].rawContent).toBe('much longer content here');
  });

  it('skips features with invalid IDs', () => {
    const features = [
      feat('F-1', 'valid'),
      feat('invalid', 'skip me'),
    ];
    const result = dedupeFeatures(features);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('F-01');
  });

  it('sorts features by ID', () => {
    const features = [
      feat('F-3', 'third'),
      feat('F-1', 'first'),
      feat('F-2', 'second'),
    ];
    const result = dedupeFeatures(features);
    expect(result.map(f => f.id)).toEqual(['F-01', 'F-02', 'F-03']);
  });

  it('returns empty array for empty input', () => {
    expect(dedupeFeatures([])).toEqual([]);
  });
});

describe('normalizeBrokenHeadingBoundaries', () => {
  it('splits inline headings onto new lines', () => {
    const input = 'Some text here ## Section Title';
    const result = normalizeBrokenHeadingBoundaries(input);
    expect(result).toContain('\n\n## Section Title');
  });

  it('leaves proper headings unchanged', () => {
    const input = 'Some text\n\n## Section Title\n\nContent';
    const result = normalizeBrokenHeadingBoundaries(input);
    expect(result).toBe(input);
  });
});

describe('splitIntoSections', () => {
  it('splits markdown into sections by headings', () => {
    const markdown = '## Vision\nContent A\n\n## Scope\nContent B';
    const sections = splitIntoSections(markdown);
    expect(sections.length).toBeGreaterThanOrEqual(2);
    expect(sections.some(s => s.heading.toLowerCase().includes('vision'))).toBe(true);
    expect(sections.some(s => s.heading.toLowerCase().includes('scope'))).toBe(true);
  });

  it('handles single-section document', () => {
    const markdown = '## Only Section\nSome content here';
    const sections = splitIntoSections(markdown);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toContain('Only Section');
  });

  it('returns minimal result for empty input', () => {
    const sections = splitIntoSections('');
    // Empty input may produce a single empty section
    expect(sections.length).toBeLessThanOrEqual(1);
  });
});

describe('parsePRDToStructure', () => {
  it('parses a minimal PRD with sections', () => {
    const markdown = [
      '## System Vision',
      'Build an amazing product.',
      '',
      '## System Boundaries',
      'Web application only.',
      '',
      '## Feature Catalogue',
      '',
      '### F-01: Login',
      'Allow users to log in.',
      '',
      '### F-02: Dashboard',
      'Show user overview.',
    ].join('\n');

    const result = parsePRDToStructure(markdown);
    expect(result.systemVision).toContain('amazing product');
    expect(result.systemBoundaries).toContain('Web application');
    expect(result.features.length).toBeGreaterThanOrEqual(1);
  });

  it('handles empty markdown', () => {
    const result = parsePRDToStructure('');
    expect(result.features).toEqual([]);
  });
});
