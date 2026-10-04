import { randomUUID } from 'node:crypto';
import type { CalendarDay, CalendarFile, CalendarInfo, CalendarName } from '../../shared/calendar';
import { calendarKey } from '../../shared/calendar';
import type { Db } from './database';

/*
 * Calendars an admin loads (migration 28): known by their name, so loading
 * one again replaces its days; the same file loaded again changes nothing.
 * A day's names (month, paksha, tithi, festivals) are kept as JSON. Where
 * two calendars give a date, the one loaded last is used.
 */

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export interface CalendarLoad {
  calendarId: string;
  outcome: 'added' | 'updated' | 'unchanged';
  days: number;
  festivals: number;
  firstDate: string;
  lastDate: string;
  /** Dates another calendar gives too (this one is used for them now). */
  overlapping: number;
}

interface Names {
  month: CalendarName;
  paksha: CalendarName;
  tithi: CalendarName;
  festivals: CalendarName[];
}

interface CalendarRow {
  id: string;
  name: string;
  description: string | null;
  first_date: string;
  last_date: string;
  day_count: number;
  loaded_at: string;
}

const info = (r: CalendarRow): CalendarInfo => ({
  id: r.id,
  name: r.name,
  description: r.description,
  firstDate: r.first_date,
  lastDate: r.last_date,
  dayCount: r.day_count,
  loadedAt: r.loaded_at,
});

function names(json: string): Names | null {
  try {
    const parsed = JSON.parse(json) as Partial<Names>;
    if (!parsed.month || !parsed.paksha || !parsed.tithi) return null;
    return {
      month: parsed.month,
      paksha: parsed.paksha,
      tithi: parsed.tithi,
      festivals: Array.isArray(parsed.festivals) ? parsed.festivals : [],
    };
  } catch {
    return null;
  }
}

export class CalendarRepo {
  constructor(private readonly db: Db) {}

  /** Load a calendar, or replace the days of the one with its name. Call inside a transaction. */
  load(calendar: CalendarFile, source: { path: string | null; hash: string | null }): CalendarLoad {
    const key = calendarKey(calendar.name);
    const days = calendar.days;
    const firstDate = days[0]?.date ?? '';
    const lastDate = days.at(-1)?.date ?? '';
    const festivals = days.reduce((n, d) => n + d.festivals.length, 0);
    const earlier = this.db.prepare('SELECT id, source_hash FROM calendars WHERE key = ?').get(key) as
      { id: string; source_hash: string | null } | undefined;
    const counts = { days: days.length, festivals, firstDate, lastDate };
    if (earlier && source.hash !== null && earlier.source_hash === source.hash)
      return { calendarId: earlier.id, outcome: 'unchanged', overlapping: 0, ...counts };
    const calendarId = earlier?.id ?? randomUUID();
    if (earlier) {
      this.db
        .prepare(
          `UPDATE calendars SET name = ?, description = ?, first_date = ?, last_date = ?, day_count = ?,
             source_path = ?, source_hash = ?, loaded_at = ${NOW} WHERE id = ?`,
        )
        .run(
          calendar.name,
          calendar.description,
          firstDate,
          lastDate,
          days.length,
          source.path,
          source.hash,
          calendarId,
        );
      this.db.prepare('DELETE FROM calendar_days WHERE calendar_id = ?').run(calendarId);
    } else {
      this.db
        .prepare(
          `INSERT INTO calendars (id, key, name, description, first_date, last_date, day_count, source_path, source_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          calendarId,
          key,
          calendar.name,
          calendar.description,
          firstDate,
          lastDate,
          days.length,
          source.path,
          source.hash,
        );
    }
    const insert = this.db.prepare(
      'INSERT INTO calendar_days (calendar_id, date, samvat, names) VALUES (?, ?, ?, ?)',
    );
    for (const d of days)
      insert.run(
        calendarId,
        d.date,
        d.samvat,
        JSON.stringify({ month: d.month, paksha: d.paksha, tithi: d.tithi, festivals: d.festivals }),
      );
    const overlapping = (
      this.db
        .prepare(
          `SELECT COUNT(DISTINCT d.date) AS n FROM calendar_days d
            WHERE d.calendar_id <> ? AND d.date IN (SELECT date FROM calendar_days WHERE calendar_id = ?)`,
        )
        .get(calendarId, calendarId) as { n: number }
    ).n;
    return { calendarId, outcome: earlier ? 'updated' : 'added', overlapping, ...counts };
  }

  list(): CalendarInfo[] {
    return (
      this.db
        .prepare(
          'SELECT id, name, description, first_date, last_date, day_count, loaded_at FROM calendars ORDER BY first_date, name',
        )
        .all() as CalendarRow[]
    ).map(info);
  }

  /** A date's entry: from the calendar loaded last that gives it; null when none does. */
  day(date: string): CalendarDay | null {
    const row = this.db
      .prepare(
        `SELECT d.date, d.samvat, d.names FROM calendar_days d JOIN calendars c ON c.id = d.calendar_id
          WHERE d.date = ? ORDER BY c.loaded_at DESC, c.rowid DESC LIMIT 1`,
      )
      .get(date) as { date: string; samvat: number; names: string } | undefined;
    if (!row) return null;
    const n = names(row.names);
    return n ? { date: row.date, samvat: row.samvat, ...n } : null;
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM calendars WHERE id = ?').run(id).changes > 0;
  }
}
