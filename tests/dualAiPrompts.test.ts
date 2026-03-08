import { describe, expect, it } from 'vitest';
import {
  getLanguageInstruction,
  GENERATOR_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT,
  IMPROVEMENT_SYSTEM_PROMPT,
  ITERATIVE_GENERATOR_PROMPT,
  ITERATIVE_IMPROVE_GENERATOR_PROMPT,
  BEST_PRACTICE_ANSWERER_PROMPT,
  FINAL_REVIEWER_PROMPT,
  FEATURE_SPEC_TEMPLATE,
  FIXED_ENGLISH_HEADINGS,
} from '../server/dualAiPrompts';
import { CANONICAL_PRD_HEADINGS } from '../server/prdCompiler';

describe('getLanguageInstruction', () => {
  it('keeps canonical heading labels fixed for german content', () => {
    const instruction = getLanguageInstruction('de');
    expect(instruction).toContain('NICHT uebersetzt werden');
    expect(instruction).toContain('System Vision');
    expect(instruction).toContain('auf DEUTSCH');
  });

  it('keeps canonical heading labels fixed for english content', () => {
    const instruction = getLanguageInstruction('en');
    expect(instruction).toContain('MUST remain exactly as written');
    expect(instruction).toContain('System Vision');
    expect(instruction).toContain('in ENGLISH');
  });
});

describe('FIXED_ENGLISH_HEADINGS', () => {
  const expectedHeadings = [
    'System Vision',
    'System Boundaries',
    'Domain Model',
    'Global Business Rules',
    'Functional Feature Catalogue',
    'Non-Functional Requirements',
    'Error Handling & Recovery',
    'Deployment & Infrastructure',
    'Definition of Done',
    'Out of Scope',
    'Timeline & Milestones',
    'Success Criteria & Acceptance Testing',
  ];

  it('contains all 12 canonical headings', () => {
    for (const heading of expectedHeadings) {
      expect(FIXED_ENGLISH_HEADINGS).toContain(heading);
    }
  });

  it('matches CANONICAL_PRD_HEADINGS from prdCompiler.ts', () => {
    for (const heading of CANONICAL_PRD_HEADINGS) {
      expect(FIXED_ENGLISH_HEADINGS).toContain(heading);
    }
  });
});

describe('FEATURE_SPEC_TEMPLATE', () => {
  const specFields = [
    'Purpose',
    'Actors',
    'Trigger',
    'Preconditions',
    'Main Flow',
    'Alternate Flows',
    'Postconditions',
    'Data Impact',
    'UI Impact',
    'Acceptance Criteria',
  ];

  it('contains all 10 feature spec fields', () => {
    for (const field of specFields) {
      expect(FEATURE_SPEC_TEMPLATE).toContain(field);
    }
  });

  it('is non-empty', () => {
    expect(FEATURE_SPEC_TEMPLATE.trim().length).toBeGreaterThan(0);
  });
});

describe('GENERATOR_SYSTEM_PROMPT', () => {
  it('references canonical headings', () => {
    expect(GENERATOR_SYSTEM_PROMPT).toContain('System Vision');
    expect(GENERATOR_SYSTEM_PROMPT).toContain('Functional Feature Catalogue');
  });

  it('references 10-field feature spec', () => {
    expect(GENERATOR_SYSTEM_PROMPT).toContain('Purpose');
    expect(GENERATOR_SYSTEM_PROMPT).toContain('Acceptance Criteria');
    expect(GENERATOR_SYSTEM_PROMPT).toContain('Main Flow');
    expect(GENERATOR_SYSTEM_PROMPT).toContain('Actors');
  });

  it('has minimum length (>500 chars)', () => {
    expect(GENERATOR_SYSTEM_PROMPT.length).toBeGreaterThan(500);
  });

  it('does not contain TODO/placeholder text', () => {
    expect(GENERATOR_SYSTEM_PROMPT).not.toMatch(/\bTODO\b/);
    expect(GENERATOR_SYSTEM_PROMPT).not.toMatch(/\bFIXME\b/);
    expect(GENERATOR_SYSTEM_PROMPT).not.toMatch(/\bPLACEHOLDER\b/);
  });
});

describe('REVIEWER_SYSTEM_PROMPT', () => {
  it('references canonical headings', () => {
    expect(REVIEWER_SYSTEM_PROMPT).toContain('System Vision');
    expect(REVIEWER_SYSTEM_PROMPT).toContain('Functional Feature Catalogue');
  });

  it('has minimum length (>500 chars)', () => {
    expect(REVIEWER_SYSTEM_PROMPT.length).toBeGreaterThan(500);
  });

  it('does not contain TODO/placeholder text', () => {
    expect(REVIEWER_SYSTEM_PROMPT).not.toMatch(/\bTODO\b/);
    expect(REVIEWER_SYSTEM_PROMPT).not.toMatch(/\bFIXME\b/);
    expect(REVIEWER_SYSTEM_PROMPT).not.toMatch(/\bPLACEHOLDER\b/);
  });
});

describe('IMPROVEMENT_SYSTEM_PROMPT', () => {
  it('references canonical headings', () => {
    expect(IMPROVEMENT_SYSTEM_PROMPT).toContain('System Vision');
    expect(IMPROVEMENT_SYSTEM_PROMPT).toContain('Functional Feature Catalogue');
  });

  it('contains content preservation rules', () => {
    const text = IMPROVEMENT_SYSTEM_PROMPT.toUpperCase();
    const hasPreserve = text.includes('PRESERVE');
    const hasKeep = text.includes('KEEP');
    const hasIntact = text.includes('INTACT');
    expect(hasPreserve || hasKeep || hasIntact).toBe(true);
  });

  it('has minimum length (>500 chars)', () => {
    expect(IMPROVEMENT_SYSTEM_PROMPT.length).toBeGreaterThan(500);
  });
});

describe('ITERATIVE_GENERATOR_PROMPT', () => {
  it('references canonical headings', () => {
    expect(ITERATIVE_GENERATOR_PROMPT).toContain('System Vision');
    expect(ITERATIVE_GENERATOR_PROMPT).toContain('Functional Feature Catalogue');
  });

  it('embeds FEATURE_SPEC_TEMPLATE or references the 10-field structure', () => {
    const hasTemplate = ITERATIVE_GENERATOR_PROMPT.includes('Purpose') &&
      ITERATIVE_GENERATOR_PROMPT.includes('Acceptance Criteria');
    expect(hasTemplate).toBe(true);
  });

  it('has minimum length (>500 chars)', () => {
    expect(ITERATIVE_GENERATOR_PROMPT.length).toBeGreaterThan(500);
  });
});

describe('ITERATIVE_IMPROVE_GENERATOR_PROMPT', () => {
  it('forbids new features in improve mode', () => {
    expect(ITERATIVE_IMPROVE_GENERATOR_PROMPT).toContain('MUST NOT invent new F-XX features');
    expect(ITERATIVE_IMPROVE_GENERATOR_PROMPT).toContain('"addedFeatures" MUST always be an empty array');
  });

  it('anchors improve mode to baseline scope', () => {
    expect(ITERATIVE_IMPROVE_GENERATOR_PROMPT).toContain('System Vision');
    expect(ITERATIVE_IMPROVE_GENERATOR_PROMPT).toContain('Out of Scope');
    expect(ITERATIVE_IMPROVE_GENERATOR_PROMPT).toContain('baseline feature catalogue');
  });
});

describe('BEST_PRACTICE_ANSWERER_PROMPT', () => {
  it('has minimum length (>200 chars)', () => {
    expect(BEST_PRACTICE_ANSWERER_PROMPT.length).toBeGreaterThan(200);
  });

  it('does not contain TODO/placeholder text', () => {
    expect(BEST_PRACTICE_ANSWERER_PROMPT).not.toMatch(/\bTODO\b/);
    expect(BEST_PRACTICE_ANSWERER_PROMPT).not.toMatch(/\bFIXME\b/);
    expect(BEST_PRACTICE_ANSWERER_PROMPT).not.toMatch(/\bPLACEHOLDER\b/);
  });
});

describe('FINAL_REVIEWER_PROMPT', () => {
  it('references canonical headings or quality validation', () => {
    const hasHeadings = FINAL_REVIEWER_PROMPT.includes('System Vision') ||
      FINAL_REVIEWER_PROMPT.includes('Functional Feature Catalogue');
    const hasQuality = FINAL_REVIEWER_PROMPT.includes('COMPLETENESS') ||
      FINAL_REVIEWER_PROMPT.includes('quality');
    expect(hasHeadings || hasQuality).toBe(true);
  });

  it('has minimum length (>500 chars)', () => {
    expect(FINAL_REVIEWER_PROMPT.length).toBeGreaterThan(500);
  });
});
