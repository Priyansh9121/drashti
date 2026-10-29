import { beforeEach, describe, expect, it } from 'vitest';
import type { PlaylistItemInfo, PlaylistNode } from '../../../shared/playlists';
import { useEngine } from '../engine/engine-store';
import { undoRemoval, useUndo } from '../library/undo';
import {
  confirmRemoveItems,
  requestRemoveFolder,
  requestRemoveMarkedItems,
  usePlaylists,
} from './playlist-store';

/*
 * Session 55, Part 14: Delete on a playlist's rows (the Delete key, a row's trash, the one right-click menu) takes
 * them out of that playlist only, with Undo, asking first when one is on the screens, and saying which; Delete on a
 * folder playlist's folder takes it and everything in it out with one Undo, asked first. The main process is stood in
 * for by a fake that keeps the rows taken out. Placeholder names only.
 */

const media = (id: string): PlaylistItemInfo => ({
  id,
  kind: 'media',
  label: `Placeholder ${id}`,
  mediaId: `m-${id}`,
  media: 'image',
  missing: false,
  unplayable: null,
  timers: [],
});
const header = (id: string, label: string): PlaylistItemInfo => ({ id, kind: 'header', label, color: null });

let stored: PlaylistItemInfo[] = [];
let taken: string[] = [];

const node: PlaylistNode = {
  id: 'P',
  name: 'Placeholder Sunday',
  isFolder: false,
  kind: 'normal',
  parentId: null,
  itemCount: 0,
  placeholders: 0,
  imported: false,
  template: false,
};

beforeEach(() => {
  stored = [
    header('h1', 'Week 1'),
    media('a'),
    header('h2', 'Week 1 › Videos'),
    media('b'),
    media('c'),
    header('h3', 'Week 2'),
    media('d'),
  ];
  taken = [];
  const shown = () => stored.filter((i) => !taken.includes(i.id));
  (globalThis as { window?: unknown }).window = {
    drashti: {
      playlists: {
        removeItems: (ids: string[]) => {
          taken.push(...ids);
          return Promise.resolve({ ok: true, ids });
        },
        restoreItems: (ids: string[]) => {
          taken = taken.filter((id) => !ids.includes(id));
          return Promise.resolve({ ok: true, ids });
        },
        items: () => Promise.resolve(shown()),
        tree: () => Promise.resolve([{ ...node, fromFolder: true }]),
        templates: () => Promise.resolve([]),
        opened: () => Promise.resolve(null),
      },
    },
  };
  usePlaylists.setState({
    openId: 'P',
    tree: [{ ...node, fromFolder: true }],
    templates: [],
    items: shown(),
    marked: [],
    anchorId: null,
    folder: '',
    confirmRemoveItems: null,
  });
  useUndo.setState({ stack: [] });
  useEngine.setState({ state: null });
});

const left = () => stored.filter((i) => !taken.includes(i.id)).map((i) => i.id);

describe('Delete on a playlist’s rows', () => {
  it('takes them out of this playlist at once, with Undo, when none is on the screens', async () => {
    usePlaylists.setState({ marked: ['b', 'c'] });
    requestRemoveMarkedItems();
    await expect.poll(left).toEqual(['h1', 'a', 'h2', 'h3', 'd']);
    expect(usePlaylists.getState().confirmRemoveItems).toBeNull();
    await expect.poll(() => useUndo.getState().stack.length).toBe(1);
    await undoRemoval();
    expect(left()).toEqual(stored.map((i) => i.id));
  });

  it('asks first when one is on the screens, saying which; Take out takes them all', async () => {
    useEngine.setState({
      state: {
        live: { playlist: { playlistId: 'P', itemId: 'b' } },
        layers: { slide: null, background: { kind: 'media' }, audio: null },
      } as never,
    });
    usePlaylists.setState({ marked: ['a', 'b'] });
    requestRemoveMarkedItems();
    expect(left()).toEqual(stored.map((i) => i.id));
    expect(usePlaylists.getState().confirmRemoveItems).toMatchObject({
      ids: ['a', 'b'],
      live: 'Placeholder b',
      playlist: 'Placeholder Sunday',
      folder: null,
    });
    await confirmRemoveItems();
    expect(left()).toEqual(['h1', 'h2', 'c', 'h3', 'd']);
  });
});

describe('Delete on a folder playlist’s folder', () => {
  it('takes it and everything in it (its folders and their headers too) out, asked first, with one Undo', async () => {
    requestRemoveFolder('Week 1');
    expect(left()).toEqual(stored.map((i) => i.id));
    expect(usePlaylists.getState().confirmRemoveItems).toMatchObject({
      ids: ['h1', 'a', 'h2', 'b', 'c'],
      names: ['Placeholder a', 'Placeholder b', 'Placeholder c'],
      folder: 'Week 1',
    });
    await confirmRemoveItems();
    expect(left()).toEqual(['h3', 'd']);
    expect(useUndo.getState().stack).toHaveLength(1);
    await undoRemoval();
    expect(left()).toEqual(stored.map((i) => i.id));
  });
});
