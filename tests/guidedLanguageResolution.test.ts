import { describe, expect, test } from 'vitest';
import { detectContentLanguage } from '../server/prdLanguageDetector';

describe('Content language detection (shared)', () => {
  test('detects german content when preference is auto', () => {
    const language = detectContentLanguage(null, 'Bitte erstelle ein PRD mit klaren Anforderungen.');
    expect(language).toBe('de');
  });

  test('keeps explicit english preference even with german hints', () => {
    const language = detectContentLanguage('en', 'Bitte erstelle ein PRD fuer Nutzer.');
    expect(language).toBe('en');
  });

  test('defaults to english when no german hint is present', () => {
    const language = detectContentLanguage(null, 'Create a product requirements document for a web app.');
    expect(language).toBe('en');
  });

  test('detects german via umlaut characters', () => {
    const language = detectContentLanguage(null, 'Ein Tool für die Übersicht');
    expect(language).toBe('de');
  });

  test('detects german via compound word hints', () => {
    const language = detectContentLanguage(null, 'Build a landingpage with kontaktformular');
    expect(language).toBe('de');
  });
});
