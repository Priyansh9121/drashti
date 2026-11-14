import { describe, expect, it } from 'vitest';
import { LINGER_MS, type PointAt, REST_MS } from '../../../shared/point-ahead';
import { RowPointer } from './point-ahead';

/*
 * The slide's row the operator is about to click (C3, Session 58: Q57-26): said once the pointer rests on it, at once
 * when pressed or reached by the keyboard, let go of a moment after the pointer leaves the list; only what changes.
 */

/** Timers on a clock of the test's own. */
function clock() {
  let now = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  let next = 1;
  return {
    timers: {
      set: (fn: () => void, ms: number) => {
        const id = next++;
        due.set(id, { at: now + ms, fn });
        return id;
      },
      clear: (id: unknown) => {
        due.delete(id as number);
      },
    },
    pass(ms: number) {
      const until = now + ms;
      for (;;) {
        const first = [...due.entries()]
          .filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!first) break;
        due.delete(first[0]);
        now = first[1].at;
        first[1].fn();
      }
      now = until;
    },
  };
}

const row = (slideIndex: number, arrangementId: string | null = null): PointAt => ({
  presentationId: 'placeholder-deck',
  slideIndex,
  arrangementId,
});

function setUp() {
  const c = clock();
  const told: (PointAt | null)[] = [];
  const pointer = new RowPointer((t) => told.push(t), c.timers);
  return { c, told, pointer };
}

describe('RowPointer', () => {
  it('says a row once the pointer rests on it: one passing over rows on its way says nothing', () => {
    const { c, told, pointer } = setUp();
    pointer.enter(row(0));
    c.pass(REST_MS / 2);
    pointer.leave();
    pointer.enter(row(1));
    c.pass(REST_MS / 2);
    pointer.leave();
    pointer.enter(row(2));
    expect(told).toEqual([]);
    c.pass(REST_MS);
    expect(told).toEqual([row(2)]);
    // Resting there on: nothing more said.
    c.pass(10 * LINGER_MS);
    expect(told).toEqual([row(2)]);
  });

  it('says a press at once, and the next row rested on in its place', () => {
    const { c, told, pointer } = setUp();
    pointer.enter(row(3));
    pointer.press(row(3));
    expect(told).toEqual([row(3)]);
    c.pass(REST_MS);
    expect(told).toEqual([row(3)]);
    pointer.leave();
    pointer.enter(row(4));
    c.pass(REST_MS);
    expect(told).toEqual([row(3), row(4)]);
    // The same slide in another order is another row.
    pointer.leave();
    pointer.enter(row(4, 'placeholder-arrangement'));
    c.pass(REST_MS);
    expect(told.at(-1)).toEqual(row(4, 'placeholder-arrangement'));
  });

  it('lets go a moment after the pointer leaves the list, not if it comes back', () => {
    const { c, told, pointer } = setUp();
    pointer.enter(row(5));
    c.pass(REST_MS);
    pointer.leave();
    c.pass(LINGER_MS / 2);
    pointer.enter(row(5));
    c.pass(LINGER_MS);
    expect(told).toEqual([row(5)]);
    pointer.leave();
    c.pass(LINGER_MS - 1);
    expect(told).toEqual([row(5)]);
    c.pass(1);
    expect(told).toEqual([row(5), null]);
  });

  it('says the keyboard’s row at once, keeps it while Tab moves along, and lets go once it leaves the rows', () => {
    const { c, told, pointer } = setUp();
    pointer.focus(row(6));
    expect(told).toEqual([row(6)]);
    pointer.blur();
    pointer.focus(row(7));
    expect(told).toEqual([row(6), row(7)]);
    // The pointer's row comes first while it rests on one; the keyboard's again once it leaves.
    pointer.enter(row(8));
    c.pass(REST_MS);
    expect(told.at(-1)).toEqual(row(8));
    pointer.leave();
    c.pass(LINGER_MS);
    expect(told.at(-1)).toEqual(row(7));
    pointer.blur();
    c.pass(LINGER_MS);
    expect(told.at(-1)).toBeNull();
    expect(told).toHaveLength(5);
  });
});
