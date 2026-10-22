import { beforeEach, describe, expect, it } from 'vitest';
import type { PresentationDoc, PresentationSummary, RemoveResult } from '../../../shared/library';
import { useEngine } from '../engine/engine-store';
import { confirmRemoval, requestRemoval, requestRemovalOfOpen, useImports } from './import-store';
import { useLibrary } from './library-store';
import { undoRemoval, useUndo } from './undo';

/*
 * Delete… in the menu of the presentation open in the middle (Session 50): that presentation alone, asked
 * first, with Undo, as the library's trash does; once it is deleted the middle shows nothing chosen (not the
 * next presentation, as the library's trash leaves it). The main process is stood in for by a fake that
 * removes and restores as src/main/db/presentations.ts does. Placeholder names only.
 */

interface Stored {
  id: string;
  name: string;
  removed: boolean;
}

let stored: Stored[] = [];
/** What the next removal answers instead (a refusal: Simple Mode, or roles). */
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

  it('keeps it open when the deletion is refused (Simple Mode, or an admin’s with roles)', async () => {
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
