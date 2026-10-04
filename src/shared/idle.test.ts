import { describe, expect, it } from 'vitest';
import { idleFrame, type IdleItem, quoteFieldsSchema, quoteOfTheDay } from './idle';

const items: IdleItem[] = [
  { kind: 'picture', mediaId: 'a' },
  { kind: 'picture', mediaId: 'b' },
  { kind: 'quote', quote: { id: 'q', words: { en: 'Placeholder quote' }, attribution: '' } },
];
const idle = { items, secondsEach: 10, dissolveMs: 1500 };

describe('the idle rotation', () => {
  it('works out the item up from its start, and dissolves into the next over the end of each', () => {
    const start = 1_000_000;
    expect(idleFrame(idle, start, start)).toEqual({ index: 0, next: 1, fade: 0 });
    expect(idleFrame(idle, start, start + 8_499)).toEqual({ index: 0, next: 1, fade: 0 });
    expect(idleFrame(idle, start, start + 9_250)?.fade).toBeCloseTo(0.5);
    expect(idleFrame(idle, start, start + 10_000)).toEqual({ index: 1, next: 2, fade: 0 });
    // Round again after the last.
    expect(idleFrame(idle, start, start + 25_000)).toEqual({ index: 2, next: 0, fade: 0 });
    expect(idleFrame(idle, start, start + 30_000)?.index).toBe(0);
    // Two windows at the same time agree, whatever they drew before.
    expect(idleFrame(idle, start, start + 123_456)).toEqual(idleFrame(idle, start, start + 123_456));
  });

  it('shows one item without a dissolve, and nothing with none', () => {
    expect(idleFrame({ ...idle, items: items.slice(0, 1) }, 0, 99_999)).toEqual({
      index: 0,
      next: 0,
      fade: 0,
    });
    expect(idleFrame({ ...idle, items: [] }, 0, 5)).toBeNull();
  });

  it('has one quote of the day, the same all day and round the list day by day', () => {
    const quotes = ['q1', 'q2', 'q3'];
    const today = quoteOfTheDay(quotes, '2026-06-17');
    expect(quoteOfTheDay(quotes, '2026-06-17')).toBe(today);
    const week = ['2026-06-17', '2026-06-18', '2026-06-19', '2026-06-20'].map((d) =>
      quoteOfTheDay(quotes, d),
    );
    expect(new Set(week.slice(0, 3)).size).toBe(3);
    expect(week[3]).toBe(week[0]);
    expect(quoteOfTheDay([], '2026-06-17')).toBeNull();
  });

  it('takes a quote with words in at least one language', () => {
    expect(quoteFieldsSchema.safeParse({ words: { gu: 'નમૂનો' }, attribution: '' }).success).toBe(true);
    expect(quoteFieldsSchema.safeParse({ words: {}, attribution: 'Placeholder' }).success).toBe(false);
    expect(quoteFieldsSchema.safeParse({ words: { fr: 'x' }, attribution: '' }).success).toBe(false);
  });
});
