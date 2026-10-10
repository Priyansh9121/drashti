import { beforeEach, describe, expect, it } from 'vitest';
import type { PlaylistItemInfo } from '../../../shared/playlists';
import { undoRemoval, useUndo } from '../library/undo';
import { moveItemBy, moveItems, usePlaylists } from './playlist-store';

/*
 * Undo for moving playlist items (Session 25): one step puts every moved item back where it was,
 * whichever way and however many were moved. The main process is stood in for by a fake that moves
 * items as src/main/db/playlists.ts does: the moved ones keep their order and land at a place among
 * the rest. Placeholder headers only.
 */

let order: string[] = [];

const fake = {
  items: () =>
    Promise.resolve(
      order.map((id): PlaylistItemInfo => ({ id, kind: 'header', label: `Placeholder ${id}`, color: null })),
    ),
  moveItems: (_playlistId: string, ids: readonly string[], to: number) => {
    const moving = order.filter((id) => ids.includes(id));
    const rest = order.filter((id) => !ids.includes(id));
    const where = Math.max(0, Math.min(to, rest.length));
    order = [...rest.slice(0, where), ...moving, ...rest.slice(where)];
    return Promise.resolve({ ok: true as const, ids: [...ids] });
  },
};

beforeEach(async () => {
  (globalThis as { window?: unknown }).window = { drashti: { playlists: fake } };
  order = ['A', 'B', 'C', 'D', 'E'];
  useUndo.setState({ stack: [] });
  usePlaylists.setState({
    openId: 'P',
    tree: [
      {
        id: 'P',
        name: 'Placeholder Sabha',
        parentId: null,
        isFolder: false,
        template: false,
        itemCount: 5,
        placeholders: 0,
      } as never,
    ],
    items: await fake.items(),
    marked: [],
    anchorId: null,
  });
});

describe('undoing a move in a playlist', () => {
  it('puts several items dragged to the top back where each was', async () => {
    await moveItems(['D', 'E'], 0);
    expect(order).toEqual(['D', 'E', 'A', 'B', 'C']);
    await undoRemoval();
    expect(order).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('puts items picked from here and there, dragged up or down, back where each was', async () => {
    await moveItems(['B', 'D'], 0);
    expect(order).toEqual(['B', 'D', 'A', 'C', 'E']);
    await undoRemoval();
    expect(order).toEqual(['A', 'B', 'C', 'D', 'E']);
    await moveItems(['A', 'C'], 5);
    expect(order).toEqual(['B', 'D', 'E', 'A', 'C']);
    await undoRemoval();
    expect(order).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('takes back Up and Down one at a time', async () => {
    await moveItemBy('E', -1);
    await moveItemBy('E', -1);
    expect(order).toEqual(['A', 'B', 'E', 'C', 'D']);
    await undoRemoval();
    expect(order).toEqual(['A', 'B', 'C', 'E', 'D']);
    await undoRemoval();
    expect(order).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});
