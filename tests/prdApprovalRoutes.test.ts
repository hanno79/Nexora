/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Gezielte Regressionstests fuer ausgelagerte PRD-Approval-Routen.
*/

// ÄNDERUNG 08.03.2026: Regressionen fuer Approval-Routen ergaenzt.

import { describe, expect, it, vi } from 'vitest';
import {
  createFakeApp,
  findRoute,
  invokeRoute,
  PASS_THROUGH_AUTH,
} from './helpers/routeTestUtils';
import {
  registerPrdApprovalRoutes,
  type PrdApprovalRouteDependencies,
} from '../server/prdApprovalRoutes';

function buildDependencies(overrides: Partial<PrdApprovalRouteDependencies> = {}): PrdApprovalRouteDependencies {
  return {
    storage: {
      getPrd: vi.fn().mockResolvedValue({ id: 'prd-1', userId: 'owner-1' }),
      getPrdShares: vi.fn().mockResolvedValue([{ sharedWith: 'reviewer-1', permission: 'edit' }]),
      getApproval: vi.fn().mockResolvedValue(undefined),
      createApproval: vi.fn().mockResolvedValue({
        id: 'approval-1',
        prdId: 'prd-1',
        requestedBy: 'user-1',
        reviewers: ['reviewer-1'],
        status: 'pending',
      }),
      updateApproval: vi.fn().mockResolvedValue({
        id: 'approval-1',
        prdId: 'prd-1',
        requestedBy: 'user-1',
        reviewers: ['reviewer-1'],
        status: 'approved',
        completedBy: 'reviewer-1',
      }),
      updatePrd: vi.fn().mockResolvedValue({ id: 'prd-1', status: 'pending-approval' }),
      getUser: vi.fn().mockResolvedValue({
        id: 'user-1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
      }),
    } as any,
    requirePrdAccess: vi.fn().mockResolvedValue({ id: 'prd-1', userId: 'owner-1' }),
    loadUsersByIds: vi.fn().mockResolvedValue([]),
    broadcastPrdUpdate: vi.fn(),
    ...overrides,
  };
}


describe('registerPrdApprovalRoutes', () => {
  it('liefert beim GET null, wenn keine Approval existiert', async () => {
    const { app, routes } = createFakeApp();
    const dependencies = buildDependencies();
    registerPrdApprovalRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(findRoute(routes, 'get', '/api/prds/:id/approval'), {}, { id: 'prd-1' });
    expect(response.statusCode).toBe(200);
    expect(response.payload).toBeNull();
  });

  it('liefert beim GET angereicherte Requester- und Completer-Daten', async () => {
    const { app, routes } = createFakeApp();
    const baseDependencies = buildDependencies();
    const dependencies = buildDependencies({
      storage: {
        ...baseDependencies.storage,
        getApproval: vi.fn().mockResolvedValue({
          id: 'approval-1',
          prdId: 'prd-1',
          requestedBy: 'user-2',
          completedBy: 'user-3',
          reviewers: ['user-3'],
          status: 'approved',
        }),
      } as any,
      loadUsersByIds: vi.fn().mockResolvedValue([
        { id: 'user-2', firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com' },
        { id: 'user-3', firstName: 'Katherine', lastName: 'Johnson', email: 'kj@example.com' },
      ]),
    });
    registerPrdApprovalRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(findRoute(routes, 'get', '/api/prds/:id/approval'), {}, { id: 'prd-1' });
    expect(dependencies.loadUsersByIds).toHaveBeenCalledWith(['user-2', 'user-3']);
    expect(response.payload).toEqual({
      id: 'approval-1',
      prdId: 'prd-1',
      requestedBy: 'user-2',
      completedBy: 'user-3',
      reviewers: ['user-3'],
      status: 'approved',
      requester: { id: 'user-2', firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com' },
      completer: { id: 'user-3', firstName: 'Katherine', lastName: 'Johnson', email: 'kj@example.com' },
    });
  });

  it('liefert beim POST /request einen 400-Fehler fuer bereits offene Approval-Anfragen', async () => {
    const { app, routes } = createFakeApp();
    const baseDependencies = buildDependencies();
    const dependencies = buildDependencies({
      storage: {
        ...baseDependencies.storage,
        getApproval: vi.fn().mockResolvedValue({ id: 'approval-1', status: 'pending' }),
      } as any,
    });
    registerPrdApprovalRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(
      findRoute(routes, 'post', '/api/prds/:id/approval/request'),
      { reviewers: ['reviewer-1'] },
      { id: 'prd-1' },
    );
    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'There is already a pending approval request' });
    expect((dependencies.storage as any).createApproval).not.toHaveBeenCalled();
  });

  it('liefert beim POST /request einen 400-Fehler ohne gueltige Reviewer', async () => {
    const { app, routes } = createFakeApp();
    const baseDependencies = buildDependencies();
    const dependencies = buildDependencies({
      storage: {
        ...baseDependencies.storage,
        getPrdShares: vi.fn().mockResolvedValue([]),
      } as any,
    });
    registerPrdApprovalRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(
      findRoute(routes, 'post', '/api/prds/:id/approval/request'),
      { reviewers: ['   '] },
      { id: 'prd-1' },
    );
    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'At least one valid reviewer is required' });
    expect((dependencies.storage as any).createApproval).not.toHaveBeenCalled();
  });

  it('erstellt beim POST /request eine Approval und setzt den PRD-Status', async () => {
    const { app, routes } = createFakeApp();
    const dependencies = buildDependencies();
    registerPrdApprovalRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(
      findRoute(routes, 'post', '/api/prds/:id/approval/request'),
      { reviewers: [' reviewer-1 '] },
      { id: 'prd-1' },
    );
    expect((dependencies.storage as any).createApproval).toHaveBeenCalledWith({
      prdId: 'prd-1',
      requestedBy: 'user-1',
      reviewers: ['reviewer-1'],
      status: 'pending',
    });
    expect((dependencies.storage as any).updatePrd).toHaveBeenCalledWith('prd-1', { status: 'pending-approval' });
    expect(response.payload).toEqual({
      id: 'approval-1',
      prdId: 'prd-1',
      requestedBy: 'user-1',
      reviewers: ['reviewer-1'],
      status: 'pending',
      requester: { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    });
  });

  it('liefert beim POST /respond einen 403-Fehler fuer Nicht-Reviewer', async () => {
    const { app, routes } = createFakeApp();
    const baseDependencies = buildDependencies();
    const dependencies = buildDependencies({
      storage: {
        ...baseDependencies.storage,
        getApproval: vi.fn().mockResolvedValue({
          id: 'approval-1',
          prdId: 'prd-1',
          requestedBy: 'user-9',
          reviewers: ['reviewer-1'],
          status: 'pending',
        }),
      } as any,
    });
    registerPrdApprovalRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(
      findRoute(routes, 'post', '/api/prds/:id/approval/respond'),
      { approved: true },
      { id: 'prd-1' },
    );
    expect(response.statusCode).toBe(403);
    expect(response.payload).toEqual({ message: 'You are not a reviewer for this PRD' });
    expect((dependencies.storage as any).updateApproval).not.toHaveBeenCalled();
  });

  it('aktualisiert beim POST /respond Approval, PRD-Status und Broadcast', async () => {
    const { app, routes } = createFakeApp();
    const baseDependencies = buildDependencies();
    const dependencies = buildDependencies({
      storage: {
        ...baseDependencies.storage,
        getApproval: vi.fn().mockResolvedValue({
          id: 'approval-1',
          prdId: 'prd-1',
          requestedBy: 'user-9',
          reviewers: ['user-1'],
          status: 'pending',
        }),
        getUser: vi.fn().mockResolvedValue({
          id: 'user-1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
        }),
      } as any,
    });
    registerPrdApprovalRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(
      findRoute(routes, 'post', '/api/prds/:id/approval/respond'),
      { approved: true },
      { id: 'prd-1' },
    );
    expect((dependencies.storage as any).updateApproval).toHaveBeenCalledTimes(1);
    expect((dependencies.storage as any).updatePrd).toHaveBeenCalledWith('prd-1', { status: 'approved' });
    expect(response.payload).toEqual({
      id: 'approval-1',
      prdId: 'prd-1',
      requestedBy: 'user-1',
      reviewers: ['reviewer-1'],
      status: 'approved',
      completedBy: 'reviewer-1',
      completer: { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    });
    expect(dependencies.broadcastPrdUpdate).toHaveBeenCalledWith('prd-1', 'approval:updated');
  });
});