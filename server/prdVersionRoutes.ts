/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Registriert PRD-Versionsrouten als kleines Modul.
*/

// ÄNDERUNG 08.03.2026: Versionsrouten aus `server/routes.ts` extrahiert,
// um die Hauptdatei konservativ weiter zu verkleinern.

import type { Request, RequestHandler } from 'express';
import { asyncHandler } from './asyncHandler';
import { requirePrdAccess } from './prdAccess';
import {
  buildPrdVersionSnapshot,
  getNextPrdVersionNumber,
  type PrdVersionSnapshotSource,
} from './prdVersioningUtils';
import type { IStorage } from './storage';

type AuthenticatedRequest = Request & {
  user: {
    claims: {
      sub: string;
    };
  };
};

type RequestHandlerRegistrar = (path: string, ...handlers: RequestHandler[]) => unknown;
type RouteRegistrar = Pick<{ [K in 'get' | 'post' | 'delete']: RequestHandlerRegistrar }, 'get' | 'post' | 'delete'>;
type PrdVersionStorage = Pick<
  IStorage,
  'getPrd' | 'getPrdShares' | 'getPrdVersions' | 'createPrdVersion' | 'getPrdVersion' | 'deletePrdVersion'
>;
type PrdVersionAccessHandler = (...args: Parameters<typeof requirePrdAccess>) => Promise<PrdVersionSnapshotSource | null>;
type BuildPrdVersionSnapshotHandler = (
  prd: PrdVersionSnapshotSource,
  versionNumber: string,
  createdBy: string,
) => ReturnType<typeof buildPrdVersionSnapshot>;

export interface PrdVersionRouteDependencies {
  storage: PrdVersionStorage;
  requirePrdAccess: PrdVersionAccessHandler;
  getNextPrdVersionNumber: typeof getNextPrdVersionNumber;
  buildPrdVersionSnapshot: BuildPrdVersionSnapshotHandler;
}

function isVersionConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined;
  return code === '23505'
    || status === 409
    || /unique|duplicate|conflict/i.test(message);
}

export function registerPrdVersionRoutes(
  app: RouteRegistrar,
  isAuthenticated: RequestHandler,
  deps: PrdVersionRouteDependencies,
): void {
  app.get('/api/prds/:id/versions', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const prd = await deps.requirePrdAccess(deps.storage, req, res, id, 'view');
    if (!prd) {
      return;
    }

    const versions = await deps.storage.getPrdVersions(id);
    res.json(versions);
  }));

  app.post('/api/prds/:id/versions', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const userId = req.user.claims.sub;
    const prd = await deps.requirePrdAccess(deps.storage, req, res, id, 'edit');
    if (!prd) {
      return;
    }

    const MAX_VERSION_CREATE_RETRIES = 3;
    let version = null;

    for (let attempt = 0; attempt < MAX_VERSION_CREATE_RETRIES; attempt++) {
      try {
        const versions = await deps.storage.getPrdVersions(id);
        const versionNumber = deps.getNextPrdVersionNumber(versions.length);
        version = await deps.storage.createPrdVersion(
          deps.buildPrdVersionSnapshot(prd, versionNumber, userId),
        );
        break;
      } catch (error) {
        if (attempt < MAX_VERSION_CREATE_RETRIES - 1 && isVersionConflictError(error)) {
          continue;
        }
        throw error;
      }
    }

    if (!version) {
      throw new Error('Failed to create PRD version after retrying version conflicts.');
    }

    res.json(version);
  }));

  app.delete('/api/prds/:id/versions/:versionId', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id, versionId } = req.params;
    const prd = await deps.requirePrdAccess(deps.storage, req, res, id, 'edit');
    if (!prd) {
      return;
    }

    const version = await deps.storage.getPrdVersion(versionId);
    if (!version) {
      return res.status(404).json({ message: 'Version not found' });
    }

    if (version.prdId !== id) {
      return res.status(400).json({ message: 'Version does not belong to this PRD' });
    }

    const versions = await deps.storage.getPrdVersions(id);
    if (versions.length > 0 && versions[0].id === versionId) {
      return res.status(400).json({ message: 'Cannot delete the current (latest) version' });
    }

    await deps.storage.deletePrdVersion(versionId);
    res.json({ success: true });
  }));
}
