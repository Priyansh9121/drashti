import { afterEach, describe, expect, it } from 'vitest';
import { initialEngineState } from '../../../../shared/engine/state';
import { useEngine } from '../../engine/engine-store';
import {
  backCloses,
  closeOnStop,
  closeViewer,
  openViewer,
  turnPage,
  useViewer,
  type ViewerPage,
} from './viewer-store';

/*
 * The viewer on a phone (Session 54, D1/D2 review): it closes the moment its Drashti stops (access by Gmail), so a
 * video or a sound playing on the phone stops with it, under the page saying why; and it says how each page was
 * come to, so a deck's step come to by Previous shows still. Made-up pages only.
 */

const page = (key: string): ViewerPage => ({
  key,
  title: key,
  size: { width: 16, height: 9 },
  draw: () => null,
});

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
  useEngine.setState({ state: null, rev: -1 });
  useViewer.setState({ pages: [], index: 0, of: null, sizes: {}, movedBy: 0 });
});

describe('the viewer on a phone (Session 54, D1/D2 review)', () => {
  it('closes when Drashti stops, and stays closed when it is let in again', () => {
    stop = closeOnStop();
    useEngine.setState({ state: initialEngineState(), rev: 1 });
    openViewer([page('video:clip')]);
    useEngine.setState({ state: { ...initialEngineState(), stopped: null }, rev: 2 });
    expect(useViewer.getState().pages).toHaveLength(1);
    useEngine.setState({ state: { ...initialEngineState(), stopped: { at: 1_000 } }, rev: 3 });
    expect(useViewer.getState().pages).toEqual([]);
    useEngine.setState({ state: initialEngineState(), rev: 4 });
    expect(useViewer.getState().pages).toEqual([]);
  });

  it('says how the page shown was come to: opened, Next or Previous', () => {
    openViewer([page('a'), page('b'), page('c')], 1);
    expect(useViewer.getState().movedBy).toBe(0);
    turnPage(1);
    expect(useViewer.getState()).toMatchObject({ index: 2, movedBy: 1 });
    turnPage(-1);
    expect(useViewer.getState()).toMatchObject({ index: 1, movedBy: -1 });
  });
});

/** A page's history as a browser keeps it: entries, the one shown, and Back arriving a moment later (popstate). */
function fakeHistory() {
  const entries: unknown[] = [null];
  let at = 0;
  const listeners = new Set<(e: { state: unknown }) => void>();
  const queued: (() => void)[] = [];
  const history = {
    get state() {
      return entries[at] ?? null;
    },
    pushState(state: unknown) {
      entries.splice(at + 1, entries.length, state);
      at = entries.length - 1;
    },
    back() {
      queued.push(() => {
        if (at === 0) return;
        at--;
        for (const l of [...listeners]) l({ state: entries[at] ?? null });
      });
    },
  };
  return {
    win: {
      history,
      addEventListener: (_type: 'popstate', l: (e: { state: unknown }) => void) => listeners.add(l),
      removeEventListener: (_type: 'popstate', l: (e: { state: unknown }) => void) => listeners.delete(l),
    },
    /** The browser goes back, as the phone's own Back does: at once. */
    pressBack: () => {
      history.back();
      for (const run of queued.splice(0)) run();
    },
    /** What the browser had queued arrives. */
    settle: () => {
      for (const run of queued.splice(0)) run();
    },
    depth: () => at,
  };
}

describe('the phone’s own Back (Session 54, D1/D2 review)', () => {
  it('closes the viewer and leaves the remote, as it closes a picture shown full screen in any app', () => {
    const h = fakeHistory();
    openViewer([page('screens')]);
    const release = backCloses(h.win);
    expect(h.depth()).toBe(1);
    h.pressBack();
    expect(useViewer.getState().pages).toEqual([]);
    release();
    h.settle();
    expect(h.depth()).toBe(0);
  });

  it('takes its own entry back off when closed another way, and a viewer opened again at once stays open', () => {
    const h = fakeHistory();
    openViewer([page('screens')]);
    const first = backCloses(h.win);
    // Close: its entry goes, Back arriving a moment later.
    closeViewer();
    first();
    // Opened again before that Back arrives: the late Back lands on the first one's entry, and closes nothing.
    openViewer([page('screens')]);
    const second = backCloses(h.win);
    h.settle();
    expect(useViewer.getState().pages).toHaveLength(1);
    // The phone's Back now closes it, and nothing is left behind.
    h.pressBack();
    expect(useViewer.getState().pages).toEqual([]);
    second();
    h.settle();
    expect(h.depth()).toBe(0);
  });
});
