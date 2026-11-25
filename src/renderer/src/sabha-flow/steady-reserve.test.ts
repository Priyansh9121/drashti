import { describe, expect, it } from 'vitest';
import {
  FACES_BOUND_MS,
  facesToLoad,
  watchReserve,
  type Measured,
  type ReserveBy,
  type ReserveDeps,
} from './steady-reserve';

/*
 * Sabha flow (alpha.23): the panel's steady room for Now and Next up, the tallest of all the flow's items (review S16).
 * It is set ONCE per flow, before Now and Next can be used: only after the faces its words need have loaded (the
 * bundled Gujarati and Devanagari faces load by unicode-range, late on a slow computer), so a later font load never
 * moves it while the flow is current (CI's Mac moved the playlists on the operator's first Next). Only a new width
 * (or a new PDF) measures it again.
 */

function setup() {
  const heights = { now: [16, 18], next: [40, 64] };
  const el = (kind: 'now' | 'next', i: number): Measured => ({
    getBoundingClientRect: () => ({ height: heights[kind][i] ?? 0 }),
  });
  const box = {
    querySelectorAll: (selector: string) =>
      selector.includes('"now"') ? [el('now', 0), el('now', 1)] : [el('next', 0), el('next', 1)],
  };
  let width = 220;
  const changes: (() => void)[] = [];
  let fontsLoaded: () => void = () => undefined;
  const loading: { copies: number }[] = [];
  let settled: () => void = () => undefined;
  let settling = 0;
  // The bound's timer: asked with its length, fired by the test (`bound`), stopped by the watcher.
  const timers: { ms: number; fire: () => void; stopped: boolean }[] = [];
  const deps: ReserveDeps = {
    observe: (_targets, changed) => {
      changes.push(changed);
      changed();
      return () => {
        changes.splice(changes.indexOf(changed), 1);
      };
    },
    widthOf: () => width,
    loadFonts: (copies) => {
      loading.push({ copies: [...copies].length });
      return new Promise<void>((resolve) => {
        fontsLoaded = resolve;
      });
    },
    // The layout takes the loaded faces a frame later.
    afterLayout: () => {
      settling++;
      return new Promise<void>((resolve) => {
        settled = resolve;
      });
    },
    marginTop: () => 2,
    timer: (ms, fire) => {
      const t = { ms, fire, stopped: false };
      timers.push(t);
      return () => {
        t.stopped = true;
      };
    },
  };
  const said: number[] = [];
  const by: ReserveBy[] = [];
  return {
    heights,
    box,
    deps,
    said,
    loading,
    changes,
    setWidth: (w: number) => {
      width = w;
    },
    fontsLoad: async () => {
      fontsLoaded();
      for (let k = 0; k < 4; k++) await Promise.resolve();
      settled();
      for (let k = 0; k < 4; k++) await Promise.resolve();
    },
    /** The faces have loaded, the layout not yet taken them. */
    fontsOnly: async () => {
      fontsLoaded();
      for (let k = 0; k < 4; k++) await Promise.resolve();
    },
    settling: () => settling,
    timers,
    by,
    /** Watch, saying each room (and what set it). */
    watch: () =>
      watchReserve(
        box,
        (px, why) => {
          said.push(px);
          by.push(why);
        },
        deps,
      ),
    /** The bound's time has passed: its timer fires (unless stopped). */
    bound: async () => {
      for (const t of timers) if (!t.stopped) t.fire();
      for (let k = 0; k < 4; k++) await Promise.resolve();
    },
  };
}

describe('the steady room for Now and Next up', () => {
  it('is measured only once the layout has taken the loaded faces (a frame after they are ready), never before', async () => {
    const s = setup();
    watchReserve(s.box, (px) => s.said.push(px), s.deps);
    await s.fontsOnly();
    expect(s.settling()).toBe(1);
    expect(s.said).toEqual([]);
    await s.fontsLoad();
    expect(s.said).toEqual([84]);
  });

  it('is measured only once the faces of all its copies have loaded: the tallest Now and Next up (with its margin)', async () => {
    const s = setup();
    watchReserve(s.box, (px) => s.said.push(px), s.deps);
    expect(s.loading).toEqual([{ copies: 4 }]);
    expect(s.said).toEqual([]);
    await s.fontsLoad();
    expect(s.said).toEqual([18 + 64 + 2]);
  });

  it('is not moved by a font that loads later while the flow is current, nor by a copy alone', async () => {
    const s = setup();
    watchReserve(s.box, (px) => s.said.push(px), s.deps);
    await s.fontsLoad();
    // A late face makes the copies taller; the box's observer fires, its width the same.
    s.heights.next = [44, 71];
    for (const changed of s.changes) changed();
    expect(s.said).toEqual([84]);
  });

  it('is measured again when its width changes (a resized column)', async () => {
    const s = setup();
    watchReserve(s.box, (px) => s.said.push(px), s.deps);
    await s.fontsLoad();
    s.heights.next = [44, 90];
    s.setWidth(300);
    for (const changed of s.changes) changed();
    expect(s.said).toEqual([84, 18 + 90 + 2]);
  });

  it('measures nothing once stopped (a new PDF, the panel folded) before its faces have loaded', async () => {
    const s = setup();
    const stop = watchReserve(s.box, (px) => s.said.push(px), s.deps);
    stop();
    await s.fontsLoad();
    expect(s.said).toEqual([]);
    expect(s.changes).toHaveLength(0);
  });
});

describe('the bound on the wait for the faces and the layout (review S18)', () => {
  it('is a moment: one timer of FACES_BOUND_MS, asked as watching starts', () => {
    const s = setup();
    s.watch();
    expect(s.timers.map((t) => t.ms)).toEqual([FACES_BOUND_MS]);
    expect(FACES_BOUND_MS).toBeGreaterThanOrEqual(1000);
    expect(FACES_BOUND_MS).toBeLessThanOrEqual(2000);
  });

  it('sets the room with the faces that are there when a face’s load never settles: Back, Next, Now and Next up are shown', async () => {
    const s = setup();
    s.watch();
    // The faces never load (document.fonts.ready waits on a load that never ends).
    await s.bound();
    expect(s.settling()).toBe(0);
    expect(s.said).toEqual([84]);
    expect(s.by).toEqual(['bound']);
  });

  it('sets the room when the layout’s frames never come (a minimized window draws no frame)', async () => {
    const s = setup();
    s.watch();
    await s.fontsOnly();
    expect(s.settling()).toBe(1);
    await s.bound();
    expect(s.said).toEqual([84]);
    expect(s.by).toEqual(['bound']);
  });

  it('measures once more when the faces and the layout come after it, the way a width change does, then only on a new width', async () => {
    const s = setup();
    s.watch();
    await s.bound();
    // The faces come late: the copies drawn in them are taller.
    s.heights.next = [44, 71];
    await s.fontsLoad();
    expect(s.said).toEqual([84, 18 + 71 + 2]);
    expect(s.by).toEqual(['bound', 'faces']);
    // A face later still, or a copy alone: the box's observer fires, its width the same. Nothing moves.
    s.heights.next = [44, 80];
    for (const changed of s.changes) changed();
    expect(s.said).toEqual([84, 91]);
    // A new width measures again, as before.
    s.setWidth(300);
    for (const changed of s.changes) changed();
    expect(s.said).toEqual([84, 91, 18 + 80 + 2]);
    expect(s.by).toEqual(['bound', 'faces', 'width']);
  });

  it('never fires once the faces and the layout came in time: its timer is stopped, the room said once', async () => {
    const s = setup();
    s.watch();
    await s.fontsLoad();
    expect(s.timers.map((t) => t.stopped)).toEqual([true]);
    await s.bound();
    expect(s.said).toEqual([84]);
    expect(s.by).toEqual(['faces']);
  });

  it('is stopped with the watching (a new PDF, the panel folded): nothing is said after it', async () => {
    const s = setup();
    const stop = s.watch();
    stop();
    expect(s.timers.map((t) => t.stopped)).toEqual([true]);
    await s.bound();
    await s.fontsLoad();
    expect(s.said).toEqual([]);
  });
});

describe('the faces the copies need', () => {
  it('are each word’s own: the face of every element with words of its own, with those words (a Gujarati part too)', () => {
    // A copy: its line in one face, a Gujarati part in another (a lang of its own may draw in another face).
    const span = { font: 'normal 700 16px "Noto Sans Gujarati"', text: 'નમૂનો કાર્યક્રમ', children: [] };
    const line = { font: 'normal 700 16px "Noto Sans"', text: 'Next up: 2 · ', children: [span] };
    const faces = facesToLoad([line], (el) => el);
    expect(faces).toEqual([
      ['normal 700 16px "Noto Sans"', 'Next up: 2 · '],
      ['normal 700 16px "Noto Sans Gujarati"', 'નમૂનો કાર્યક્રમ'],
    ]);
  });

  it('are each asked once, with all the words drawn in it', () => {
    const a = { font: 'normal 400 12px "Noto Sans"', text: 'Now: ', children: [] };
    const b = { font: 'normal 400 12px "Noto Sans"', text: 'પહેલો', children: [] };
    expect(facesToLoad([a, b], (el) => el)).toEqual([['normal 400 12px "Noto Sans"', 'Now: પહેલો']]);
  });
});
