import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CalendarDay, CalendarView } from '../../shared/calendar';
import { readCalendarFile } from '../../shared/calendar';
import { CalendarRepo } from '../db/calendar';
import { openDatabase } from '../db/database';
import { CalendarService } from './calendar-service';

/* Today's entry from the loaded calendars, on a fake clock (placeholder names only). */

const names = (n: number) => ({
  samvat: 1001,
  month: { en: 'Placeholder month' },
  paksha: { en: 'First half' },
  tithi: { en: `Placeholder tithi ${String(n)}`, gu: `નમૂના તિથિ ${String(n)}` },
});

function calendar(name: string, dates: string[], tithiBase = 1) {
  const read = readCalendarFile({
    format: 'drashti-calendar',
    version: 1,
    name,
    days: dates.map((date, i) => ({ date, ...names(tithiBase + i) })),
  });
  if (!read.ok) throw new Error(read.message);
  return read.calendar;
}

function setup(start = new Date(2026, 5, 17, 23, 0).getTime()) {
  const db = openDatabase(':memory:');
  const repo = new CalendarRepo(db);
  let clock = start;
  const set: (CalendarDay | null)[] = [];
  const views: CalendarView[] = [];
  let pending: { due: number; run: () => void } | null = null;
  const load = (c: ReturnType<typeof calendar>, hash: string | null = null) =>
    db.transaction(() => repo.load(c, { path: null, hash }))();
  const make = () =>
    new CalendarService({
      repo,
      engine: {
        setCalendar: (day) => {
          set.push(day);
          return { ok: true, changed: true, rev: set.length };
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
      log: () => undefined,
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
  return { repo, load, make, runTo, set, views };
}

describe('CalendarService', () => {
  it("puts today's entry in the engine, and the next day's just after midnight", () => {
    const t = setup();
    t.load(calendar('Placeholder calendar', ['2026-06-17', '2026-06-18']));
    const service = t.make();
    expect(t.set.at(-1)).toMatchObject({ date: '2026-06-17', tithi: { en: 'Placeholder tithi 1' } });
    t.runTo(new Date(2026, 5, 18, 0, 0, 2).getTime());
    expect(t.set.at(-1)).toMatchObject({ date: '2026-06-18', tithi: { en: 'Placeholder tithi 2' } });
    // A date the calendar does not give shows nothing.
    t.runTo(new Date(2026, 5, 19, 0, 0, 2).getTime());
    expect(t.set.at(-1)).toBeNull();
    expect(t.views.at(-1)?.today).toBeNull();
    service.dispose();
  });

  it('loads a calendar again by its name, unchanged for the same file, and the one loaded last wins a date', () => {
    const t = setup();
    const first = t.load(calendar('Placeholder calendar', ['2026-06-17']), 'a');
    expect(first).toMatchObject({ outcome: 'added', days: 1, overlapping: 0 });
    expect(t.load(calendar('Placeholder calendar', ['2026-06-17']), 'a')).toMatchObject({
      outcome: 'unchanged',
      calendarId: first.calendarId,
    });
    expect(t.load(calendar('placeholder  CALENDAR', ['2026-06-16', '2026-06-17'], 5), 'b')).toMatchObject({
      outcome: 'updated',
      calendarId: first.calendarId,
      days: 2,
      firstDate: '2026-06-16',
    });
    expect(t.repo.day('2026-06-17')?.tithi.en).toBe('Placeholder tithi 6');
    // Another calendar that gives the same date, loaded later: used for it.
    const other = t.load(calendar('Second placeholder calendar', ['2026-06-17'], 9), 'c');
    expect(other.overlapping).toBe(1);
    expect(t.repo.day('2026-06-17')?.tithi.en).toBe('Placeholder tithi 9');
    expect(t.repo.list().map((c) => [c.name, c.dayCount])).toEqual([
      ['placeholder  CALENDAR', 2],
      ['Second placeholder calendar', 1],
    ]);
  });

  it('removing a calendar takes its dates away at once', () => {
    const t = setup();
    const loaded = t.load(calendar('Placeholder calendar', ['2026-06-17']));
    const service = t.make();
    expect(t.set.at(-1)).not.toBeNull();
    expect(service.remove(loaded.calendarId)).toEqual({ ok: true });
    expect(t.set.at(-1)).toBeNull();
    expect(t.views.at(-1)?.calendars).toEqual([]);
    expect(service.remove(loaded.calendarId)).toEqual({
      ok: false,
      message: 'That calendar is no longer loaded.',
    });
    service.dispose();
  });

  it('reads the example calendar in docs', () => {
    const json: unknown = JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', '..', 'docs', 'examples', 'placeholder-calendar.json'),
        'utf8',
      ),
    );
    const read = readCalendarFile(json);
    expect(read).toMatchObject({ ok: true, issues: [] });
    if (!read.ok) return;
    expect(read.calendar.days.map((d) => d.date)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06']);
    expect(read.calendar.days[1]?.festivals).toEqual([]);
  });
});
