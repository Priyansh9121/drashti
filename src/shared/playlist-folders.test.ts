import { describe, expect, it } from 'vitest';
import type { PlaylistItemInfo } from './playlists';
import {
  folderCrumbs,
  folderEnd,
  hasFolder,
  pathParts,
  playlistFolders,
  subfoldersOf,
} from './playlist-folders';

const media = (id: string): PlaylistItemInfo => ({
  id,
  kind: 'media',
  label: id,
  mediaId: `m-${id}`,
  media: 'video',
  missing: false,
  unplayable: null,
  timers: [],
});
const header = (id: string, label: string): PlaylistItemInfo => ({ id, kind: 'header', label, color: null });

/**
 * A folder two deep, as a folder playlist holds it (shared/folder-order.ts): the top folder's own files,
 * then each subfolder's part after its header. "Week 2" has no files of its own, so no header of its own.
 */
const ITEMS = [
  media('opening'),
  media('notice'),
  header('h1', 'Week 1'),
  media('clip'),
  header('h2', 'Week 1 › Videos'),
  media('deep'),
  header('h3', 'Week 2 › Pictures'),
  media('cover'),
];

describe('a folder playlist’s folders, read from its headers (Session 44)', () => {
  const view = playlistFolders(ITEMS);

  it('finds every folder, a folder above a part with none of its own too, each parent first', () => {
    expect(view.folders).toEqual([
      { path: 'Week 1', name: 'Week 1', parent: '', own: 1 },
      { path: 'Week 1 › Videos', name: 'Videos', parent: 'Week 1', own: 1 },
      { path: 'Week 2', name: 'Week 2', parent: '', own: 0 },
      { path: 'Week 2 › Pictures', name: 'Pictures', parent: 'Week 2', own: 1 },
    ]);
  });

  it('puts each item in the folder of the header before it, the top folder’s own first', () => {
    expect(ITEMS.map((i) => view.folderOf.get(i.id))).toEqual([
      '',
      '',
      'Week 1',
      'Week 1',
      'Week 1 › Videos',
      'Week 1 › Videos',
      'Week 2 › Pictures',
      'Week 2 › Pictures',
    ]);
  });

  it('lists a folder’s own subfolders only, in the playlist’s order', () => {
    expect(subfoldersOf(view, '').map((f) => f.name)).toEqual(['Week 1', 'Week 2']);
    expect(subfoldersOf(view, 'Week 1').map((f) => f.name)).toEqual(['Videos']);
    expect(subfoldersOf(view, 'Week 1 › Videos')).toEqual([]);
    expect(hasFolder(view, '')).toBe(true);
    expect(hasFolder(view, 'Week 3')).toBe(false);
  });

  it('names the way back up, the top folder by the playlist’s name', () => {
    expect(folderCrumbs('Week 1 › Videos', 'Placeholder Sabha')).toEqual([
      { path: '', name: 'Placeholder Sabha' },
      { path: 'Week 1', name: 'Week 1' },
      { path: 'Week 1 › Videos', name: 'Videos' },
    ]);
    expect(folderCrumbs('', 'Placeholder Sabha')).toEqual([{ path: '', name: 'Placeholder Sabha' }]);
  });

  it('reads a header’s spacing loosely, and an empty header as the top folder', () => {
    expect(pathParts(' Week 1 ›Videos ')).toEqual(['Week 1', 'Videos']);
    expect(playlistFolders([header('h', ''), media('a')]).folderOf.get('a')).toBe('');
  });

  it('adds at the end of a folder’s own part, and asks for a header where a folder has none', () => {
    expect(folderEnd(ITEMS, view, '')).toEqual({ at: 2 });
    expect(folderEnd(ITEMS, view, 'Week 1')).toEqual({ at: 4 });
    expect(folderEnd(ITEMS, view, 'Week 1 › Videos')).toEqual({ at: 6 });
    expect(folderEnd(ITEMS, view, 'Week 2 › Pictures')).toEqual({ at: 8 });
    expect(folderEnd(ITEMS, view, 'Week 2')).toEqual({ headerAt: 6 });
    // A playlist with no headers: the top folder is all of it.
    expect(folderEnd([media('a')], playlistFolders([media('a')]), '')).toEqual({ at: 1 });
  });
});
