import { describe, expect, it } from 'vitest';
import type { Quote } from '../../shared/idle';
import { DEFAULT_IDLE_SETTINGS } from '../../shared/idle';
import { openDatabase } from '../db/database';
import { QuoteRepo } from '../db/quotes';
import { IDLE_SETTING, oldIdleRotation, QuoteOfTheDay } from './idle-service';

/*
 * What is left of the idle rotation (Session 55, Part 12): the quote of the day for a stage layout's Quote box, on a
 * fake clock, and the reader that lists what the rotation was set to show, for Part 6's wallpaper set. Placeholder
 * quotes and made-up picture ids only.
 */

function setup(start = new Date(2026, 5, 17, 23, 0).getTime()) {
  const quotes = new QuoteRepo(openDatabase(':memory:'));
  let clock = start;
  const told: (Quote | null)[] = [];
  let pending: { due: number; run: () => void } | null = null;
  const make = () =>
    new QuoteOfTheDay({
      quotes,
      engine: {
        setQuote: (q) => {
          told.push(q);
          return { ok: true, changed: true, rev: told.length };
        },
      },
      now: () => clock,
      schedule: (ms, run) => {
        const timer = { due: clock + ms, run };
        pending = timer;
        return () => {
          if (pending === timer) pending = null;
        };
      },
    });
  const runTo = (to: number) => {
    for (let guard = 0; guard < 1000; guard++) {
      const timer: { due: number; run: () => void } | null = pending;
      if (!timer || timer.due > to) break;
      pending = null;
      clock = Math.max(clock, timer.due);
      timer.run();
    }
    clock = to;
  };
  return { quotes, told, make, runTo };
}

describe('the quote of the day (a stage layout’s Quote box)', () => {
  it('is none with no quotes, one of them all day, and the next just after midnight', () => {
    const t = setup();
    t.make();
    expect(t.told).toEqual([null]);
    t.quotes.create({ words: { en: 'Placeholder quote one' }, attribution: '' });
    t.quotes.create({ words: { en: 'Placeholder quote two' }, attribution: 'Placeholder' });
    const service = t.make();
    const today = t.told.at(-1);
    expect(today).not.toBeNull();
    t.runTo(new Date(2026, 5, 18, 0, 0, 2).getTime());
    expect(t.told.at(-1)).not.toEqual(today);
    t.runTo(new Date(2026, 5, 19, 0, 0, 2).getTime());
    expect(t.told.at(-1)).toEqual(today);
    // Stopped at quit: nothing more after.
    service.dispose();
    const count = t.told.length;
    t.runTo(new Date(2026, 5, 21, 0, 0, 2).getTime());
    expect(t.told.length).toBe(count);
  });
});

describe('the idle rotation as the library keeps it (Part 6 makes a wallpaper set of it)', () => {
  it('lists its pictures in order with their names (null once gone), its seconds, the quote of the day and the quotes', () => {
    const quotes = new QuoteRepo(openDatabase(':memory:'));
    quotes.create({ words: { gu: 'પ્લેસહોલ્ડર', en: 'Placeholder quote' }, attribution: 'Placeholder' });
    const stored = new Map<string, unknown>([
      [IDLE_SETTING, { pictures: ['pic-b', 'pic-gone', 'pic-a'], secondsEach: 12, quoteOfTheDay: false }],
    ]);
    const names = new Map([
      ['pic-a', 'Placeholder darshan A.png'],
      ['pic-b', 'Placeholder darshan B.png'],
    ]);
    const read = oldIdleRotation({
      settings: { get: (n) => stored.get(n) },
      quotes,
      picture: (id) => {
        const name = names.get(id);
        return name === undefined ? null : { name };
      },
    });
    expect(read).toEqual({
      pictures: [
        { mediaId: 'pic-b', name: 'Placeholder darshan B.png' },
        { mediaId: 'pic-gone', name: null },
        { mediaId: 'pic-a', name: 'Placeholder darshan A.png' },
      ],
      secondsEach: 12,
      quoteOfTheDay: false,
      quotes: quotes.list(),
    });
    // None kept (or unreadable): its defaults, nothing in it.
    for (const kept of [undefined, { pictures: 'nope' }]) {
      const none = oldIdleRotation({
        settings: { get: () => kept },
        quotes: { list: () => [] },
        picture: () => null,
      });
      expect(none).toEqual({ ...DEFAULT_IDLE_SETTINGS, pictures: [], quotes: [] });
    }
  });
});
