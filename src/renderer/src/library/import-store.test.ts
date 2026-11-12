import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportReport } from '../../../shared/import';
import { emptyTotals, NO_COUNTS } from '../../../shared/import';
import { usePlaylists } from '../playlists/playlist-store';
import { importPaths, useImports } from './import-store';

const path = '/placeholder/Welcome.txt';
const report: ImportReport = {
  id: 'import-1',
  startedAt: '2026-11-12T00:00:00Z',
  finishedAt: '2026-11-12T00:00:01Z',
  status: 'done',
  paths: [path],
  totals: { ...emptyTotals(), files: 1, imported: 1, presentations: 1, slides: 1 },
  message: null,
  items: [
    {
      id: 'report-1',
      sourcePath: path,
      format: 'text',
      outcome: 'imported',
      name: 'Placeholder Welcome',
      target: { kind: 'presentation', id: 'new-presentation' },
      counts: { ...NO_COUNTS, presentations: 1, slides: 1 },
      message: null,
      issues: [],
    },
  ],
};

const addItems = vi.fn();

beforeEach(() => {
  addItems.mockReset().mockResolvedValue({ ok: true, ids: ['item-1'] });
  usePlaylists.setState({ openId: 'playlist-start', items: [], marked: [], tree: [], templates: [] });
  (globalThis as { window?: unknown }).window = {
    drashti: {
      library: {
        importPaths: () => {
          usePlaylists.setState({ openId: 'playlist-opened-later' });
          return Promise.resolve({ ok: true, run: report });
        },
        getImportReport: () => Promise.resolve(report),
      },
      playlists: {
        addItems,
        tree: () => Promise.resolve([{ id: 'playlist-start' }, { id: 'playlist-opened-later' }]),
        templates: () => Promise.resolve([]),
        items: () => Promise.resolve([]),
      },
    },
  };
});

describe('importing from the library or window', () => {
  it('adds to the playlist open when the import began, even if another is opened', async () => {
    await importPaths([path]);

    expect(addItems).toHaveBeenCalledExactlyOnceWith('playlist-start', null, [
      { kind: 'presentation', presentationId: 'new-presentation' },
    ]);
    expect(usePlaylists.getState().openId).toBe('playlist-opened-later');
  });

  it('does not open a report when there is nothing live', async () => {
    await importPaths([path]);

    expect(Object.hasOwn(useImports.getState(), 'report')).toBe(false);
  });
});
