import { describe, it, expect } from 'vitest';
import { detectContentLanguage } from '../server/prdLanguageDetector';

describe('detectContentLanguage', () => {
  it('returns "de" for explicit preference "de" regardless of text content', () => {
    expect(detectContentLanguage('de', 'This is purely English text')).toBe('de');
  });

  it('returns "en" for explicit preference "en" regardless of text content', () => {
    expect(detectContentLanguage('en', 'Erstelle eine Landingpage mit Kontaktformular')).toBe('en');
  });

  it('detects German via umlauts (ae oe ue ss in text)', () => {
    expect(detectContentLanguage(null, 'Bitte eine Übersicht erstellen')).toBe('de');
    expect(detectContentLanguage(null, 'Große Änderungen nötig')).toBe('de');
  });

  it('detects German via keywords (erstelle, und, oder, mit, fuer)', () => {
    expect(detectContentLanguage(null, 'erstelle ein neues Projekt')).toBe('de');
    expect(detectContentLanguage(null, 'Login und Dashboard')).toBe('de');
    expect(detectContentLanguage(null, 'Suche oder Filter')).toBe('de');
    expect(detectContentLanguage(null, 'App mit API')).toBe('de');
    expect(detectContentLanguage(null, 'Seite fuer Nutzer')).toBe('de');
  });

  it('detects German via compound words (landingpage, kontaktformular)', () => {
    expect(detectContentLanguage(null, 'eine landingpage bauen')).toBe('de');
    expect(detectContentLanguage(null, 'kontaktformular einbauen')).toBe('de');
  });

  it('returns "en" as default when no German signals found', () => {
    expect(detectContentLanguage(null, 'Build a simple task manager app')).toBe('en');
  });

  it('returns "en" for empty text with no preference', () => {
    expect(detectContentLanguage(null, '')).toBe('en');
  });

  it('returns "en" for English-only text with no preference', () => {
    expect(detectContentLanguage(null, 'Create a landing page with contact form')).toBe('en');
  });

  it('handles null/undefined preference gracefully (falls through to content detection)', () => {
    expect(detectContentLanguage(null, 'erstelle eine App')).toBe('de');
    expect(detectContentLanguage(undefined, 'erstelle eine App')).toBe('de');
    expect(detectContentLanguage(null, 'Create an app')).toBe('en');
    expect(detectContentLanguage(undefined, 'Create an app')).toBe('en');
  });
});
