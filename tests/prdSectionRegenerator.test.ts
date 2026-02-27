import { describe, it, expect } from 'vitest';
import { detectTargetSection } from '../server/prdSectionRegenerator';

describe('detectTargetSection', () => {
  it('maps explicit german section names to canonical section keys', () => {
    const reviewText = 'Bitte Abschnitt: Nicht-funktionale Anforderungen verbessern und praezisieren.';
    expect(detectTargetSection(reviewText)).toBe('nonFunctional');
  });

  it('detects german section intent from free-form feedback', () => {
    const reviewText = 'Der Zeitplan und die Meilensteine sind unklar. Bitte den Zeitplan detaillieren.';
    expect(detectTargetSection(reviewText)).toBe('timelineMilestones');
  });

  it('skips section targeting by default when feature-context is detected', () => {
    const reviewText = 'Bitte verbessere F-01 im Feature Katalog mit klareren Akzeptanzkriterien.';
    expect(detectTargetSection(reviewText)).toBeNull();
    expect(detectTargetSection(reviewText, { allowFeatureContext: true })).toBe('successCriteria');
  });
});

