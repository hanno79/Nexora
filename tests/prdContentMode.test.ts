import { describe, expect, it } from 'vitest';
import { hasMeaningfulPrdContent, isTemplateScaffoldContent } from '../client/src/lib/prdContentMode';

describe('prd content mode detection', () => {
  it('treats default template scaffold JSON as non-meaningful content', () => {
    const scaffold = JSON.stringify({
      sections: [
        { title: 'Executive Summary', content: 'High-level overview of the epic' },
        { title: 'Vision & Strategy', content: 'Long-term vision and strategic alignment' },
        { title: 'Scope', content: "What's included and what's not" },
        { title: 'Features', content: 'Breakdown of individual features' },
      ],
    });

    expect(isTemplateScaffoldContent(scaffold)).toBe(true);
    expect(hasMeaningfulPrdContent(scaffold)).toBe(false);
  });

  it('treats real PRD markdown as meaningful content', () => {
    const prd = [
      '## System Vision',
      'A browser-based Tetris webapp combines power-ups with roguelite meta progression.',
      '',
      '## Functional Feature Catalogue',
      '### F-01: Turbo Drop',
      '1. Purpose',
      'Increase falling speed for ten seconds.',
    ].join('\n');

    expect(isTemplateScaffoldContent(prd)).toBe(false);
    expect(hasMeaningfulPrdContent(prd)).toBe(true);
  });
});
