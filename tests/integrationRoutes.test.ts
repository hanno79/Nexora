/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Gezielte Regressionstests fuer die ausgelagerten Linear- und Dart-Integrationsrouten.
*/

// ÄNDERUNG 08.03.2026: Regressionen fuer PRD-Update-Mapping und zentrale Fehlerpfade der Integrationsrouten ergänzt.

import { describe, expect, it, vi } from 'vitest';
import {
  createFakeApp,
  findRoute,
  invokeRoute,
  PASS_THROUGH_AUTH,
} from './helpers/routeTestUtils';
import {
  buildDartPrdUpdate,
  buildLinearPrdUpdate,
  registerIntegrationRoutes,
  type IntegrationRouteDependencies,
} from '../server/integrationRoutes';

function buildDependencies(overrides: Partial<IntegrationRouteDependencies> = {}): IntegrationRouteDependencies {
  return {
    storage: {
      getPrd: vi.fn().mockResolvedValue({ dartDocId: 'doc-linked' }),
      getPrdShares: vi.fn().mockResolvedValue([]),
      updatePrd: vi.fn().mockResolvedValue(undefined),
    } as any,
    exportToLinear: vi.fn().mockResolvedValue({ issueId: 'issue-1', url: 'https://linear.test/issue-1' }),
    checkLinearConnection: vi.fn().mockResolvedValue(true),
    getDartboards: vi.fn().mockResolvedValue({ items: [] }),
    exportToDart: vi.fn().mockResolvedValue({ docId: 'doc-1', url: 'https://dart.test/doc-1', folder: 'General/Docs' }),
    checkDartConnection: vi.fn().mockResolvedValue(true),
    updateDartDoc: vi.fn().mockResolvedValue({ docId: 'doc-1', url: 'https://dart.test/doc-1' }),
    requireEditablePrdId: vi.fn().mockResolvedValue('prd-1'),
    normalizeDartDocId: vi.fn((docId: unknown) => typeof docId === 'string' ? docId : null),
    isDartDocUpdateConsistent: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}


describe('integrationRoutes Helfer', () => {
  it('mappt Linear-Exportdaten auf PRD-Update-Felder', () => {
    expect(buildLinearPrdUpdate({ issueId: 'issue-7', url: 'https://linear.test/issue-7' })).toEqual({
      linearIssueId: 'issue-7',
      linearIssueUrl: 'https://linear.test/issue-7',
    });
  });

  it('mappt Dart-Exportdaten auf PRD-Update-Felder', () => {
    expect(buildDartPrdUpdate({ docId: 'doc-9', url: 'https://dart.test/doc-9', folder: 'General/Docs' })).toEqual({
      dartDocId: 'doc-9',
      dartDocUrl: 'https://dart.test/doc-9',
      dartFolder: 'General/Docs',
    });
  });
});

describe('registerIntegrationRoutes', () => {
  it('liefert beim Linear-Export ohne Titel einen 400-Fehler', async () => {
    const { app, routes } = createFakeApp();
    registerIntegrationRoutes(app as any, PASS_THROUGH_AUTH, buildDependencies());

    const response = await invokeRoute(findRoute(routes, 'post', '/api/linear/export'), { prdId: 'prd-1' });
    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'Title is required' });
  });

  it('liefert beim Dart-Export ohne Titel einen 400-Fehler', async () => {
    const { app, routes } = createFakeApp();
    registerIntegrationRoutes(app as any, PASS_THROUGH_AUTH, buildDependencies());

    const response = await invokeRoute(findRoute(routes, 'post', '/api/dart/export'), { prdId: 'prd-1' });
    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'Title is required' });
  });

  it('aktualisiert beim Linear-Export die verknuepften PRD-Felder', async () => {
    const { app, routes } = createFakeApp();
    const dependencies = buildDependencies();
    registerIntegrationRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(findRoute(routes, 'post', '/api/linear/export'), {
      prdId: 'prd-1',
      title: 'Exporttitel',
      description: 'Kurzbeschreibung',
    });

    expect(response.statusCode).toBe(200);
    expect(dependencies.storage.updatePrd).toHaveBeenCalledWith('prd-1', {
      linearIssueId: 'issue-1',
      linearIssueUrl: 'https://linear.test/issue-1',
    });
  });

  it('liefert beim Dart-Update einen 409-Fehler bei unpassender Dokument-ID', async () => {
    const { app, routes } = createFakeApp();
    const dependencies = buildDependencies({
      normalizeDartDocId: vi.fn().mockReturnValue('doc-other'),
      isDartDocUpdateConsistent: vi.fn().mockReturnValue(false),
    });
    registerIntegrationRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(findRoute(routes, 'put', '/api/dart/update'), {
      prdId: 'prd-1',
      docId: 'doc-other',
      title: 'Neuer Titel',
      content: 'Neuer Inhalt',
    });

    expect(response.statusCode).toBe(409);
    expect(response.payload).toEqual({ message: "Dart document ID does not match the PRD's linked document" });
    expect(dependencies.updateDartDoc).not.toHaveBeenCalled();
  });
});
