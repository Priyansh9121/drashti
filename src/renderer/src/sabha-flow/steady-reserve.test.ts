import { describe, expect, it } from 'vitest';
import { watchReserve, type Measured, type ReserveDeps } from './steady-reserve';

/*
 * Sabha flow (alpha.23): the panel's steady room for Now and Next up, the tallest of all the flow's items (review S16,
 * S17). A Gujarati or Devanagari font loaded after the first measure (the bundled fonts load by unicode-range, only
 * when their letters are first drawn) makes the lines taller: the room is measured again, never left short.
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
  const observed: { targets: readonly unknown[]; changed: () => void }[] = [];
  const fontListeners = new Set<() => void>();
  const deps: ReserveDeps = {
    observe: (targets, changed) => {
      const entry = { targets, changed };
      observed.push(entry);
      changed();
      return () => {
        observed.splice(observed.indexOf(entry), 1);
      };
    },
    fonts: {
      addEventListener: (_type, listener) => fontListeners.add(listener),
      removeEventListener: (_type, listener) => fontListeners.delete(listener),
    },
    marginTop: () => 2,
  };
  const said: number[] = [];
  return { heights, box, deps, said, observed, fontListeners };
}

describe('the steady room for Now and Next up', () => {
  it('is the tallest Now and the tallest Next up (with its margin), rounded up', () => {
    const s = setup();
    watchReserve(s.box, (px) => s.said.push(px), s.deps);
    expect(s.said.at(-1)).toBe(18 + 64 + 2);
  });

  it('is measured again when a late font has loaded (S17): the lines grew, the room grows', () => {
    const s = setup();
    const stop = watchReserve(s.box, (px) => s.said.push(px), s.deps);
    expect(s.said.at(-1)).toBe(84);
    // The Gujarati font arrives: the same lines draw taller.
    s.heights.now = [18, 20];
    s.heights.next = [44, 71];
    for (const listener of s.fontListeners) listener();
    expect(s.said.at(-1)).toBe(20 + 71 + 2);
    stop();
    expect(s.fontListeners.size).toBe(0);
  });

  it('watches the box and each of the copies, so a copy that grows by itself is measured again', () => {
    const s = setup();
    const stop = watchReserve(s.box, (px) => s.said.push(px), s.deps);
    const watched = s.observed.flatMap((o) => o.targets);
    expect(watched).toContain(s.box);
    expect(watched.length).toBeGreaterThanOrEqual(5);
    stop();
    expect(s.observed).toHaveLength(0);
  });
});
