/*
Author: rahn
Datum: 11.03.2026
Version: 1.0
Beschreibung: Gezielte Regressionstests fuer die Persistenz degradierter PRD-Run-Finalisierungen.
*/

// ÄNDERUNG 11.03.2026: Degradierte Final-Inhalte muessen fuer Reopen-Persistenz in `prds`
// gespeichert werden, ohne dabei erfolgreiche `prd_versions`-Snapshots vorzutäuschen.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDb, state } = vi.hoisted(() => {
  const state = {
    currentPrd: {
      id: 'prd-1',
      title: 'Test-PRD',
      description: 'Beschreibung',
      content: 'Alter Inhalt',
      status: 'draft',
      iterationLog: 'altes-log',
      structuredContent: null,
    },
    versionCount: 0,
    lastUpdateData: undefined as Record<string, unknown> | undefined,
    insertedSnapshots: [] as any[],
  };

  const tx = {
    select: vi.fn((selection?: Record<string, unknown>) => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => {
          if (selection && Object.prototype.hasOwnProperty.call(selection, 'count')) {
            return [{ count: state.versionCount }];
          }
          return [state.currentPrd];
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((data: Record<string, unknown>) => {
        state.lastUpdateData = data;
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => [{ ...state.currentPrd, ...data }]),
          })),
        };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (snapshot: any) => {
        state.insertedSnapshots.push(snapshot);
        return snapshot;
      }),
    })),
  };

  return {
    state,
    mockDb: {
      transaction: vi.fn(async (callback: (tx: typeof tx) => Promise<unknown>) => callback(tx)),
    },
  };
});

vi.mock('../server/db', () => ({
  db: mockDb,
  pool: { end: vi.fn() },
}));

import { DatabaseStorage } from '../server/storage';

describe('DatabaseStorage.persistPrdRunFinalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.currentPrd = {
      id: 'prd-1',
      title: 'Test-PRD',
      description: 'Beschreibung',
      content: 'Alter Inhalt',
      status: 'draft',
      iterationLog: 'altes-log',
      structuredContent: null,
    };
    state.versionCount = 0;
    state.lastUpdateData = undefined;
    state.insertedSnapshots = [];
  });

  it('persistiert degradierte finale Inhalte ohne Versionssnapshot', async () => {
    const storage = new DatabaseStorage();
    const struktur = { features: [{ id: 'F-01', name: 'Power-Up-System' }], otherSections: {} } as any;

    const prd = await storage.persistPrdRunFinalization({
      prdId: 'prd-1',
      userId: 'user-1',
      qualityStatus: 'failed_quality',
      finalizationStage: 'final',
      content: '  ## Tetris mit Power-Ups  ',
      structuredContent: struktur,
      iterationLog: 'neues-log',
      compilerDiagnostics: { failureStage: 'compiler_finalization' } as any,
    });

    expect(state.lastUpdateData).toEqual(expect.objectContaining({
      content: '## Tetris mit Power-Ups',
      structuredContent: struktur,
      iterationLog: 'neues-log',
    }));
    expect(state.lastUpdateData?.structuredAt).toBeInstanceOf(Date);
    expect(state.insertedSnapshots).toHaveLength(0);
    expect(prd.content).toBe('## Tetris mit Power-Ups');
    expect((prd as any).structuredContent).toEqual(struktur);
  });

  it('erstellt nur bei final passed weiterhin einen Versionssnapshot', async () => {
    const storage = new DatabaseStorage();
    state.versionCount = 2;

    await storage.persistPrdRunFinalization({
      prdId: 'prd-1',
      userId: 'user-1',
      qualityStatus: 'passed',
      finalizationStage: 'final',
      content: '## Finaler Inhalt',
      structuredContent: null,
    });

    expect(state.lastUpdateData).toEqual(expect.objectContaining({
      content: '## Finaler Inhalt',
      structuredContent: null,
    }));
    expect(state.lastUpdateData?.structuredAt).toBeNull();
    expect(state.insertedSnapshots).toHaveLength(1);
    expect(state.insertedSnapshots[0]).toEqual(expect.objectContaining({
      prdId: 'prd-1',
      versionNumber: 'v3',
      content: '## Finaler Inhalt',
    }));
  });
});