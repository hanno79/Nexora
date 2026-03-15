/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Gezielte Regressionstests fuer ausgelagerte PRD-Share-Routen.
*/

// ÄNDERUNG 08.03.2026: Regressionen fuer Share-Routen ergaenzt.

import { describe, expect, it, vi } from 'vitest';
import {
  createFakeApp,
  findRoute,
  invokeRoute,
  PASS_THROUGH_AUTH,
} from './helpers/routeTestUtils';
import {
  registerPrdShareRoutes,
  type PrdShareRouteDependencies,
} from '../server/prdShareRoutes';

function buildDependencies(overrides: Partial<PrdShareRouteDependencies> = {}): PrdShareRouteDependencies {
  return {
    storage: {
      getPrd: vi.fn().mockResolvedValue({ id: 'prd-1', userId: 'user-1' }),
      getPrdShares: vi.fn().mockResolvedValue([]),
      getUserByEmail: vi.fn().mockResolvedValue({ id: 'user-2', email: 'colleague@example.com' }),
      createSharedPrd: vi.fn().mockResolvedValue({ id: 'share-1', sharedWith: 'user-2', permission: 'view' }),
      updateSharedPrdPermission: vi.fn().mockResolvedValue({ id: 'share-1', sharedWith: 'user-2', permission: 'edit' }),
    } as any,
    requirePrdAccess: vi.fn().mockResolvedValue({ id: 'prd-1', userId: 'user-1' }),
    ...overrides,
  };
}


describe('registerPrdShareRoutes', () => {
  it('liefert beim GET die vorhandenen Shares zurueck', async () => {
    const { app, routes } = createFakeApp();
    const shares = [{ id: 'share-1', sharedWith: 'user-2', permission: 'view' }];
    const dependencies = buildDependencies({
      storage: {
        ...buildDependencies().storage,
        getPrdShares: vi.fn().mockResolvedValue(shares),
      } as any,
    });
    registerPrdShareRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(findRoute(routes, 'get', '/api/prds/:id/shares'), {}, { id: 'prd-1' });
    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual(shares);
  });

  it('liefert 404, wenn die PRD beim Teilen nicht existiert', async () => {
    const { app, routes } = createFakeApp();
    const dependencies = buildDependencies({
      requirePrdAccess: vi.fn().mockImplementation(async (_storage: any, _req: any, res: any) => {
        res.status(404).json({ message: 'PRD not found' });
        return undefined;
      }),
    });
    registerPrdShareRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(findRoute(routes, 'post', '/api/prds/:id/share'), { email: 'team@example.com' }, { id: 'prd-404' });
    expect(response.statusCode).toBe(404);
    expect(response.payload).toEqual({ message: 'PRD not found' });
  });

  it('liefert 403, wenn ein Nicht-Owner teilen will', async () => {
    const { app, routes } = createFakeApp();
    const dependencies = buildDependencies({
      requirePrdAccess: vi.fn().mockImplementation(async (_storage: any, _req: any, res: any) => {
        res.status(403).json({ message: 'Only the owner can share this PRD' });
        return undefined;
      }),
    });
    registerPrdShareRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(findRoute(routes, 'post', '/api/prds/:id/share'), { email: 'team@example.com' }, { id: 'prd-1' });
    expect(response.statusCode).toBe(403);
    expect(response.payload).toEqual({ message: 'Only the owner can share this PRD' });
  });

  it('liefert 404, wenn der Zielbenutzer nicht gefunden wurde', async () => {
    const { app, routes } = createFakeApp();
    const dependencies = buildDependencies({
      storage: { ...buildDependencies().storage, getUserByEmail: vi.fn().mockResolvedValue(undefined) } as any,
    });
    registerPrdShareRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(findRoute(routes, 'post', '/api/prds/:id/share'), { email: 'missing@example.com' }, { id: 'prd-1' });
    expect(response.statusCode).toBe(404);
    expect(response.payload).toEqual({ message: 'User not found' });
  });

  it('verhindert Self-Sharing', async () => {
    const { app, routes } = createFakeApp();
    const dependencies = buildDependencies({
      storage: { ...buildDependencies().storage, getUserByEmail: vi.fn().mockResolvedValue({ id: 'user-1' }) } as any,
    });
    registerPrdShareRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(findRoute(routes, 'post', '/api/prds/:id/share'), { email: 'self@example.com' }, { id: 'prd-1' });
    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'You cannot share a PRD with yourself' });
  });

  it('gibt bestehende Shares unveraendert zurueck', async () => {
    const { app, routes } = createFakeApp();
    const existingShare = { id: 'share-1', sharedWith: 'user-2', permission: 'view' };
    const dependencies = buildDependencies({
      storage: { ...buildDependencies().storage, getPrdShares: vi.fn().mockResolvedValue([existingShare]) } as any,
    });
    registerPrdShareRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(findRoute(routes, 'post', '/api/prds/:id/share'), { email: 'colleague@example.com', permission: 'view' }, { id: 'prd-1' });
    expect(response.payload).toEqual(existingShare);
    expect((dependencies.storage as any).updateSharedPrdPermission).not.toHaveBeenCalled();
    expect((dependencies.storage as any).createSharedPrd).not.toHaveBeenCalled();
  });

  it('aktualisiert die Berechtigung eines bestehenden Shares', async () => {
    const { app, routes } = createFakeApp();
    const dependencies = buildDependencies({
      storage: { ...buildDependencies().storage, getPrdShares: vi.fn().mockResolvedValue([{ id: 'share-1', sharedWith: 'user-2', permission: 'view' }]) } as any,
    });
    registerPrdShareRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(findRoute(routes, 'post', '/api/prds/:id/share'), { email: 'colleague@example.com', permission: 'edit' }, { id: 'prd-1' });
    expect((dependencies.storage as any).updateSharedPrdPermission).toHaveBeenCalledWith('share-1', 'edit');
    expect(response.payload).toEqual({ id: 'share-1', sharedWith: 'user-2', permission: 'edit' });
  });

  it('erstellt einen neuen Share mit normalisierter E-Mail und Default-Permission', async () => {
    const { app, routes } = createFakeApp();
    const dependencies = buildDependencies();
    registerPrdShareRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(findRoute(routes, 'post', '/api/prds/:id/share'), { email: '  TEAM@EXAMPLE.COM  ' }, { id: 'prd-1' });
    expect((dependencies.storage as any).getUserByEmail).toHaveBeenCalledWith('team@example.com');
    expect((dependencies.storage as any).createSharedPrd).toHaveBeenCalledWith({ prdId: 'prd-1', sharedWith: 'user-2', permission: 'view' });
    expect(response.payload).toEqual({ id: 'share-1', sharedWith: 'user-2', permission: 'view' });
  });
});