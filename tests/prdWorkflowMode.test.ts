import { describe, expect, it } from 'vitest';
import { assessPrdBaseline, resolvePrdWorkflowMode } from '../server/prdWorkflowMode';

describe('prdWorkflowMode', () => {
  it('assesses empty baseline as non-improvable', () => {
    const assessment = assessPrdBaseline('');
    expect(assessment.hasContent).toBe(false);
    expect(assessment.featureCount).toBe(0);
    expect(assessment.hasFeatureBaseline).toBe(false);
  });

  it('detects feature baseline when feature catalogue includes F-IDs', () => {
    const baseline = [
      '## Functional Feature Catalogue',
      '',
      '### F-01: Existing Feature',
      '1. Purpose',
      'Keep existing behavior stable.',
      '10. Acceptance Criteria',
      '- Existing feature remains testable.',
    ].join('\n');

    const assessment = assessPrdBaseline(baseline);
    expect(assessment.hasContent).toBe(true);
    expect(assessment.featureCount).toBe(1);
    expect(assessment.hasFeatureBaseline).toBe(true);
  });

  it('downgrades improve mode to generate when no feature baseline exists', () => {
    const noFeaturesBaseline = [
      '## System Vision',
      'A fresh template draft without feature IDs.',
      '',
      '## System Boundaries',
      'Web application scope.',
    ].join('\n');

    const resolved = resolvePrdWorkflowMode({
      requestedMode: 'improve',
      existingContent: noFeaturesBaseline,
    });

    expect(resolved.mode).toBe('generate');
    expect(resolved.downgradedFromImprove).toBe(true);
    expect(resolved.assessment.featureCount).toBe(0);
  });

  it('keeps improve mode when feature baseline exists', () => {
    const featureBaseline = [
      '## Functional Feature Catalogue',
      '',
      '### F-01: Existing Feature',
      '1. Purpose',
      'Existing purpose.',
      '10. Acceptance Criteria',
      '- Existing criteria.',
    ].join('\n');

    const resolved = resolvePrdWorkflowMode({
      requestedMode: 'improve',
      existingContent: featureBaseline,
    });

    expect(resolved.mode).toBe('improve');
    expect(resolved.downgradedFromImprove).toBe(false);
  });
});

