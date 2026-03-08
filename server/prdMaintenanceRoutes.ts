/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Registriert PRD-Export-, Restore- und Structure-Routen als kleines Modul.
*/

// ÄNDERUNG 08.03.2026: PRD-Maintenance-Routen aus `server/routes.ts` extrahiert,
// um die Hauptdatei konservativ zu verkleinern und das Laufzeitverhalten beizubehalten.

import type { Request, RequestHandler } from 'express';
import { asyncHandler } from './asyncHandler';
import { generatePDF, generateWord } from './exportUtils';
import { generateClaudeMD } from './claudemdGenerator';
import { parsePRDToStructure } from './prdParser';
import { computeCompleteness } from './prdCompleteness';
import { requirePrdAccess } from './prdAccess';
import { getNextPrdVersionNumber } from './prdVersioningUtils';
import { broadcastPrdUpdate } from './wsServer';
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
type PrdMaintenanceStorage = Pick<
  IStorage,
  'getPrd' | 'getPrdShares' | 'getPrdVersions' | 'updatePrd' | 'getPrdWithStructure' | 'updatePrdStructure'
>;
type SyncPrdHeaderMetadata = (content: string, versionNumber: string | null, status: string) => string;

export interface PrdMaintenanceRouteDependencies {
  storage: PrdMaintenanceStorage;
  generateClaudeMD: typeof generateClaudeMD;
  generatePDF: typeof generatePDF;
  generateWord: typeof generateWord;
  requirePrdAccess: typeof requirePrdAccess;
  getNextPrdVersionNumber: typeof getNextPrdVersionNumber;
  syncPrdHeaderMetadata: SyncPrdHeaderMetadata;
  parsePRDToStructure: typeof parsePRDToStructure;
  computeCompleteness: typeof computeCompleteness;
  broadcastPrdUpdate: typeof broadcastPrdUpdate;
}

type ExportablePrd = {
  title: string;
  description: string | null;
  content: string;
};

export function buildMarkdownExportContent(prd: ExportablePrd): string {
  return `# ${prd.title}\n\n${prd.description || ''}\n\n---\n\n${prd.content}`;
}

function buildDownloadFilename(title: string, extension: 'pdf' | 'docx'): string {
  return `${title.replace(/\s+/g, '-')}.${extension}`;
}

export function registerPrdMaintenanceRoutes(
  app: RouteRegistrar,
  isAuthenticated: RequestHandler,
  deps: PrdMaintenanceRouteDependencies,
): void {
  app.post('/api/prds/:id/export', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { format } = req.body;
    const { id } = req.params;
    const prd = await deps.requirePrdAccess(deps.storage, req, res, id, 'view');
    if (!prd) {
      return;
    }

    if (format === 'markdown') {
      return res.json({ content: buildMarkdownExportContent(prd) });
    }

    if (format === 'claudemd') {
      const claudemd = deps.generateClaudeMD({
        title: prd.title,
        description: prd.description || undefined,
        content: prd.content,
      });
      return res.json({ content: claudemd.content });
    }

    if (format === 'pdf') {
      const pdfBuffer = await deps.generatePDF({
        title: prd.title,
        description: prd.description || undefined,
        content: prd.content,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${buildDownloadFilename(prd.title, 'pdf')}"`);
      return res.send(pdfBuffer);
    }

    if (format === 'word') {
      const wordBuffer = await deps.generateWord({
        title: prd.title,
        description: prd.description || undefined,
        content: prd.content,
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${buildDownloadFilename(prd.title, 'docx')}"`);
      return res.send(wordBuffer);
    }

    return res.status(400).json({ message: 'Unsupported export format' });
  }));

  app.post('/api/prds/:id/restore/:versionId', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id: prdId, versionId } = req.params;
    const prd = await deps.requirePrdAccess(deps.storage, req, res, prdId, 'edit');
    if (!prd) {
      return;
    }

    const versions = await deps.storage.getPrdVersions(prdId);
    const version = versions.find((candidate) => candidate.id === versionId);
    if (!version) {
      return res.status(404).json({ message: 'Version not found' });
    }

    const newVersionNumber = deps.getNextPrdVersionNumber(versions.length);
    const status = version.status as 'draft' | 'in-progress' | 'review' | 'pending-approval' | 'approved' | 'completed';
    const syncedContent = deps.syncPrdHeaderMetadata(version.content, newVersionNumber, status);
    const hasStructuredContent = Boolean((version as any).structuredContent);

    const updatedPrd = await deps.storage.updatePrd(prdId, {
      title: version.title,
      description: version.description,
      content: syncedContent,
      structuredContent: (version as any).structuredContent || null,
      structuredAt: hasStructuredContent ? new Date() : null,
      status,
    } as any);

    res.json(updatedPrd);
    deps.broadcastPrdUpdate(prdId, 'prd:updated');
  }));

  app.get('/api/prds/:id/structure', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const accessPrd = await deps.requirePrdAccess(deps.storage, req, res, id, 'view');
    if (!accessPrd) {
      return;
    }

    const { prd, structure } = await deps.storage.getPrdWithStructure(id);
    if (!structure) {
      return res.status(404).json({ message: 'No structured content available' });
    }

    const source = (prd as any).structuredContent ? 'stored' : 'parsed';
    res.json({
      structure,
      source,
      structuredAt: (prd as any).structuredAt,
      completeness: deps.computeCompleteness(structure),
    });
  }));

  app.post('/api/prds/:id/reparse', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const prd = await deps.requirePrdAccess(deps.storage, req, res, id, 'edit');
    if (!prd) {
      return;
    }

    const structure = deps.parsePRDToStructure(prd.content);
    await deps.storage.updatePrdStructure(id, structure);

    res.json({
      featureCount: structure.features.length,
      completeness: deps.computeCompleteness(structure),
    });
  }));

  app.get('/api/prds/:id/completeness', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const prd = await deps.requirePrdAccess(deps.storage, req, res, id, 'view');
    if (!prd) {
      return;
    }

    const { structure } = await deps.storage.getPrdWithStructure(id);
    if (!structure) {
      return res.status(404).json({ message: 'No structured content available for completeness check' });
    }

    res.json(deps.computeCompleteness(structure));
  }));
}