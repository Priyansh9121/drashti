import { describe, expect, it } from 'vitest';
import {
  copiesMargin,
  FACES_BOUND_MS,
  facesToLoad,
  panelWidthOf,
  watchReserve,
  type Laid,
  type LaidStyle,
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
  // The document's fonts (every load in the window), after the flow's own faces.
  let ready: () => void = () => undefined;
  // Laying the copies out before a measure (at the lines' width with the body's scrollbar shown).
  let layOuts = 0;
  const hooks: { onLayOut: () => void } = { onLayOut: () => undefined };
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
    fontsReady: () =>
      new Promise<void>((resolve) => {
        ready = resolve;
      }),
    layOut: () => {
      layOuts++;
      hooks.onLayOut();
    },
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
      ready();
      for (let k = 0; k < 4; k++) await Promise.resolve();
      settled();
      for (let k = 0; k < 4; k++) await Promise.resolve();
    },
    /** The faces have loaded and the document's fonts are ready, the layout not yet taken them. */
    fontsOnly: async () => {
      fontsLoaded();
      for (let k = 0; k < 4; k++) await Promise.resolve();
      ready();
      for (let k = 0; k < 4; k++) await Promise.resolve();
    },
    /** The flow's own faces have loaded; the document's fonts not yet ready (a load elsewhere in the window). */
    facesOnly: async () => {
      fontsLoaded();
      for (let k = 0; k < 4; k++) await Promise.resolve();
    },
    layOuts: () => layOuts,
    hooks,
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

  it('sets the room by it once the flow’s own faces are in, when a load elsewhere in the window never settles (the document’s fonts never ready): Back, Next, Now and Next up are shown', async () => {
    const s = setup();
    s.watch();
    await s.facesOnly();
    expect(s.said).toEqual([]);
    await s.bound();
    expect(s.said).toEqual([84]);
    expect(s.by).toEqual(['bound']);
  });

  it('sets the room by it when the layout’s frames never come (a minimized window draws no frame)', async () => {
    const s = setup();
    s.watch();
    await s.fontsOnly();
    expect(s.settling()).toBe(1);
    await s.bound();
    expect(s.said).toEqual([84]);
    expect(s.by).toEqual(['bound']);
  });

  it('waits past it for the flow’s own faces while they load (they settle, loaded or failed): nothing before them, the room as they come, without waiting for the rest', async () => {
    const s = setup();
    s.watch();
    // CI's Mac (S18): a slow runner's faces can come after the bound. Measured without them, the room was another.
    await s.bound();
    await s.bound();
    expect(s.said).toEqual([]);
    await s.facesOnly();
    expect(s.said).toEqual([84]);
    expect(s.by).toEqual(['bound']);
  });

  it('is set once: what comes after it (the document’s fonts, the layout’s frames) measures nothing again; a new width does', async () => {
    const s = setup();
    s.watch();
    await s.facesOnly();
    await s.bound();
    expect(s.said).toEqual([84]);
    // The rest comes later, the copies taller by then (a face the flow's words never asked for): nothing moves.
    s.heights.next = [44, 71];
    await s.fontsLoad();
    for (const changed of s.changes) changed();
    expect(s.said).toEqual([84]);
    s.setWidth(300);
    for (const changed of s.changes) changed();
    expect(s.said).toEqual([84, 18 + 71 + 2]);
    expect(s.by).toEqual(['bound', 'width']);
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

/*
 * The panel's body scrolls (Q-FC-2 A), and a scrollbar that takes room (Windows; CI's Mac, which draws them as a mouse
 * does) narrows Now and Next up while it shows. Measured at whatever width the copies had, the room followed the
 * scrollbar: shown while the room was not set yet (the area at its share), gone once the area grew to fit, so the
 * room was measured again a line shorter and the area moved after Next could be pressed (CI's Mac, S18: 420 to 404).
 */
describe('a scrollbar in the panel’s body (review S18, CI’s Mac)', () => {
  it('never measures the room again: the copies are laid out before each measure, the first and a new width’s', async () => {
    const s = setup();
    // Laid out at the lines' width with the body's scrollbar shown, the copies wrap a line more.
    s.hooks.onLayOut = () => {
      s.heights.next = [40, 80];
    };
    s.watch();
    await s.fontsLoad();
    expect(s.layOuts()).toBe(1);
    expect(s.said).toEqual([18 + 80 + 2]);
    s.setWidth(300);
    for (const changed of s.changes) changed();
    expect(s.layOuts()).toBe(2);
  });

  // The window's own: a body that scrolls (overflow-y auto), 300 px wide, its scrollbar 11 px when it shows; the
  // copies 12 px in from the box's sides (inset-x-3).
  const tree = (bar: number) => {
    const style = new Map<Laid, LaidStyle>();
    const section: Laid = { parentElement: null, offsetWidth: 300, clientWidth: 300 };
    const body: Laid = { parentElement: section, offsetWidth: 300, clientWidth: 300 - bar };
    const pinned: Laid = { parentElement: body, offsetWidth: 300 - bar, clientWidth: 300 - bar };
    const box: Laid = { parentElement: pinned, offsetWidth: 300 - bar - 24, clientWidth: 300 - bar - 24 };
    const plain = { overflowY: 'visible', borderLeftWidth: '0px', borderRightWidth: '0px', right: 'auto' };
    style.set(section, plain);
    style.set(body, { ...plain, overflowY: 'auto' });
    style.set(pinned, plain);
    style.set(box, { ...plain, overflowY: 'hidden', right: '12px' });
    const styleOf = (el: Laid) => style.get(el) ?? plain;
    return { box, styleOf };
  };

  it('takes the panel’s own width, the same whether its body’s scrollbar shows or not', () => {
    const shown = tree(11);
    const gone = tree(0);
    expect(panelWidthOf(shown.box, shown.styleOf)).toBe(300);
    expect(panelWidthOf(gone.box, gone.styleOf)).toBe(300);
  });

  it('lays the copies out at the lines’ width with the scrollbar shown: as wide as the scrollbar’s room when it shows (their own keeps it), no more than their inset', () => {
    const shown = tree(11);
    const gone = tree(0);
    const wide = tree(15);
    expect(copiesMargin(shown.box, shown.styleOf)).toBe(-11);
    expect(copiesMargin(gone.box, gone.styleOf)).toBe(0);
    expect(copiesMargin(wide.box, wide.styleOf)).toBe(-12);
  });

  it('takes the box’s own width, and lays nothing out, where nothing above it scrolls', () => {
    const box: Laid = { parentElement: null, offsetWidth: 250, clientWidth: 250 };
    const styleOf = () => ({ overflowY: 'hidden', borderLeftWidth: '0px', borderRightWidth: '0px', right: '12px' });
    expect(panelWidthOf(box, styleOf)).toBe(250);
    expect(copiesMargin(box, styleOf)).toBe(0);
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
