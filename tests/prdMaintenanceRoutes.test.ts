/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Gezielte Regressionstests fuer ausgelagerte PRD-Maintenance-Routen.
*/

// ÄNDERUNG 08.03.2026: Regressionen fuer Export-, Restore- und Structure-Routen ergaenzt.

import { describe, expect, it, vi } from 'vitest';
import {
  createFakeApp,
  findRoute,
  invokeRoute,
  PASS_THROUGH_AUTH,
} from './helpers/routeTestUtils';
import {
  buildDownloadFilename,
  buildMarkdownExportContent,
  registerPrdMaintenanceRoutes,
  type PrdMaintenanceRouteDependencies,
} from '../server/prdMaintenanceRoutes';

function buildDependencies(overrides: Partial<PrdMaintenanceRouteDependencies> = {}): PrdMaintenanceRouteDependencies {
  return {
    storage: {
      getPrd: vi.fn(),
      getPrdShares: vi.fn().mockResolvedValue([]),
      getPrdVersions: vi.fn().mockResolvedValue([]),
      updatePrd: vi.fn().mockResolvedValue({ id: 'prd-1' }),
      getPrdWithStructure: vi.fn().mockResolvedValue({
        prd: { structuredContent: { sections: [] }, structuredAt: '2026-03-08T00:00:00.000Z' },
        structure: { features: [{ id: 'feature-1' }] },
      }),
      updatePrdStructure: vi.fn().mockResolvedValue({ id: 'prd-1' }),
    } as any,
    generateClaudeMD: vi.fn().mockReturnValue({ content: 'CLAUDEMD-INHALT' }),
    generatePDF: vi.fn().mockResolvedValue(Buffer.from('pdf')),
    generateWord: vi.fn().mockResolvedValue(Buffer.from('word')),
    requirePrdAccess: vi.fn().mockResolvedValue({
      id: 'prd-1',
      title: 'Exporttitel',
      description: 'Kurzbeschreibung',
      content: 'PRD-Inhalt',
      status: 'draft',
    }),
    getNextPrdVersionNumber: vi.fn().mockReturnValue('v3'),
    syncPrdHeaderMetadata: vi.fn().mockReturnValue('Synchronisierter Inhalt'),
    parsePRDToStructure: vi.fn().mockReturnValue({ features: [{ id: 'feature-1' }, { id: 'feature-2' }] } as any),
    computeCompleteness: vi.fn().mockReturnValue({ score: 88, missingSections: [] }),
    broadcastPrdUpdate: vi.fn(),
    ...overrides,
  };
}


describe('prdMaintenanceRoutes Helfer', () => {
  it('baut den Markdown-Exportinhalt aus PRD-Daten auf', () => {
    expect(buildMarkdownExportContent({
      title: 'Titel',
      description: 'Beschreibung',
      content: 'Inhalt',
    })).toBe('# Titel\n\nBeschreibung\n\n---\n\nInhalt');
  });

  it('bereinigt ungueltige Zeichen im Download-Dateinamen', () => {
    expect(buildDownloadFilename('  Projekt / Alpha: Beta*?"<>| \u0000 2026  ', 'pdf')).toBe('Projekt-Alpha-Beta-2026.pdf');
  });

  it('verwendet fuer leere bereinigte Titel einen sicheren Fallback', () => {
    expect(buildDownloadFilename(' /:*?"<>|\u0000 ', 'docx')).toBe('download.docx');
  });

  it('begrenzt die Laenge des Dateinamens vor der Erweiterung', () => {
    const filename = buildDownloadFilename('a'.repeat(200), 'pdf');
    expect(filename).toBe(`${'a'.repeat(120)}.pdf`);
  });
});

describe('registerPrdMaintenanceRoutes', () => {
  it('liefert bei unbekanntem Exportformat einen 400-Fehler', async () => {
    const { app, routes } = createFakeApp();
    registerPrdMaintenanceRoutes(app as any, PASS_THROUGH_AUTH, buildDependencies());

    const response = await invokeRoute(findRoute(routes, 'post', '/api/prds/:id/export'), { format: 'xlsx' }, { id: 'prd-1' });
    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'Unsupported export format' });
  });

  it('stellt beim Restore Inhalt, Struktur und Status aus der Version wieder her', async () => {
    const { app, routes } = createFakeApp();
    const storage = {
      getPrd: vi.fn(),
      getPrdShares: vi.fn().mockResolvedValue([]),
      getPrdVersions: vi.fn().mockResolvedValue([
        {
          id: 'version-1',
          title: 'Wiederhergestellter Titel',
          description: 'Wiederhergestellte Beschreibung',
          content: 'Alter Inhalt',
          status: 'approved',
          structuredContent: { features: [{ id: 'feature-old' }] },
        },
      ]),
      updatePrd: vi.fn().mockResolvedValue({ id: 'prd-1', title: 'Wiederhergestellter Titel' }),
      getPrdWithStructure: vi.fn(),
      updatePrdStructure: vi.fn(),
    };
    const dependencies = buildDependencies({ storage: storage as any });
    registerPrdMaintenanceRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(
      findRoute(routes, 'post', '/api/prds/:id/restore/:versionId'),
      {},
      { id: 'prd-1', versionId: 'version-1' },
    );

    expect(response.statusCode).toBe(200);
    expect(dependencies.syncPrdHeaderMetadata).toHaveBeenCalledWith('Alter Inhalt', 'v3', 'approved');
    expect(storage.updatePrd).toHaveBeenCalledWith('prd-1', expect.objectContaining({
      title: 'Wiederhergestellter Titel',
      description: 'Wiederhergestellte Beschreibung',
      content: 'Synchronisierter Inhalt',
      structuredContent: { features: [{ id: 'feature-old' }] },
      status: 'approved',
    }));
    expect(dependencies.broadcastPrdUpdate).toHaveBeenCalledWith('prd-1', 'prd:updated');
  });

  it('parsed PRD-Inhalt neu und gibt Feature-Anzahl sowie Vollstaendigkeit zurueck', async () => {
    const { app, routes } = createFakeApp();
    const dependencies = buildDependencies();
    registerPrdMaintenanceRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(findRoute(routes, 'post', '/api/prds/:id/reparse'), {}, { id: 'prd-1' });

    expect((dependencies.storage as any).updatePrdStructure).toHaveBeenCalledWith('prd-1', { features: [{ id: 'feature-1' }, { id: 'feature-2' }] });
    expect(response.payload).toEqual({
      featureCount: 2,
      completeness: { score: 88, missingSections: [] },
    });
  });

  it('liefert fuer Completeness ohne vorhandene Struktur einen 404-Fehler', async () => {
    const { app, routes } = createFakeApp();
    const storage = {
      getPrd: vi.fn(),
      getPrdShares: vi.fn().mockResolvedValue([]),
      getPrdVersions: vi.fn(),
      updatePrd: vi.fn(),
      getPrdWithStructure: vi.fn().mockResolvedValue({ prd: { structuredContent: null, structuredAt: null }, structure: null }),
      updatePrdStructure: vi.fn(),
    };
    const dependencies = buildDependencies({ storage: storage as any });
    registerPrdMaintenanceRoutes(app as any, PASS_THROUGH_AUTH, dependencies);

    const response = await invokeRoute(findRoute(routes, 'get', '/api/prds/:id/completeness'), {}, { id: 'prd-1' });
    expect(response.statusCode).toBe(404);
    expect(response.payload).toEqual({ message: 'No structured content available for completeness check' });
  });
});