/// <reference types="vitest" />
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
      '# PRD',
      '',
      '## System Vision',
      'Test product.',
      '',
      '## Functional Feature Catalogue',
      '',
      '### F-01: Existing Feature',
      '',
      '**1. Purpose**',
      'Keep existing behavior stable.',
      '',
      '**2. Actors**',
      'End user.',
      '',
      '**10. Acceptance Criteria**',
      '- Existing feature remains testable.',
    ].join('\n');

    const assessment = assessPrdBaseline(baseline);
    expect(assessment.hasContent).toBe(true);
    expect(assessment.featureCount).toBeGreaterThanOrEqual(1);
    expect(assessment.hasFeatureBaseline).toBe(true);
  });

  it('keeps improve mode with baselinePartial when content exists but has no features', () => {
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

    expect(resolved.mode).toBe('improve');
    expect(resolved.downgradedFromImprove).toBe(false);
    expect(resolved.assessment.featureCount).toBe(0);
    expect(resolved.assessment.baselinePartial).toBe(true);
    expect(resolved.assessment.hasContent).toBe(true);
  });

  it('downgrades improve mode to generate when content is empty', () => {
    const resolved = resolvePrdWorkflowMode({
      requestedMode: 'improve',
      existingContent: '',
    });

    expect(resolved.mode).toBe('generate');
    expect(resolved.downgradedFromImprove).toBe(true);
    expect(resolved.assessment.hasContent).toBe(false);
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

