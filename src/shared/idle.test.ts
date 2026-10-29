import { describe, expect, it } from 'vitest';
import { quoteOfTheDay } from './idle';

/*
 * What is left of the idle rotation (Session 55, Part 12): the quote of the day a stage layout's Quote box shows, one
 * of the library's quotes. Placeholder ids only.
 */

describe('the quote of the day', () => {
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
});
