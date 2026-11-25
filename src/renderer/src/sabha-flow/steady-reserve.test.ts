import { describe, expect, it } from 'vitest';
import { watchReserve, type Measured, type ReserveDeps } from './steady-reserve';

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
  const fontListeners = new Set<() => void>();
  let fontsLoaded: () => void = () => undefined;
  const loading: { copies: number }[] = [];
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
    fonts: {
      addEventListener: (_type, listener) => fontListeners.add(listener),
      removeEventListener: (_type, listener) => fontListeners.delete(listener),
    },
    marginTop: () => 2,
  };
  const said: number[] = [];
  return {
    heights,
    box,
    deps,
    said,
    loading,
    fontListeners,
    changes,
    setWidth: (w: number) => {
      width = w;
    },
    fontsLoad: async () => {
      fontsLoaded();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('the steady room for Now and Next up', () => {
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
    s.heights.next = [44, 71];
    for (const listener of s.fontListeners) listener();
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
