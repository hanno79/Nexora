import { describe, expect, it } from 'vitest';
import { getLanguageInstruction } from '../server/dualAiPrompts';

describe('getLanguageInstruction', () => {
  it('keeps canonical heading labels fixed for german content', () => {
    const instruction = getLanguageInstruction('de');
    expect(instruction).toContain('nicht uebersetzen');
    expect(instruction).toContain('Template-Headinglabels');
  });

  it('keeps canonical heading labels fixed for english content', () => {
    const instruction = getLanguageInstruction('en');
    expect(instruction).toContain('do not translate fixed template heading labels');
  });
});
