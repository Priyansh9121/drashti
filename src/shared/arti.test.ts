import { describe, expect, it } from 'vitest';
import { artiTimes, artiWhen, countdownText, localDate, nextArtiTime } from './arti';

describe('arti times', () => {
  it('come at the local time on every chosen day, clock changes and all', () => {
    const from = new Date(2026, 0, 1).getTime();
    const times = artiTimes(
      { days: [0, 1, 2, 3, 4, 5, 6], date: null, time: '19:30' },
      from,
      from + 366 * 864e5,
    );
    expect(times.length).toBe(366);
    for (const t of times) {
      const d = new Date(t);
      expect([d.getHours(), d.getMinutes()]).toEqual([19, 30]);
    }
    // One a day, in order.
    expect(new Set(times.map((t) => localDate(new Date(t)))).size).toBe(366);
  });

  it('keep to the days of the week, or one date', () => {
    const wednesday = new Date(2026, 5, 17).getTime();
    const week = artiTimes({ days: [0, 6], date: null, time: '07:00' }, wednesday, wednesday + 7 * 864e5);
    expect(week.map((t) => new Date(t).getDay())).toEqual([6, 0]);
    expect(
      artiTimes({ days: [], date: '2026-06-20', time: '07:00' }, wednesday, wednesday + 30 * 864e5),
    ).toEqual([new Date(2026, 5, 20, 7).getTime()]);
    expect(nextArtiTime({ days: [], date: '2026-06-16', time: '07:00' }, wednesday)).toBeNull();
    expect(nextArtiTime({ days: [], date: '2027-01-02', time: '07:00' }, wednesday)).toBe(
      new Date(2027, 0, 2, 7).getTime(),
    );
  });

  it('read in words, and count down', () => {
    expect(artiWhen({ days: [0, 3], date: null, time: '19:00' })).toBe('Sun, Wed 19:00');
    expect(artiWhen({ days: [0, 1, 2, 3, 4, 5, 6], date: null, time: '07:00' })).toBe('Every day 07:00');
    expect(artiWhen({ days: [], date: '2026-11-12', time: '18:30' })).toBe('2026-11-12 18:30');
    expect(countdownText(299_001)).toBe('5:00');
    expect(countdownText(59_000)).toBe('0:59');
    expect(countdownText(3_600_000)).toBe('1:00:00');
    expect(countdownText(-5)).toBe('0:00');
  });
});
