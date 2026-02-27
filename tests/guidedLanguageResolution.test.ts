import { beforeAll, describe, expect, test } from 'vitest';

describe('GuidedAiService language resolution', () => {
  let service: any;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/nexora_test';
    }
    const module = await import('../server/guidedAiService');
    service = new module.GuidedAiService() as any;
  });

  test('detects german content when preference is auto', () => {
    const language = service.resolveContentLanguage(null, 'Bitte erstelle ein PRD mit klaren Anforderungen.');
    expect(language).toBe('de');
  });

  test('keeps explicit english preference even with german hints', () => {
    const language = service.resolveContentLanguage('en', 'Bitte erstelle ein PRD fuer Nutzer.');
    expect(language).toBe('en');
  });

  test('defaults to english when no german hint is present', () => {
    const language = service.resolveContentLanguage(null, 'Create a product requirements document for a web app.');
    expect(language).toBe('en');
  });
});
