import { describe, expect, it } from 'vitest';
import {
  dayLabel,
  dayOf,
  isLogPeriod,
  nextDayStart,
  periodChoices,
  periodDays,
  periodRange,
  periodText,
} from './log-period';

/*
 * The log of a chosen period (alpha.21, logs for 100+ installs (c), the owner's "Yes, that plan"): Today, Yesterday,
 * the last 7 days, or one chosen day, by this computer's own days. The clock here is the test's own.
 */

/** A moment in this computer's time zone. */
const at = (month: number, day: number, hour: number) => new Date(2026, month - 1, day, hour).getTime();

describe('the log’s days and periods', () => {
  it('names a day by this computer’s own date, and knows when the next begins', () => {
    expect(dayOf(at(11, 23, 0))).toBe('2026-11-23');
    expect(dayOf(at(11, 23, 23) + 59 * 60_000)).toBe('2026-11-23');
    expect(nextDayStart(at(11, 23, 15))).toBe(new Date(2026, 10, 24).getTime());
    expect(nextDayStart(at(12, 31, 15))).toBe(new Date(2027, 0, 1).getTime());
  });

  it('gives each period’s days, oldest first, over a month’s end too', () => {
    const now = at(12, 2, 10);
    expect(periodDays('today', now)).toEqual(['2026-12-02']);
    expect(periodDays('yesterday', now)).toEqual(['2026-12-01']);
    expect(periodDays('last-7-days', now)).toEqual([
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
      '2026-11-29',
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
    ]);
    expect(periodDays('2026-11-20', now)).toEqual(['2026-11-20']);
  });

  it('takes only the three named periods or a real day', () => {
    for (const p of ['today', 'yesterday', 'last-7-days', '2026-11-20', '2024-02-29'])
      expect(isLogPeriod(p), p).toBe(true);
    for (const p of ['tomorrow', '', '2026-02-30', '2026-13-01', '26-11-20', '2026-11-20T00:00', 3, null])
      expect(isLogPeriod(p), String(p)).toBe(false);
  });

  it('says its time range, from the first day’s start to the last day’s end', () => {
    const now = at(11, 23, 10);
    expect(periodRange('today', now)).toEqual({
      from: new Date(2026, 10, 23).getTime(),
      to: new Date(2026, 10, 24).getTime(),
    });
    expect(periodRange('last-7-days', now)).toEqual({
      from: new Date(2026, 10, 17).getTime(),
      to: new Date(2026, 10, 24).getTime(),
    });
    expect(periodRange('2026-11-20', now)).toEqual({
      from: new Date(2026, 10, 20).getTime(),
      to: new Date(2026, 10, 21).getTime(),
    });
  });

  it('says the period in a diagnostics file’s words', () => {
    const now = at(11, 23, 10);
    expect(periodText('today', now)).toBe('Today, 2026-11-23');
    expect(periodText('yesterday', now)).toBe('Yesterday, 2026-11-22');
    expect(periodText('last-7-days', now)).toBe('The last 7 days, 2026-11-17 to 2026-11-23');
    expect(periodText('2026-11-20', now)).toBe('One day, 2026-11-20');
  });

  it('offers Today, Yesterday and the last 7 days, then each earlier day kept, newest first, as a person reads it', () => {
    const now = at(11, 23, 10);
    const choices = periodChoices(
      ['2026-11-23', '2026-11-22', '2026-11-21', '2026-11-18', '2025-12-30'],
      now,
    );
    expect(choices).toEqual([
      { period: 'today', label: 'Today' },
      { period: 'yesterday', label: 'Yesterday' },
      { period: 'last-7-days', label: 'The last 7 days' },
      { period: '2026-11-21', label: 'Sat 21 Nov' },
      { period: '2026-11-18', label: 'Wed 18 Nov' },
      { period: '2025-12-30', label: 'Tue 30 Dec 2025' },
    ]);
    expect(dayLabel('2026-11-21', now)).toBe('Sat 21 Nov');
  });
});
