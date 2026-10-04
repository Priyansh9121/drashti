import { describe, expect, it } from 'vitest';
import type { IdleState, IdleView, Quote } from '../../shared/idle';
import { openDatabase } from '../db/database';
import { QuoteRepo } from '../db/quotes';
import { IdleService } from './idle-service';

/* The idle rotation's content, on a fake clock (placeholder quotes and made-up picture ids only). */

function setup(start = new Date(2026, 5, 17, 23, 0).getTime()) {
  const quotes = new QuoteRepo(openDatabase(':memory:'));
  const stored = new Map<string, unknown>();
  const pictures = new Map<string, string>([
    ['pic-a', 'Placeholder darshan A.png'],
    ['pic-b', 'Placeholder darshan B.png'],
  ]);
  let clock = start;
  const idle: Omit<IdleState, 'startedAt'>[] = [];
  const quote: (Quote | null)[] = [];
  const views: IdleView[] = [];
  let pending: { due: number; run: () => void } | null = null;
  const service = new IdleService({
    quotes,
    settings: { get: (n) => stored.get(n), set: (n, v) => stored.set(n, v) },
    picture: (id) => {
      const name = pictures.get(id);
      return name === undefined ? null : { name };
    },
    engine: {
      setIdle: (c) => {
        idle.push(c);
        return { ok: true, changed: true, rev: idle.length };
      },
      setQuote: (q) => {
        quote.push(q);
        return { ok: true, changed: true, rev: quote.length };
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
    changed: (v) => views.push(v),
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
  return { service, pictures, idle, quote, views, runTo };
}

describe('IdleService', () => {
  it('puts the chosen pictures, then the quote of the day, into the engine', () => {
    const t = setup();
    expect(t.idle.at(-1)).toEqual({ items: [], secondsEach: 10, dissolveMs: 1500 });
    const q1 = t.service.saveQuote(null, {
      words: { en: 'Placeholder quote one' },
      attribution: 'Placeholder',
    });
    const q2 = t.service.saveQuote(null, { words: { gu: 'નમૂનાનું બીજું વાક્ય' }, attribution: '' });
    expect(q1.ok && q2.ok).toBe(true);
    expect(
      t.service.saveSettings({ pictures: ['pic-b', 'pic-a', 'pic-b'], secondsEach: 4, quoteOfTheDay: true }),
    ).toEqual({ ok: true });
    const content = t.idle.at(-1);
    expect(content?.secondsEach).toBe(4);
    expect(content?.items.slice(0, 2)).toEqual([
      { kind: 'picture', mediaId: 'pic-b' },
      { kind: 'picture', mediaId: 'pic-a' },
    ]);
    const today = t.quote.at(-1);
    expect(content?.items[2]).toEqual({ kind: 'quote', quote: today });
    expect(t.views.at(-1)?.quoteOfTheDay).toEqual(today);
    // Without the quote of the day: the pictures only (the stage box still has it).
    t.service.saveSettings({ pictures: ['pic-a'], secondsEach: 4, quoteOfTheDay: false });
    expect(t.idle.at(-1)?.items).toEqual([{ kind: 'picture', mediaId: 'pic-a' }]);
    expect(t.quote.at(-1)).toEqual(today);
  });

  it('changes the quote of the day just after midnight', () => {
    const t = setup();
    t.service.saveQuote(null, { words: { en: 'Placeholder quote one' }, attribution: '' });
    t.service.saveQuote(null, { words: { en: 'Placeholder quote two' }, attribution: '' });
    const today = t.quote.at(-1);
    t.runTo(new Date(2026, 5, 18, 0, 0, 2).getTime());
    expect(t.quote.at(-1)).not.toEqual(today);
    t.runTo(new Date(2026, 5, 19, 0, 0, 2).getTime());
    expect(t.quote.at(-1)).toEqual(today);
  });

  it('leaves out a picture gone from the library, and refuses to choose one', () => {
    const t = setup();
    t.service.saveSettings({ pictures: ['pic-a', 'pic-b'], secondsEach: 10, quoteOfTheDay: false });
    t.pictures.delete('pic-b');
    t.service.refresh();
    expect(t.idle.at(-1)?.items).toEqual([{ kind: 'picture', mediaId: 'pic-a' }]);
    expect(t.views.at(-1)?.pictures).toEqual([
      { mediaId: 'pic-a', name: 'Placeholder darshan A.png' },
      { mediaId: 'pic-b', name: null },
    ]);
    expect(t.service.saveSettings({ pictures: ['pic-b'], secondsEach: 10, quoteOfTheDay: false })).toEqual({
      ok: false,
      message: 'A chosen picture is no longer in the media library.',
    });
    expect(t.service.saveSettings({ pictures: [], secondsEach: 1, quoteOfTheDay: false }).ok).toBe(false);
  });

  it('edits and removes quotes, saying why one is refused', () => {
    const t = setup();
    expect(t.service.saveQuote(null, { words: {}, attribution: '' })).toEqual({
      ok: false,
      message: 'Give its words in at least one language.',
    });
    const made = t.service.saveQuote(null, { words: { hi: 'नमूना वाक्य' }, attribution: 'Placeholder' });
    if (!made.ok) throw new Error(made.message);
    t.service.saveQuote(made.id, { words: { hi: 'नमूना वाक्य', en: 'Placeholder words' }, attribution: '' });
    expect(t.views.at(-1)?.quotes).toEqual([
      { id: made.id, words: { hi: 'नमूना वाक्य', en: 'Placeholder words' }, attribution: '' },
    ]);
    expect(t.service.removeQuote(made.id)).toEqual({ ok: true });
    expect(t.quote.at(-1)).toBeNull();
    expect(t.service.removeQuote(made.id)).toEqual({ ok: false, message: 'That quote is no longer there.' });
  });
});
