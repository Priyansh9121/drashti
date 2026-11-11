import { beforeEach, describe, expect, it } from 'vitest';
import type { PlaylistNode } from '../../../shared/playlists';
import { useLibrary } from '../library/library-store';
import { undoRemoval, useUndo } from '../library/undo';
import { confirmRemoveNode, loadTree, requestRemoveNode, usePlaylists } from './playlist-store';

/*
 * Deleting playlists (Session 56, the owner's words of 11 Nov 2026, item 3): "when the open playlist, or the last one,
 * is deleted, the middle closes it too", never going on showing it or what of it was chosen; Undo brings it back open.
 * The main process is stood in for by a fake list of playlists. Placeholder names only.
 */

const node = (id: string, parentId: string | null = null, isFolder = false): PlaylistNode =>
  ({
    id,
    name: `Placeholder ${id}`,
    parentId,
    isFolder,
    template: false,
    itemCount: 0,
    placeholders: 0,
  }) as unknown as PlaylistNode;

const ROW = { id: 'row-1', kind: 'header', label: 'Placeholder row', color: null } as const;

let lists: { node: PlaylistNode; deleted: boolean }[] = [];
let opened: (string | null)[] = [];

const fake = {
  tree: () => Promise.resolve(lists.filter((l) => !l.deleted).map((l) => l.node)),
  templates: () => Promise.resolve([]),
  // Each playlist's one row (a header stands in for a presentation's).
  items: () => Promise.resolve([ROW]),
  opened: (id: string | null) => {
    opened.push(id);
    return Promise.resolve(null);
  },
  remove: (ids: readonly string[]) => {
    const out: string[] = [];
    // A folder goes with everything in it.
    const take = (id: string) => {
      for (const l of lists)
        if (!l.deleted && (l.node.id === id || l.node.parentId === id)) {
          l.deleted = true;
          out.push(l.node.id);
          if (l.node.id !== id) take(l.node.id);
        }
    };
    ids.forEach(take);
    return Promise.resolve({ ok: true as const, ids: out });
  },
  restore: (ids: readonly string[]) => {
    for (const l of lists) if (ids.includes(l.node.id)) l.deleted = false;
    return Promise.resolve({ ok: true as const, ids: [...ids] });
  },
};

beforeEach(async () => {
  (globalThis as { window?: unknown }).window = { drashti: { playlists: fake } };
  lists = [
    { node: node('A'), deleted: false },
    { node: node('B'), deleted: false },
    { node: node('W', null, true), deleted: false },
    { node: node('C', 'W'), deleted: false },
  ];
  opened = [];
  useUndo.setState({ stack: [] });
  usePlaylists.setState({ openId: null, items: [], tree: [], templates: [], confirmRemove: null });
  await loadTree();
});

/** The open playlist `id`, with a presentation of it chosen (put up from its row), as the middle had it. */
function openWithChosen(id: string): void {
  usePlaylists.setState({ openId: id, selectedNodeId: id });
  useLibrary.setState({
    item: { ...ROW, playlistId: id },
    selectedId: 'kirtan',
    nothingChosen: false,
  });
}

const deleteIt = async (id: string) => {
  requestRemoveNode(id);
  await confirmRemoveNode();
};

describe('deleting the open playlist', () => {
  it('closes it: none open, nothing of it chosen, and the main process told so', async () => {
    openWithChosen('A');
    await deleteIt('A');
    expect(usePlaylists.getState().openId).toBeNull();
    expect(usePlaylists.getState().items).toEqual([]);
    expect(useLibrary.getState()).toMatchObject({ item: null, selectedId: null, nothingChosen: true });
    expect(opened).toEqual([null]);
  });

  it('brings it back open with Undo', async () => {
    openWithChosen('A');
    await deleteIt('A');
    await undoRemoval();
    expect(usePlaylists.getState().openId).toBe('A');
    expect(opened).toEqual([null, 'A']);
  });

  it('closes it with the folder it is in; Undo brings both back, it open', async () => {
    openWithChosen('C');
    await deleteIt('W');
    expect(usePlaylists.getState().openId).toBeNull();
    await undoRemoval();
    expect(usePlaylists.getState().openId).toBe('C');
    expect(usePlaylists.getState().tree.map((n) => n.id)).toEqual(['A', 'B', 'W', 'C']);
  });

  it('another deleted leaves the open one and what of it is chosen as they are; its Undo opens nothing', async () => {
    openWithChosen('A');
    await deleteIt('B');
    expect(usePlaylists.getState().openId).toBe('A');
    expect(useLibrary.getState().item).not.toBeNull();
    await undoRemoval();
    expect(usePlaylists.getState().openId).toBe('A');
    expect(opened).toEqual([]);
  });

  it('closes it when it goes from elsewhere (a phone), as the list is read again', async () => {
    openWithChosen('B');
    lists = lists.filter((l) => l.node.id !== 'B');
    await loadTree();
    expect(usePlaylists.getState().openId).toBeNull();
    expect(useLibrary.getState().item).toBeNull();
    expect(opened).toEqual([null]);
  });
});
