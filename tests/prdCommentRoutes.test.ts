/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Gezielte Regressionstests fuer ausgelagerte PRD-Kommentar-Routen.
*/

// ÄNDERUNG 08.03.2026: Regressionen fuer Kommentar-Routen ergaenzt.

import { describe, expect, it, vi } from 'vitest';
import {
  createFakeApp,
  findRoute,
  invokeRoute,
  PASS_THROUGH_AUTH,
} from './helpers/routeTestUtils';
import {
  registerPrdCommentRoutes,
  type PrdCommentRouteDependencies,
} from '../server/prdCommentRoutes';

function buildDependencies(overrides: Partial<PrdCommentRouteDependencies> = {}): PrdCommentRouteDependencies {
  return {
    storage: {
      getPrd: vi.fn().mockResolvedValue({ id: 'prd-1', userId: 'user-9' }),
      getPrdShares: vi.fn().mockResolvedValue([]),
      getComments: vi.fn().mockResolvedValue([]),
      createComment: vi.fn().mockResolvedValue({ id: 'comment-1', prdId: 'prd-1', userId: 'user-1', content: 'Hallo', sectionId: null }),
      getUser: vi.fn().mockResolvedValue({
        id: 'user-1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        profileImageUrl: 'https://example.com/ada.png',
      }),
    } as any,
    requirePrdAccess: vi.fn().mockResolvedValue({ id: 'prd-1', userId: 'user-9' }),
    loadUsersByIds: vi.fn().mockResolvedValue([]),
    broadcastPrdUpdate: vi.fn(),
    ...overrides,
  };
}


describe('registerPrdCommentRoutes', () => {
  it('liefert beim GET Kommentare mit angereicherten Benutzerdaten zurueck', async () => {
    const { app, routes } = createFakeApp();
    const comments = [
      { id: 'comment-1', userId: 'user-2', content: 'Erster Kommentar' },
      { id: 'comment-2', userId: 'user-2', content: 'Zweiter Kommentar' },
      { id: 'comment-3', userId: 'user-3', content: 'Dritter Kommentar' },
    ];
    const dependencies = buildDependencies({
      storage: { ...buildDependencies().storage, getComments: vi.fn().mockResolvedValue(comments) } as any,
      loadUsersByIds: vi.fn().mockResolvedValue([
        { id: 'user-2', firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com', profileImageUrl: null },
        { id: 'user-3', firstName: 'Katherine', lastName: 'Johnson', email: 'kj@example.com', profileImageUrl: 'https://example.com/kj.png' },
      ]),
    });
    registerPrdCommentRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(findRoute(routes, 'get', '/api/prds/:id/comments'), {}, { id: 'prd-1' });
    expect(dependencies.loadUsersByIds).toHaveBeenCalledWith(['user-2', 'user-3']);
    expect(response.payload).toEqual([
      {
        id: 'comment-1',
        userId: 'user-2',
        content: 'Erster Kommentar',
        user: { id: 'user-2', firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com', profileImageUrl: null },
      },
      {
        id: 'comment-2',
        userId: 'user-2',
        content: 'Zweiter Kommentar',
        user: { id: 'user-2', firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com', profileImageUrl: null },
      },
      {
        id: 'comment-3',
        userId: 'user-3',
        content: 'Dritter Kommentar',
        user: { id: 'user-3', firstName: 'Katherine', lastName: 'Johnson', email: 'kj@example.com', profileImageUrl: 'https://example.com/kj.png' },
      },
    ]);
  });

  it('liefert beim POST fuer leeren Kommentarinhalt einen 400-Fehler', async () => {
    const { app, routes } = createFakeApp();
    const dependencies = buildDependencies();
    registerPrdCommentRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(findRoute(routes, 'post', '/api/prds/:id/comments'), { content: '   ' }, { id: 'prd-1' });
    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({
      message: 'Validation error',
      errors: [
        expect.objectContaining({
          message: 'Comment content is required',
          path: ['content'],
        }),
      ],
    });
    expect((dependencies.storage as any).createComment).not.toHaveBeenCalled();
  });

  it('erstellt beim POST einen Kommentar mit User-Anreicherung und Null-Section', async () => {
    const { app, routes } = createFakeApp();
    const dependencies = buildDependencies();
    registerPrdCommentRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(findRoute(routes, 'post', '/api/prds/:id/comments'), { content: 'Neuer Kommentar' }, { id: 'prd-1' });

    expect((dependencies.storage as any).createComment).toHaveBeenCalledWith({
      prdId: 'prd-1',
      userId: 'user-1',
      content: 'Neuer Kommentar',
      sectionId: null,
    });
    expect(response.payload).toEqual({
      id: 'comment-1',
      prdId: 'prd-1',
      userId: 'user-1',
      content: 'Hallo',
      sectionId: null,
      user: {
        id: 'user-1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        profileImageUrl: 'https://example.com/ada.png',
      },
    });
  });

  it('sendet nach erfolgreichem POST ein Kommentar-Broadcast-Event', async () => {
    const { app, routes } = createFakeApp();
    const dependencies = buildDependencies();
    registerPrdCommentRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    await invokeRoute(findRoute(routes, 'post', '/api/prds/:id/comments'), { content: 'Event bitte senden' }, { id: 'prd-1' });
    expect(dependencies.broadcastPrdUpdate).toHaveBeenCalledWith('prd-1', 'comment:added');
  });
});