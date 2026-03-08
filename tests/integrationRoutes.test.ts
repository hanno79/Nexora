/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Gezielte Regressionstests fuer die ausgelagerten Linear- und Dart-Integrationsrouten.
*/

// ÄNDERUNG 08.03.2026: Regressionen fuer PRD-Update-Mapping und zentrale Fehlerpfade der Integrationsrouten ergänzt.

import type { RequestHandler } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  buildDartPrdUpdate,
  buildLinearPrdUpdate,
  registerIntegrationRoutes,
  type IntegrationRouteDependencies,
} from '../server/integrationRoutes';

type RegisteredRoute = {
  method: 'get' | 'post' | 'put';
  path: string;
  handlers: RequestHandler[];
};

function createFakeApp() {
  const routes: RegisteredRoute[] = [];
  const app = {
    get: (path: string, ...handlers: RequestHandler[]) => routes.push({ method: 'get', path, handlers }),
    post: (path: string, ...handlers: RequestHandler[]) => routes.push({ method: 'post', path, handlers }),
    put: (path: string, ...handlers: RequestHandler[]) => routes.push({ method: 'put', path, handlers }),
  };
  return { app, routes };
}

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

function findRoute(routes: RegisteredRoute[], method: RegisteredRoute['method'], path: string): RegisteredRoute {
  const route = routes.find((candidate) => candidate.method === method && candidate.path === path);
  if (!route) {
    throw new Error(`Route ${method.toUpperCase()} ${path} wurde nicht registriert`);
  }
  return route;
}

async function invokeRoute(route: RegisteredRoute, body: Record<string, unknown>) {
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });
  const response = {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      resolveDone();
      return this;
    },
  };
  const request = { body, params: {}, query: {}, user: { claims: { sub: 'user-1' } } } as any;
  let handlerIndex = 0;
  const next = (error?: unknown) => {
    if (error) {
      throw error;
    }
    const handler = route.handlers[handlerIndex++];
    if (handler) {
      handler(request, response as any, next as any);
    }
  };

  next();
  await done;
  return response;
}

const PASS_THROUGH_AUTH = ((_req, _res, next) => next()) as RequestHandler;

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
