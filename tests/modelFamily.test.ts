import { describe, expect, it } from 'vitest';
import {
  areModelsSameFamily,
  getModelFamily,
  resolveIndependentVerifierModel,
} from '../server/modelFamily';

describe('modelFamily utilities', () => {
  it('extracts stable families from configured model identifiers', () => {
    expect(getModelFamily('anthropic/claude-sonnet-4')).toBe('claude');
    expect(getModelFamily('google/gemini-2.5-flash')).toBe('gemini');
    expect(getModelFamily('google/gemma-3-27b-it:free')).toBe('gemma');
    expect(getModelFamily('mistralai/mistral-small-3.1-24b-instruct')).toBe('mistral');
    expect(getModelFamily('meta-llama/llama-4-maverick-17b-128e-instruct')).toBe('llama');
    expect(getModelFamily('openai/gpt-oss-120b:free')).toBe('gpt-oss');
  });

  it('detects same-family models across variants', () => {
    expect(areModelsSameFamily('anthropic/claude-sonnet-4', 'anthropic/claude-haiku-4')).toBe(true);
    expect(areModelsSameFamily('google/gemini-2.5-flash', 'google/gemini-2.5-pro-preview')).toBe(true);
    expect(areModelsSameFamily('google/gemini-2.5-flash', 'anthropic/claude-sonnet-4')).toBe(false);
  });

  it('reassigns verifier to an independent family when configured verifier conflicts', () => {
    const resolution = resolveIndependentVerifierModel({
      generatorModel: 'google/gemini-2.5-flash',
      reviewerModel: 'anthropic/claude-sonnet-4',
      verifierModel: 'anthropic/claude-sonnet-4',
      fallbackChain: ['openai/gpt-oss-120b:free'],
      tierDefaults: {
        generator: 'google/gemini-2.5-flash',
        reviewer: 'anthropic/claude-sonnet-4',
        verifier: 'mistralai/mistral-small-3.1-24b-instruct',
      },
    });

    expect(resolution.blockedFamilies).toEqual(['gemini', 'claude']);
    expect(resolution.overrideApplied).toBe(true);
    expect(resolution.independent).toBe(true);
    expect(resolution.resolvedModel).toBe('mistralai/mistral-small-3.1-24b-instruct');
  });

  it('reports same-family fallback only when no independent verifier candidate exists', () => {
    const resolution = resolveIndependentVerifierModel({
      generatorModel: 'google/gemini-2.5-flash',
      reviewerModel: 'anthropic/claude-sonnet-4',
      verifierModel: 'anthropic/claude-haiku-4',
      fallbackChain: ['anthropic/claude-sonnet-4'],
      tierDefaults: {
        generator: 'google/gemini-2.5-flash',
        reviewer: 'anthropic/claude-sonnet-4',
        verifier: 'anthropic/claude-haiku-4',
      },
    });

    expect(resolution.independent).toBe(false);
    expect(resolution.sameFamilyFallbackOnly).toBe(true);
    expect(resolution.resolvedFamily).toBe('claude');
  });
});
