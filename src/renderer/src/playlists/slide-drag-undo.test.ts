import { beforeEach, describe, expect, it } from 'vitest';
import type { PresentationDoc, SlideInfo } from '../../../shared/library';
import type { ItemOrder, PlaylistItemInfo } from '../../../shared/playlists';
import { undoRemoval, useUndo } from '../library/undo';
import { useDocs } from './docs-store';
import { chooseItemOrder, moveSlide, slideOut, usePlaylists } from './playlist-store';

/*
 * Session 55, Part 4b: a slide's row dragged in the playlist, each drag one Undo step. Within its deck: the item's own
 * order of its slides, Undo putting back the order it played before. Out of it: an item of its own where it was
 * dropped (one write), Undo taking that item out and putting the deck's order back (one write). The Order picker
 * setting an own order aside can be undone too. The main process is stood in for by a fake that keeps the items as
 * db/playlists.ts does. Placeholder names only.
 */

type PresentationItem = Extract<PlaylistItemInfo, { kind: 'presentation' }>;

const info = (id: string, index: number): SlideInfo => ({
  id,
  index,
  label: '',
  notes: '',
  slide: { id, width: 1920, height: 1080, background: null, elements: [] },
  cues: [],
  transition: null,
  autoAdvanceMs: null,
  macroId: null,
});
const DOC: PresentationDoc = {
  id: 'deck',
  name: 'Placeholder deck',
  width: 1920,
  height: 1080,
  groups: [{ id: 'g', name: '', color: null, slides: ['s1', 's2', 's3'].map(info) }],
  arrangements: [],
  selectedArrangementId: null,
  transition: null,
  loop: false,
  kirtan: null,
  source: null,
};
const ALL = ['s1', 's2', 's3'];

const item = (id: string, order: ItemOrder): PresentationItem => ({
  id,
  kind: 'presentation',
  label: 'Placeholder deck',
  presentationId: 'deck',
  presentationName: 'Placeholder deck',
  order,
  arrangementName: null,
  timers: [],
});

let items: PresentationItem[] = [];
const calls: string[] = [];
const ok = (ids: string[]) => Promise.resolve({ ok: true as const, ids });
const find = (id: string) => items.find((i) => i.id === id);

const fake = {
  items: () => Promise.resolve(structuredClone(items)),
  setItemOrder: (itemId: string, order: ItemOrder) => {
    const it = find(itemId);
    if (it) it.order = order;
    calls.push(`order ${itemId} ${order.mode === 'slides' ? order.slideIds.join(',') : order.mode}`);
    return ok([itemId]);
  },
  splitItem: (itemId: string, rest: ItemOrder, alone: ItemOrder, at: number) => {
    const it = find(itemId);
    if (it) it.order = rest;
    items.splice(at, 0, item('made', alone));
    calls.push(`split ${itemId} at ${String(at)}`);
    return ok(['made']);
  },
  undoSplit: (itemId: string, order: ItemOrder, madeId: string) => {
    items = items.filter((i) => i.id !== madeId);
    const it = find(itemId);
    if (it) it.order = order;
    calls.push(`undo ${itemId} ${madeId} ${order.mode}`);
    return ok([itemId, madeId]);
  },
  moveItems: (_playlistId: string, ids: readonly string[], to: number) => {
    const moving = items.filter((i) => ids.includes(i.id));
    const rest = items.filter((i) => !ids.includes(i.id));
    items = rest.toSpliced(Math.max(0, Math.min(to, rest.length)), 0, ...moving);
    calls.push(`move ${ids.join(',')} to ${String(to)}`);
    return ok([...ids]);
  },
};

const orders = () =>
  usePlaylists
    .getState()
    .items.map((i) =>
      i.kind === 'presentation'
        ? `${i.id}:${i.order.mode === 'slides' ? i.order.slideIds.join(',') : i.order.mode}`
        : i.id,
    );

beforeEach(async () => {
  (globalThis as { window?: unknown }).window = { drashti: { playlists: fake } };
  items = [item('i1', { mode: 'presentation' }), item('i2', { mode: 'all' })];
  calls.length = 0;
  useUndo.setState({ stack: [] });
  useDocs.setState({ docs: { deck: DOC } });
  usePlaylists.setState({ openId: 'P', items: await fake.items(), marked: [], anchorId: null });
});

describe('a slide’s row dragged within its deck', () => {
  it('gives the item its own order of slides, and one Undo puts back the order it played before', async () => {
    await moveSlide('i1', 2, 0);
    expect(orders()).toEqual(['i1:s3,s1,s2', 'i2:all']);
    expect(useUndo.getState().stack.at(-1)?.text).toBe('Moved “Placeholder deck_3” in this playlist');
    await undoRemoval();
    expect(orders()).toEqual(['i1:presentation', 'i2:all']);
  });

  it('writes nothing when dropped where it was', async () => {
    await moveSlide('i1', 1, 2);
    expect(calls).toEqual([]);
    expect(useUndo.getState().stack).toEqual([]);
  });
});

describe('a slide’s row dragged out of its deck', () => {
  it('makes an item of it where it was dropped, the deck keeping the rest; one Undo takes it back', async () => {
    await slideOut('i1', 1, 2);
    expect(calls).toEqual(['split i1 at 2']);
    expect(orders()).toEqual(['i1:s1,s3', 'i2:all', 'made:s2']);
    expect(useUndo.getState().stack.at(-1)?.text).toBe('Took “Placeholder deck_2” out of “Placeholder deck”');
    await undoRemoval();
    expect(calls.at(-1)).toBe('undo i1 made presentation');
    expect(orders()).toEqual(['i1:presentation', 'i2:all']);
  });

  it('moves the item itself when the slide is its only one', async () => {
    items = [item('i1', { mode: 'presentation' }), item('i2', { mode: 'slides', slideIds: ['s2'] })];
    usePlaylists.setState({ items: await fake.items() });
    await slideOut('i2', 0, 0);
    expect(calls).toEqual(['move i2 to 0']);
    expect(orders()).toEqual(['i2:s2', 'i1:presentation']);
  });
});

describe('the Order picker', () => {
  it('sets this playlist’s own order aside with Undo, and other choices as before', async () => {
    items = [item('i1', { mode: 'slides', slideIds: ['s2', 's1', 's3'], known: ALL })];
    usePlaylists.setState({ items: await fake.items() });
    const [own] = usePlaylists.getState().items;
    if (own?.kind !== 'presentation') throw new Error('no item');
    await chooseItemOrder(own, { mode: 'all' });
    expect(orders()).toEqual(['i1:all']);
    await undoRemoval();
    expect(orders()).toEqual(['i1:s2,s1,s3']);
    // From an order that is not its own: nothing to undo.
    const [all] = usePlaylists.getState().items;
    if (all?.kind !== 'presentation') throw new Error('no item');
    await chooseItemOrder({ ...all, order: { mode: 'all' } }, { mode: 'presentation' });
    expect(useUndo.getState().stack).toEqual([]);
  });
});
