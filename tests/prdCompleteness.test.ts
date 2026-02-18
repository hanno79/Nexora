import { describe, it, expect } from 'vitest';
import { hasValue, computeFeatureCompleteness, computeCompleteness } from '../server/prdCompleteness';
import type { FeatureSpec, PRDStructure } from '../server/prdStructure';

describe('hasValue', () => {
  it('returns false for empty string', () => {
    expect(hasValue('')).toBe(false);
  });

  it('returns false for whitespace-only string', () => {
    expect(hasValue('   ')).toBe(false);
  });

  it('returns true for non-empty string', () => {
    expect(hasValue('hello')).toBe(true);
  });

  it('returns false for empty array', () => {
    expect(hasValue([])).toBe(false);
  });

  it('returns true for non-empty array', () => {
    expect(hasValue(['item'])).toBe(true);
  });

  it('returns false for null', () => {
    expect(hasValue(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(hasValue(undefined)).toBe(false);
  });

  it('returns false for number (not string or array)', () => {
    expect(hasValue(42)).toBe(false);
  });
});

function makeFeature(overrides: Partial<FeatureSpec> = {}): FeatureSpec {
  return {
    id: 'F-01',
    name: 'Test Feature',
    rawContent: 'raw',
    ...overrides,
  };
}

function makeFullFeature(): FeatureSpec {
  return makeFeature({
    purpose: 'Test purpose',
    actors: 'User',
    trigger: 'Button click',
    preconditions: 'Logged in',
    mainFlow: ['Step 1', 'Step 2'],
    alternateFlows: ['Alt 1'],
    postconditions: 'Success',
    dataImpact: 'Creates record',
    uiImpact: 'Shows toast',
    acceptanceCriteria: ['AC 1', 'AC 2'],
  });
}

describe('computeFeatureCompleteness', () => {
  it('returns 10/10 for fully filled feature', () => {
    const result = computeFeatureCompleteness(makeFullFeature());
    expect(result.filledFields).toBe(10);
    expect(result.totalFields).toBe(10);
    expect(result.isComplete).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it('returns 0/10 for empty feature', () => {
    const result = computeFeatureCompleteness(makeFeature());
    expect(result.filledFields).toBe(0);
    expect(result.totalFields).toBe(10);
    expect(result.isComplete).toBe(false);
    expect(result.missingFields).toHaveLength(10);
  });

  it('returns partial count for partially filled feature', () => {
    const feature = makeFeature({
      purpose: 'Test',
      actors: 'User',
      trigger: 'Click',
    });
    const result = computeFeatureCompleteness(feature);
    expect(result.filledFields).toBe(3);
    expect(result.isComplete).toBe(false);
    expect(result.missingFields).toContain('preconditions');
    expect(result.missingFields).toContain('mainFlow');
  });

  it('includes correct feature id and name', () => {
    const result = computeFeatureCompleteness(makeFeature({ id: 'F-05', name: 'Auth' }));
    expect(result.featureId).toBe('F-05');
    expect(result.featureName).toBe('Auth');
  });
});

describe('computeCompleteness', () => {
  it('handles empty feature list', () => {
    const structure: PRDStructure = { features: [], otherSections: {} };
    const result = computeCompleteness(structure);
    expect(result.featureCount).toBe(0);
    expect(result.completeFeatures).toBe(0);
    expect(result.averageCompleteness).toBe(0);
    expect(result.featureDetails).toEqual([]);
  });

  it('counts complete features correctly', () => {
    const structure: PRDStructure = {
      features: [makeFullFeature(), makeFeature({ id: 'F-02', name: 'Partial' })],
      otherSections: {},
    };
    const result = computeCompleteness(structure);
    expect(result.featureCount).toBe(2);
    expect(result.completeFeatures).toBe(1);
    expect(result.featureDetails).toHaveLength(2);
  });

  it('calculates average completeness', () => {
    const structure: PRDStructure = {
      features: [
        makeFullFeature(),
        makeFeature({ id: 'F-02', name: 'Empty' }),
      ],
      otherSections: {},
    };
    const result = computeCompleteness(structure);
    // (10 + 0) / (2 * 10) = 0.5
    expect(result.averageCompleteness).toBe(0.5);
  });
});
