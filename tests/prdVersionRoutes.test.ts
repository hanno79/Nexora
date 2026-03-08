/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Gezielte Regressionstests fuer ausgelagerte PRD-Versionsrouten.
*/

// ÄNDERUNG 08.03.2026: Regressionen fuer Versionsrouten ergaenzt.

import type { RequestHandler } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  registerPrdVersionRoutes,
  type PrdVersionRouteDependencies,
} from '../server/prdVersionRoutes';

type RegisteredRoute = {
  method: 'get' | 'post' | 'delete';
  path: string;
  handlers: RequestHandler[];
};

function createFakeApp() {
  const routes: RegisteredRoute[] = [];
  const app = {
    get: (path: string, ...handlers: RequestHandler[]) => routes.push({ method: 'get', path, handlers }),
    post: (path: string, ...handlers: RequestHandler[]) => routes.push({ method: 'post', path, handlers }),
    delete: (path: string, ...handlers: RequestHandler[]) => routes.push({ method: 'delete', path, handlers }),
  };
  return { app, routes };
}

function buildDependencies(overrides: Partial<PrdVersionRouteDependencies> = {}): PrdVersionRouteDependencies {
  return {
    storage: {
      getPrd: vi.fn(),
      getPrdShares: vi.fn().mockResolvedValue([]),
      getPrdVersions: vi.fn().mockResolvedValue([]),
      createPrdVersion: vi.fn().mockResolvedValue({ id: 'version-1', versionNumber: 'v3' }),
      getPrdVersion: vi.fn().mockResolvedValue(undefined),
      deletePrdVersion: vi.fn().mockResolvedValue(undefined),
    } as any,
    requirePrdAccess: vi.fn().mockResolvedValue({
      id: 'prd-1',
      title: 'PRD Titel',
      description: 'Beschreibung',
      content: 'PRD Inhalt',
      status: 'draft',
      structuredContent: { features: [] },
    }),
    getNextPrdVersionNumber: vi.fn().mockReturnValue('v3'),
    buildPrdVersionSnapshot: vi.fn().mockReturnValue({
      prdId: 'prd-1',
      versionNumber: 'v3',
      title: 'PRD Titel',
      description: 'Beschreibung',
      content: 'PRD Inhalt',
      structuredContent: { features: [] },
      status: 'draft',
      createdBy: 'user-1',
    }),
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

async function invokeRoute(route: RegisteredRoute, body: Record<string, unknown> = {}, params: Record<string, string> = {}) {
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
  const request = { body, params, query: {}, user: { claims: { sub: 'user-1' } } } as any;
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

describe('registerPrdVersionRoutes', () => {
  it('liefert die vorhandenen Versionen zurueck', async () => {
    const { app, routes } = createFakeApp();
    const versions = [{ id: 'version-2', prdId: 'prd-1' }];
    const dependencies = buildDependencies({
      storage: {
        ...buildDependencies().storage,
        getPrdVersions: vi.fn().mockResolvedValue(versions),
      } as any,
    });
    registerPrdVersionRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(findRoute(routes, 'get', '/api/prds/:id/versions'), {}, { id: 'prd-1' });
    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual(versions);
  });

  it('erstellt beim POST eine neue Versions-Snapshot-Instanz', async () => {
    const { app, routes } = createFakeApp();
    const dependencies = buildDependencies({
      storage: {
        ...buildDependencies().storage,
        getPrdVersions: vi.fn().mockResolvedValue([{ id: 'version-1' }, { id: 'version-0' }]),
        createPrdVersion: vi.fn().mockResolvedValue({ id: 'version-3', versionNumber: 'v3' }),
      } as any,
    });
    registerPrdVersionRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(findRoute(routes, 'post', '/api/prds/:id/versions'), {}, { id: 'prd-1' });

    expect(dependencies.getNextPrdVersionNumber).toHaveBeenCalledWith(2);
    expect(dependencies.buildPrdVersionSnapshot).toHaveBeenCalledWith(expect.objectContaining({ id: 'prd-1' }), 'v3', 'user-1');
    expect((dependencies.storage as any).createPrdVersion).toHaveBeenCalledWith(expect.objectContaining({ versionNumber: 'v3' }));
    expect(response.payload).toEqual({ id: 'version-3', versionNumber: 'v3' });
  });

  it('liefert beim Loeschen einen 404-Fehler fuer unbekannte Versionen', async () => {
    const { app, routes } = createFakeApp();
    const dependencies = buildDependencies();
    registerPrdVersionRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(
      findRoute(routes, 'delete', '/api/prds/:id/versions/:versionId'),
      {},
      { id: 'prd-1', versionId: 'version-404' },
    );

    expect(response.statusCode).toBe(404);
    expect(response.payload).toEqual({ message: 'Version not found' });
  });

  it('verhindert das Loeschen einer Version aus einer anderen PRD', async () => {
    const { app, routes } = createFakeApp();
    const dependencies = buildDependencies({
      storage: {
        ...buildDependencies().storage,
        getPrdVersion: vi.fn().mockResolvedValue({ id: 'version-1', prdId: 'prd-anderes' }),
      } as any,
    });
    registerPrdVersionRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(
      findRoute(routes, 'delete', '/api/prds/:id/versions/:versionId'),
      {},
      { id: 'prd-1', versionId: 'version-1' },
    );

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'Version does not belong to this PRD' });
  });

  it('verhindert das Loeschen der aktuellsten Version', async () => {
    const { app, routes } = createFakeApp();
    const dependencies = buildDependencies({
      storage: {
        ...buildDependencies().storage,
        getPrdVersion: vi.fn().mockResolvedValue({ id: 'version-1', prdId: 'prd-1' }),
        getPrdVersions: vi.fn().mockResolvedValue([{ id: 'version-1' }, { id: 'version-0' }]),
      } as any,
    });
    registerPrdVersionRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(
      findRoute(routes, 'delete', '/api/prds/:id/versions/:versionId'),
      {},
      { id: 'prd-1', versionId: 'version-1' },
    );

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'Cannot delete the current (latest) version' });
  });

  it('loescht eine aeltere Version erfolgreich', async () => {
    const { app, routes } = createFakeApp();
    const dependencies = buildDependencies({
      storage: {
        ...buildDependencies().storage,
        getPrdVersion: vi.fn().mockResolvedValue({ id: 'version-1', prdId: 'prd-1' }),
        getPrdVersions: vi.fn().mockResolvedValue([{ id: 'version-2' }, { id: 'version-1' }]),
      } as any,
    });
    registerPrdVersionRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(
      findRoute(routes, 'delete', '/api/prds/:id/versions/:versionId'),
      {},
      { id: 'prd-1', versionId: 'version-1' },
    );

    expect((dependencies.storage as any).deletePrdVersion).toHaveBeenCalledWith('version-1');
    expect(response.payload).toEqual({ success: true });
  });
});