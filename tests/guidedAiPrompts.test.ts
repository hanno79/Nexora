import { describe, it, expect } from 'vitest';
import {
  FEATURE_ANALYSIS_PROMPT,
  USER_QUESTION_PROMPT,
  FEATURE_REFINEMENT_PROMPT,
  GENERATE_FOLLOWUP_QUESTIONS_PROMPT,
  FINAL_PRD_GENERATION_PROMPT,
  FINAL_PRD_REFINEMENT_PROMPT,
} from '../server/guidedAiPrompts';
import { CANONICAL_PRD_HEADINGS } from '../server/prdCompiler';

describe('early-stage prompts (non-structural)', () => {
  it('FEATURE_ANALYSIS_PROMPT is non-empty and >100 chars', () => {
    expect(FEATURE_ANALYSIS_PROMPT.trim().length).toBeGreaterThan(100);
  });

  it('USER_QUESTION_PROMPT is non-empty, >100 chars, and references question format', () => {
    expect(USER_QUESTION_PROMPT.trim().length).toBeGreaterThan(100);
    expect(USER_QUESTION_PROMPT).toMatch(/question/i);
  });

  it('FEATURE_REFINEMENT_PROMPT is non-empty and >100 chars', () => {
    expect(FEATURE_REFINEMENT_PROMPT.trim().length).toBeGreaterThan(100);
  });

  it('GENERATE_FOLLOWUP_QUESTIONS_PROMPT is non-empty and >100 chars', () => {
    expect(GENERATE_FOLLOWUP_QUESTIONS_PROMPT.trim().length).toBeGreaterThan(100);
  });
});

describe('FINAL_PRD_GENERATION_PROMPT', () => {
  it('references canonical headings (System Vision, Functional Feature Catalogue)', () => {
    expect(FINAL_PRD_GENERATION_PROMPT).toContain('System Vision');
    expect(FINAL_PRD_GENERATION_PROMPT).toContain('Functional Feature Catalogue');
  });

  it('references 10-field feature spec (Purpose, Acceptance Criteria)', () => {
    expect(FINAL_PRD_GENERATION_PROMPT).toContain('Purpose');
    expect(FINAL_PRD_GENERATION_PROMPT).toContain('Acceptance Criteria');
  });

  it('has minimum length (>500 chars)', () => {
    expect(FINAL_PRD_GENERATION_PROMPT.length).toBeGreaterThan(500);
  });

  it('does not contain TODO/placeholder text', () => {
    expect(FINAL_PRD_GENERATION_PROMPT).not.toMatch(/\bTODO\b/);
    expect(FINAL_PRD_GENERATION_PROMPT).not.toMatch(/\bFIXME\b/);
    expect(FINAL_PRD_GENERATION_PROMPT).not.toMatch(/\bPLACEHOLDER\b/);
  });
});

describe('FINAL_PRD_REFINEMENT_PROMPT', () => {
  it('references canonical headings', () => {
    const matchCount = CANONICAL_PRD_HEADINGS.filter(h =>
      FINAL_PRD_REFINEMENT_PROMPT.includes(h)
    ).length;
    expect(matchCount).toBeGreaterThanOrEqual(2);
  });

  it('contains preservation rules', () => {
    const text = FINAL_PRD_REFINEMENT_PROMPT.toLowerCase();
    const hasPreserve = text.includes('preserve');
    const hasKeep = text.includes('keep');
    const hasExisting = text.includes('existing');
    expect(hasPreserve || hasKeep || hasExisting).toBe(true);
  });

  it('has minimum length (>300 chars)', () => {
    expect(FINAL_PRD_REFINEMENT_PROMPT.length).toBeGreaterThan(300);
  });
});
