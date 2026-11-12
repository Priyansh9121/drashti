import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportReport } from '../../../shared/import';
import { emptyTotals, NO_COUNTS } from '../../../shared/import';
import { usePlaylists } from '../playlists/playlist-store';
import { importPaths, importWithDialog } from './import-store';

/*
 * Where the library's own ways in put what they bring (Q57-11, the owner, 12 Nov 2026): the library list's drop place
 * and its Import… (Files…, A Folder…) into the library only, never the open playlist, so the old program's library
 * folder or many presentations brought in there don't fill it. Every other way in (the window, a playlist, From a
 * Link, the Drop Folder) still adds to the open playlist too. Placeholder paths only.
 */

const FILE = '/placeholder/Welcome.txt';
const FOLDER = '/placeholder/Week 1';

/** The report of an import of `paths` that made one presentation from `source`. */
const reportOf = (paths: string[], source: string): ImportReport => ({
  id: 'import-1',
  startedAt: '2026-11-12T00:00:00Z',
  finishedAt: '2026-11-12T00:00:01Z',
  status: 'done',
  paths,
  totals: { ...emptyTotals(), files: 1, imported: 1, presentations: 1, slides: 1 },
  message: null,
  items: [
    {
      id: 'report-1',
      sourcePath: source,
      format: 'text',
      outcome: 'imported',
      name: 'Placeholder Welcome',
      target: { kind: 'presentation', id: 'new-presentation' },
      counts: { ...NO_COUNTS, presentations: 1, slides: 1 },
      message: null,
      issues: [],
    },
  ],
});

const addItems = vi.fn();
/** What each import was asked to bring in. */
const imported: string[][] = [];

beforeEach(() => {
  addItems.mockReset().mockResolvedValue({ ok: true, ids: ['item-1'] });
  imported.length = 0;
  usePlaylists.setState({ openId: 'playlist-open', items: [], marked: [], tree: [], templates: [] });
  let report: ImportReport | null = null;
  (globalThis as { window?: unknown }).window = {
    drashti: {
      library: {
        // The system's dialog: a file, or a folder with a file in it.
        pickImportPaths: (kind: 'files' | 'folder') => Promise.resolve(kind === 'folder' ? [FOLDER] : [FILE]),
        importPaths: (paths: string[]) => {
          imported.push(paths);
          report = reportOf(paths, paths[0] === FOLDER ? `${FOLDER}/Welcome.txt` : FILE);
          return Promise.resolve({ ok: true, run: report });
        },
        getImportReport: () => Promise.resolve(report),
      },
      playlists: {
        addItems,
        tree: () => Promise.resolve([{ id: 'playlist-open' }]),
        templates: () => Promise.resolve([]),
        items: () => Promise.resolve([]),
      },
    },
  };
});

describe('the library’s own ways in bring files into the library only (Q57-11)', () => {
  it.each(['files', 'folder'] as const)(
    'its Import… (%s): imported, and nothing added to the open playlist',
    async (kind) => {
      await importWithDialog(kind, null);

      expect(imported).toEqual([[kind === 'folder' ? FOLDER : FILE]]);
      expect(addItems).not.toHaveBeenCalled();
    },
  );

  it('a drop on its list: imported, and nothing added to the open playlist', async () => {
    await importPaths([FILE], undefined, null);

    expect(imported).toEqual([[FILE]]);
    expect(addItems).not.toHaveBeenCalled();
  });

  it.each(['files', 'folder'] as const)(
    'an Import… given no place (%s) still adds what it made to the playlist open when it began',
    async (kind) => {
      await importWithDialog(kind);

      expect(imported).toEqual([[kind === 'folder' ? FOLDER : FILE]]);
      expect(addItems).toHaveBeenCalledExactlyOnceWith('playlist-open', null, [
        { kind: 'presentation', presentationId: 'new-presentation' },
      ]);
    },
  );
});
