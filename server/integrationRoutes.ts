/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Registriert Linear- und Dart-Integrationsrouten fuer Export, Status und Dokument-Updates.
*/

// ÄNDERUNG 08.03.2026: Linear-/Dart-Routen aus `server/routes.ts` extrahiert,
// um die Hauptdatei konservativ zu verkleinern und das Laufzeitverhalten beizubehalten.

import type { Request, RequestHandler } from 'express';
import { asyncHandler } from './asyncHandler';
import { exportToLinear, checkLinearConnection } from './linearHelper';
import { exportToDart, updateDartDoc, checkDartConnection, getDartboards } from './dartHelper';
import { isDartDocUpdateConsistent, normalizeDartDocId } from './dartDocAccess';
import { requireEditablePrdId } from './prdAccess';
import { storage, type IStorage } from './storage';

type AuthenticatedRequest = Request & {
  user: {
    claims: {
      sub: string;
    };
  };
};

type RouteRegistrar = Pick<{ [K in 'get' | 'post' | 'put']: RequestHandlerRegistrar }, 'get' | 'post' | 'put'>;
type RequestHandlerRegistrar = (path: string, ...handlers: RequestHandler[]) => unknown;
type IntegrationStorage = Pick<IStorage, 'getPrd' | 'getPrdShares' | 'updatePrd'>;

export interface IntegrationRouteDependencies {
  storage: IntegrationStorage;
  exportToLinear: typeof exportToLinear;
  checkLinearConnection: typeof checkLinearConnection;
  getDartboards: typeof getDartboards;
  exportToDart: typeof exportToDart;
  checkDartConnection: typeof checkDartConnection;
  updateDartDoc: typeof updateDartDoc;
  requireEditablePrdId: typeof requireEditablePrdId;
  normalizeDartDocId: typeof normalizeDartDocId;
  isDartDocUpdateConsistent: typeof isDartDocUpdateConsistent;
}

const DEFAULT_DEPENDENCIES: IntegrationRouteDependencies = {
  storage,
  exportToLinear,
  checkLinearConnection,
  getDartboards,
  exportToDart,
  checkDartConnection,
  updateDartDoc,
  requireEditablePrdId,
  normalizeDartDocId,
  isDartDocUpdateConsistent,
};

type LinearExportResult = Awaited<ReturnType<typeof exportToLinear>>;
type DartExportResult = Awaited<ReturnType<typeof exportToDart>>;

export function buildLinearPrdUpdate(result: Pick<LinearExportResult, 'issueId' | 'url'>) {
  return {
    linearIssueId: result.issueId,
    linearIssueUrl: result.url,
  };
}

export function buildDartPrdUpdate(result: Pick<DartExportResult, 'docId' | 'url' | 'folder'>) {
  return {
    dartDocId: result.docId,
    dartDocUrl: result.url,
    dartFolder: result.folder,
  };
}

export function registerIntegrationRoutes(
  app: RouteRegistrar,
  isAuthenticated: RequestHandler,
  deps: IntegrationRouteDependencies = DEFAULT_DEPENDENCIES,
): void {
  app.post('/api/linear/export', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { prdId, title, description } = req.body;

    if (!title) {
      return res.status(400).json({ message: 'Title is required' });
    }

    const editablePrdId = await deps.requireEditablePrdId(deps.storage, req, res, prdId, {
      required: true,
      requiredMessage: 'Title and PRD ID are required',
      invalidMessage: 'PRD ID must be a non-empty string',
    });
    if (!editablePrdId) {
      return;
    }

    const result = await deps.exportToLinear(title, description || '');
    await deps.storage.updatePrd(editablePrdId, buildLinearPrdUpdate(result));
    res.json(result);
  }));

  app.get('/api/linear/status', isAuthenticated, asyncHandler(async (_req: AuthenticatedRequest, res) => {
    const connected = await deps.checkLinearConnection();
    res.json({ connected });
  }));

  app.get('/api/dart/dartboards', isAuthenticated, asyncHandler(async (_req: AuthenticatedRequest, res) => {
    const result = await deps.getDartboards();
    res.json(result);
  }));

  app.post('/api/dart/export', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { prdId, title, content, folder } = req.body;

    if (!title) {
      return res.status(400).json({ message: 'Title is required' });
    }

    const editablePrdId = await deps.requireEditablePrdId(deps.storage, req, res, prdId, {
      required: true,
      requiredMessage: 'Title and PRD ID are required',
      invalidMessage: 'PRD ID must be a non-empty string',
    });
    if (!editablePrdId) {
      return;
    }

    const result = await deps.exportToDart(title, content || '', folder);
    await deps.storage.updatePrd(editablePrdId, buildDartPrdUpdate(result));
    res.json(result);
  }));

  app.get('/api/dart/status', isAuthenticated, asyncHandler(async (_req: AuthenticatedRequest, res) => {
    const connected = await deps.checkDartConnection();
    res.json({ connected });
  }));

  app.put('/api/dart/update', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { prdId, docId, title, content } = req.body;
    const normalizedDocId = deps.normalizeDartDocId(docId);

    if (!normalizedDocId) {
      return res.status(400).json({ message: 'Document ID and PRD ID are required' });
    }

    const editablePrdId = await deps.requireEditablePrdId(deps.storage, req, res, prdId, {
      required: true,
      requiredMessage: 'Document ID and PRD ID are required',
      invalidMessage: 'PRD ID must be a non-empty string',
    });
    if (!editablePrdId) {
      return;
    }

    const prd = await deps.storage.getPrd(editablePrdId);
    if (!prd) {
      return res.status(404).json({ message: 'PRD not found' });
    }

    if (!deps.isDartDocUpdateConsistent(prd.dartDocId, normalizedDocId)) {
      return res.status(409).json({ message: "Dart document ID does not match the PRD's linked document" });
    }

    const result = await deps.updateDartDoc(normalizedDocId, title || 'Untitled', content || '');
    await deps.storage.updatePrd(editablePrdId, {
      dartDocId: normalizedDocId,
      dartDocUrl: result.url,
    });
    res.json(result);
  }));
}
