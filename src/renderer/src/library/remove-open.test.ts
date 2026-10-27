import { beforeEach, describe, expect, it } from 'vitest';
import type { PresentationDoc, PresentationSummary, RemoveResult } from '../../../shared/library';
import type { PlaylistItemInfo } from '../../../shared/playlists';
import { useEngine } from '../engine/engine-store';
import { usePlaylists } from '../playlists/playlist-store';
import {
  confirmRemoval,
  deleteOpenLabel,
  playlistCardsLine,
  requestRemoval,
  requestRemovalOfOpen,
  useImports,
} from './import-store';
import type { ShownItem } from './library-store';
import { useLibrary } from './library-store';
import { undoRemoval, useUndo } from './undo';

/*
 * Delete… in the menu of the presentation open in the middle (Session 50): that presentation alone, asked
 * first, with Undo, as the library's trash does; once it is deleted the middle shows nothing chosen (not the
 * next presentation, as the library's trash leaves it). Session 51: while a playlist item is open the menu
 * says Delete from the library…, the one question (the library's trash's too) says what becomes of its
 * playlists' cards, and Undo shows that card again while its playlist is open. The main process is stood in
 * for by a fake that removes and restores as src/main/db/presentations.ts does. Placeholder names only.
 */

interface Stored {
  id: string;
  name: string;
  removed: boolean;
}

let stored: Stored[] = [];
/** What the next removal answers instead (a refusal: Simple Mode's). */
let refuse: RemoveResult | null = null;

const summary = (p: Stored): PresentationSummary => ({
  id: p.id,
  name: p.name,
  libraryName: 'Default',
  slideCount: 1,
  width: 1920,
  height: 1080,
  kirtanTracks: null,
  kirtan: null,
});
const docOf = (p: Stored): PresentationDoc => ({
  id: p.id,
  name: p.name,
  width: 1920,
  height: 1080,
  groups: [],
  arrangements: [],
  selectedArrangementId: null,
  transition: null,
  loop: false,
  kirtan: null,
  source: null,
});

const toggle = (ids: readonly string[], removed: boolean): RemoveResult => ({
  ok: true,
  ids: stored
    .filter((p) => ids.includes(p.id) && p.removed !== removed)
    .map((p) => {
      p.removed = removed;
      return p.id;
    }),
});

const fake = {
  listPresentations: () => Promise.resolve(stored.filter((p) => !p.removed).map(summary)),
  getPresentation: (id: string) => {
    const p = stored.find((s) => s.id === id && !s.removed);
    return Promise.resolve(p ? docOf(p) : null);
  },
  removePresentations: (ids: string[]) => Promise.resolve(refuse ?? toggle(ids, true)),
  restorePresentations: (ids: string[]) => Promise.resolve(toggle(ids, false)),
};

const open = () => useLibrary.getState();

beforeEach(async () => {
  (globalThis as { window?: unknown }).window = { drashti: { library: fake } };
  stored = [
    { id: 'A', name: 'Placeholder Alpha', removed: false },
    { id: 'B', name: 'Placeholder Bravo', removed: false },
    { id: 'C', name: 'Placeholder Charlie', removed: false },
  ];
  refuse = null;
  useUndo.setState({ stack: [] });
  useImports.setState({ confirmRemove: null });
  useEngine.setState({ state: null });
  usePlaylists.setState({ openId: null, items: [] });
  // Bravo open in the middle, all three marked in the library.
  useLibrary.setState({
    presentations: await fake.listPresentations(),
    selectedId: 'B',
    doc: await fake.getPresentation('B'),
    marked: ['A', 'B', 'C'],
    anchorId: 'A',
    item: null,
    focusSlideId: null,
    nothingChosen: false,
    unreadId: null,
  });
});

describe('Delete… in the middle’s menu (Session 50)', () => {
  it('asks for the presentation open in the middle alone, whatever else is marked in the library', () => {
    requestRemovalOfOpen('B', 'Placeholder Bravo');
    expect(useImports.getState().confirmRemove).toEqual({
      ids: ['B'],
      names: ['Placeholder Bravo'],
      live: false,
      closes: true,
    });
    // The library's own trash on that row takes the marked ones, as before.
    requestRemoval('B');
    expect(useImports.getState().confirmRemove?.ids).toEqual(['A', 'B', 'C']);
  });

  it('says so when it is on the screens', () => {
    useEngine.setState({ state: { live: { presentationId: 'B' } } as never });
    requestRemovalOfOpen('B', 'Placeholder Bravo');
    expect(useImports.getState().confirmRemove?.live).toBe(true);
  });

  it('deletes it alone, leaves nothing chosen in the middle, and Undo brings it back open there', async () => {
    requestRemovalOfOpen('B', 'Placeholder Bravo');
    await confirmRemoval();
    expect(stored.filter((p) => p.removed).map((p) => p.id)).toEqual(['B']);
    expect(useUndo.getState().stack.at(-1)?.text).toBe('Deleted “Placeholder Bravo”');
    expect(open()).toMatchObject({ selectedId: null, doc: null, item: null, nothingChosen: true });
    expect(open().presentations.map((p) => p.id)).toEqual(['A', 'C']);
    expect(await undoRemoval()).toBe(true);
    expect(stored.some((p) => p.removed)).toBe(false);
    expect(open()).toMatchObject({ selectedId: 'B', nothingChosen: false });
    expect(open().doc?.id).toBe('B');
  });

  it('leaves nothing chosen too when the middle showed it as a playlist item', async () => {
    useLibrary.setState({
      item: {
        id: 'item-1',
        playlistId: 'P',
        kind: 'presentation',
        presentationId: 'B',
        presentationName: 'Placeholder Bravo',
      } as never,
    });
    requestRemovalOfOpen('B', 'Placeholder Bravo');
    await confirmRemoval();
    expect(open()).toMatchObject({ selectedId: null, doc: null, item: null, nothingChosen: true });
  });

  it('keeps it open when the deletion is refused (Simple Mode)', async () => {
    refuse = { ok: false, message: 'Nothing was removed.' };
    requestRemovalOfOpen('B', 'Placeholder Bravo');
    await confirmRemoval();
    expect(useUndo.getState().stack).toEqual([]);
    expect(open()).toMatchObject({ selectedId: 'B', nothingChosen: false });
    expect(open().doc?.id).toBe('B');
  });

  it('the library’s trash still leaves the middle on the first presentation left, as before', async () => {
    useLibrary.setState({ marked: ['B'] });
    requestRemoval('B');
    await confirmRemoval();
    expect(open()).toMatchObject({ selectedId: 'A', nothingChosen: false });
  });
});

describe('Delete from the library… while a playlist item is open (Session 51)', () => {
  /** Bravo's card in the playlist P, and the same card as the middle shows it. */
  const bravoCard: PlaylistItemInfo = {
    id: 'item-1',
    kind: 'presentation',
    label: 'Placeholder Bravo',
    presentationId: 'B',
    presentationName: 'Placeholder Bravo',
    order: { mode: 'presentation' },
    arrangementName: null,
    timers: [],
  };
  const bravoItem: ShownItem = { ...bravoCard, playlistId: 'P' };

  /** Bravo opened from its card in the open playlist P, then deleted from the middle's menu. */
  async function deleteFromCard(): Promise<void> {
    usePlaylists.setState({ openId: 'P', items: [bravoCard] });
    useLibrary.setState({ item: bravoItem });
    requestRemovalOfOpen('B', 'Placeholder Bravo');
    await confirmRemoval();
    expect(open()).toMatchObject({ selectedId: null, item: null, nothingChosen: true });
  }

  it('the menu says Delete from the library… for a playlist item, and Delete… for one opened from the library', () => {
    expect(deleteOpenLabel(bravoItem)).toBe('Delete from the library…');
    expect(deleteOpenLabel(null)).toBe('Delete…');
  });

  it('the question says what becomes of the playlists’ cards, for one presentation or several', () => {
    expect(playlistCardsLine(1)).toBe(
      'Any playlist it is in keeps its card, marked Removed from the library, and Next goes past it.',
    );
    expect(playlistCardsLine(3)).toBe(
      'Any playlist they are in keeps their cards, marked Removed from the library, and Next goes past them.',
    );
  });

  it('asks the library’s trash’s question, whether it was opened from a playlist or the library', () => {
    useLibrary.setState({ item: bravoItem });
    requestRemovalOfOpen('B', 'Placeholder Bravo');
    const asked = useImports.getState().confirmRemove;
    useLibrary.setState({ item: null, marked: ['B'] });
    requestRemoval('B');
    // The same presentation, named the same, the same count for the same words; only the middle's closes, and
    // keeps the card it was asked from.
    expect(asked).toEqual({ ...useImports.getState().confirmRemove, closes: true, fromItem: bravoItem });
  });

  it('Undo shows that card again while its playlist is open, so a slide clicked plays in the playlist', async () => {
    await deleteFromCard();
    expect(await undoRemoval()).toBe(true);
    expect(open()).toMatchObject({ selectedId: 'B', item: bravoItem, nothingChosen: false });
    expect(open().doc?.id).toBe('B');
  });

  it('Undo shows it as the library’s once its playlist is closed, or the card is taken out', async () => {
    for (const since of [
      { openId: null, items: [] },
      { openId: 'P', items: [] },
    ]) {
      await deleteFromCard();
      usePlaylists.setState(since);
      expect(await undoRemoval()).toBe(true);
      expect(open()).toMatchObject({ selectedId: 'B', item: null, nothingChosen: false });
      expect(open().doc?.id).toBe('B');
    }
  });
});
