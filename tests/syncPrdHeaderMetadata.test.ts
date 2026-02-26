import { beforeAll, describe, it, expect } from 'vitest';

let syncPrdHeaderMetadata: (content: string, versionNumber: string | null, status: string) => string;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "postgresql://nexora:nexora@localhost:5432/nexora";
  }

  ({ syncPrdHeaderMetadata } = await import('../server/routes'));
});

describe('syncPrdHeaderMetadata', () => {
  // The regex expects **Status**: (colon OUTSIDE bold) or plain Status:
  const baseContent = [
    '# My PRD',
    '',
    'Version: 1.0',
    'Status: Draft',
    '',
    '## Features',
    'Some content here.',
  ].join('\n');

  it('updates version number in content', () => {
    const result = syncPrdHeaderMetadata(baseContent, 'v3', 'draft');
    expect(result).toContain('Version: v3');
    expect(result).not.toContain('Version: 1.0');
  });

  it('updates status to in-progress (English)', () => {
    const result = syncPrdHeaderMetadata(baseContent, null, 'in-progress');
    expect(result).toContain('Status: In Progress');
    expect(result).not.toContain('Status: Draft');
  });

  it('does not change version when versionNumber is null', () => {
    const result = syncPrdHeaderMetadata(baseContent, null, 'draft');
    expect(result).toContain('Version: 1.0');
  });

  it('handles German document with German status values', () => {
    const germanContent = [
      '# Mein PRD',
      '',
      'Version: 1.0',
      'Status: Entwurf',
      '',
      '## Funktionen',
    ].join('\n');

    const result = syncPrdHeaderMetadata(germanContent, 'v2', 'completed');
    expect(result).toContain('Status: Abgeschlossen');
    expect(result).toContain('Version: v2');
  });

  it('handles all valid statuses for English content', () => {
    const statuses: Record<string, string> = {
      'draft': 'Draft',
      'in-progress': 'In Progress',
      'review': 'Review',
      'pending-approval': 'Pending Approval',
      'approved': 'Approved',
      'completed': 'Completed',
    };

    for (const [key, display] of Object.entries(statuses)) {
      const result = syncPrdHeaderMetadata(baseContent, null, key);
      expect(result).toContain(`Status: ${display}`);
    }
  });

  it('preserves content outside of version/status fields', () => {
    const result = syncPrdHeaderMetadata(baseContent, 'v5', 'approved');
    expect(result).toContain('# My PRD');
    expect(result).toContain('## Features');
    expect(result).toContain('Some content here.');
  });

  it('handles content without version/status fields', () => {
    const noMetaContent = '## Features\nJust content.';
    const result = syncPrdHeaderMetadata(noMetaContent, 'v2', 'draft');
    expect(result).toBe(noMetaContent);
  });

  it('handles bold markers with colon outside (Markdown pattern)', () => {
    const boldContent = '**Version**: 2.0\n**Status**: Draft\n\nContent';
    const result = syncPrdHeaderMetadata(boldContent, 'v4', 'review');
    expect(result).toContain('**Version**: v4');
    expect(result).toContain('**Status**: Review');
  });

  it('handles unknown status gracefully', () => {
    const result = syncPrdHeaderMetadata(baseContent, null, 'unknown-status');
    // Unknown status falls back to raw string
    expect(result).toContain('Status: unknown-status');
  });

  it('updates both version and status simultaneously', () => {
    const result = syncPrdHeaderMetadata(baseContent, 'v10', 'completed');
    expect(result).toContain('Version: v10');
    expect(result).toContain('Status: Completed');
  });
});
