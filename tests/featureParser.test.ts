import { describe, expect, it } from 'vitest';
import { parseFeatureList } from '../server/services/llm/expandFeature';

describe('parseFeatureList', () => {
  it('parses strict format with Short description', () => {
    const input = `Feature List:

F-01: User Login
Short description: Allows users to log in with email and password.

F-02: Dashboard Display
Short description: Shows an overview of key metrics after login.

F-03: Settings Page
Short description: Allows users to configure preferences.
`;

    const result = parseFeatureList(input);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      featureId: 'F-01',
      featureName: 'User Login',
      shortDescription: 'Allows users to log in with email and password.',
    });
    expect(result[1].featureId).toBe('F-02');
    expect(result[1].shortDescription).toBe('Shows an overview of key metrics after login.');
    expect(result[2].featureId).toBe('F-03');
  });

  it('parses lenient format without Short description lines', () => {
    const input = `Feature List:

F-01: User Registration
F-02: Game Initialization
F-03: Score Calculation
F-04: Leaderboard Display
`;

    const result = parseFeatureList(input);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({
      featureId: 'F-01',
      featureName: 'User Registration',
      shortDescription: 'User Registration',
    });
    expect(result[3].featureId).toBe('F-04');
    expect(result[3].featureName).toBe('Leaderboard Display');
  });

  it('parses format with extra blank lines between features', () => {
    const input = `
F-01: Map Rendering

F-02: Score System

F-03: Round Management
`;

    const result = parseFeatureList(input);
    expect(result).toHaveLength(3);
    expect(result[0].featureName).toBe('Map Rendering');
    expect(result[1].featureName).toBe('Score System');
    expect(result[2].featureName).toBe('Round Management');
  });

  it('parses markdown bold formatted features', () => {
    const input = `**F-01: Interactive Map**
**F-02: Difficulty Levels**
**F-03: Result Summary**`;

    const result = parseFeatureList(input);
    expect(result).toHaveLength(3);
    expect(result[0].featureName).toBe('Interactive Map');
    expect(result[1].featureName).toBe('Difficulty Levels');
  });

  it('parses bullet-prefixed features', () => {
    const input = `Feature List:
- F-01: User Authentication
- F-02: Data Export
- F-03: Notification System`;

    const result = parseFeatureList(input);
    expect(result).toHaveLength(3);
    expect(result[0].featureName).toBe('User Authentication');
  });

  it('handles mixed Description prefixes in lenient mode', () => {
    const input = `F-01: Kartenansicht
Beschreibung: Zeigt die interaktive Karte an.

F-02: Punkteberechnung
Description: Calculates player score based on distance.
`;

    const result = parseFeatureList(input);
    expect(result).toHaveLength(2);
    expect(result[0].shortDescription).toBe('Zeigt die interaktive Karte an.');
    expect(result[1].shortDescription).toBe('Calculates player score based on distance.');
  });

  it('returns empty array for text without any F-XX pattern', () => {
    const input = `This is just some random text without any features.
No feature list here.`;

    const result = parseFeatureList(input);
    expect(result).toHaveLength(0);
  });

  it('skips invalid feature numbers', () => {
    const input = `F-00: Invalid Zero

F-01: Valid Feature

F-02: Another Valid
`;

    const result = parseFeatureList(input);
    expect(result).toHaveLength(2);
    expect(result[0].featureId).toBe('F-01');
    expect(result[1].featureId).toBe('F-02');
  });

  it('pads single-digit feature IDs', () => {
    const input = `F-1: First Feature

F-2: Second Feature

F-10: Tenth Feature
`;

    const result = parseFeatureList(input);
    expect(result).toHaveLength(3);
    expect(result[0].featureId).toBe('F-01');
    expect(result[2].featureId).toBe('F-10');
  });
});
