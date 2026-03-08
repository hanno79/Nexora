/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Registriert PRD-Share-Routen als kleines Modul.
*/

// ÄNDERUNG 08.03.2026: Share-Routen aus `server/routes.ts` extrahiert,
// um die Hauptdatei konservativ weiter zu verkleinern.

import type { Request, RequestHandler } from 'express';
import { asyncHandler } from './asyncHandler';
import { requirePrdAccess } from './prdAccess';
import { canShareWithUser, planShareAction } from './sharePolicy';
import { sharePrdSchema } from './schemas';
import type { IStorage } from './storage';

type AuthenticatedRequest = Request & {
  user: {
    claims: {
      sub: string;
    };
  };
};

type RequestHandlerRegistrar = (path: string, ...handlers: RequestHandler[]) => unknown;
type RouteRegistrar = Pick<{ [K in 'get' | 'post']: RequestHandlerRegistrar }, 'get' | 'post'>;
type PrdShareStorage = Pick<
  IStorage,
  'getPrd' | 'getPrdShares' | 'getUserByEmail' | 'createSharedPrd' | 'updateSharedPrdPermission'
>;

export interface PrdShareRouteDependencies {
  storage: PrdShareStorage;
  requirePrdAccess: typeof requirePrdAccess;
}

export function registerPrdShareRoutes(
  app: RouteRegistrar,
  isAuthenticated: RequestHandler,
  deps: PrdShareRouteDependencies,
): void {
  app.post('/api/prds/:id/share', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const { email, permission } = sharePrdSchema.parse(req.body);
    const userId = req.user.claims.sub;
    const prd = await deps.storage.getPrd(id);

    if (!prd) {
      return res.status(404).json({ message: 'PRD not found' });
    }

    if (prd.userId !== userId) {
      return res.status(403).json({ message: 'Only the owner can share this PRD' });
    }

    const sharedUser = await deps.storage.getUserByEmail(email);
    if (!sharedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!canShareWithUser(userId, sharedUser.id)) {
      return res.status(400).json({ message: 'You cannot share a PRD with yourself' });
    }

    const requestedPermission: 'view' | 'edit' = permission === 'edit' ? 'edit' : 'view';
    const existingShares = await deps.storage.getPrdShares(id);
    const existingShare = existingShares.find((share) => share.sharedWith === sharedUser.id);
    const action = planShareAction(existingShare, requestedPermission);

    if (action.type === 'none' && existingShare) {
      return res.json(existingShare);
    }

    if (action.type === 'update') {
      const updatedShare = await deps.storage.updateSharedPrdPermission(action.shareId, action.permission);
      return res.json(updatedShare);
    }

    const share = await deps.storage.createSharedPrd({
      prdId: id,
      sharedWith: sharedUser.id,
      permission: requestedPermission,
    });

    res.json(share);
  }));

  app.get('/api/prds/:id/shares', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const prd = await deps.requirePrdAccess(deps.storage, req, res, id, 'view');
    if (!prd) {
      return;
    }

    const shares = await deps.storage.getPrdShares(id);
    res.json(shares);
  }));
}