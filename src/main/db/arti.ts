import { randomUUID } from 'node:crypto';
import type { ArtiFields, ArtiSchedule } from '../../shared/arti';
import type { Db } from './database';

/*
 * Arti schedules (migration 27), in the admin's order. The days are kept as
 * JSON; a schedule whose presentation was removed for good keeps its place
 * with no presentation, until the admin chooses another or removes it.
 */

interface Row {
  id: string;
  presentation_name?: string | null;
  name: string;
  presentation_id: string | null;
  days: string;
  date: string | null;
  time: string;
  prompt_minutes: number;
  by_itself: number;
  enabled: number;
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const COLUMNS = 'id, name, presentation_id, days, date, time, prompt_minutes, by_itself, enabled';

function days(json: string): number[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)
      : [];
  } catch {
    return [];
  }
}

const parse = (r: Row): ArtiSchedule => ({
  id: r.id,
  name: r.name,
  presentationId: r.presentation_id,
  days: days(r.days),
  date: r.date,
  time: r.time,
  promptMinutes: r.prompt_minutes,
  byItself: r.by_itself === 1,
  enabled: r.enabled === 1,
});

export interface StoredArti extends ArtiSchedule {
  /** Its presentation's name; null when there is none, or it was removed. */
  presentationName: string | null;
}

export class ArtiRepo {
  constructor(private readonly db: Db) {}

  list(): StoredArti[] {
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS.split(', ')
          .map((c) => `a.${c}`)
          .join(', ')},
                CASE WHEN p.deleted_at IS NULL THEN p.name END AS presentation_name
           FROM arti_schedules a LEFT JOIN presentations p ON p.id = a.presentation_id
          ORDER BY a.position, a.rowid`,
      )
      .all() as Row[];
    return rows.map((r) => ({ ...parse(r), presentationName: r.presentation_name ?? null }));
  }

  get(id: string): ArtiSchedule | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM arti_schedules WHERE id = ?`).get(id) as
      Row | undefined;
    return row ? parse(row) : null;
  }

  /** A presentation in the library (not removed). */
  hasPresentation(id: string): boolean {
    return (
      this.db.prepare('SELECT 1 FROM presentations WHERE id = ? AND deleted_at IS NULL').get(id) !== undefined
    );
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM arti_schedules').get() as { n: number }).n;
  }

  create(f: ArtiFields): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO arti_schedules
           (id, name, presentation_id, days, date, time, prompt_minutes, by_itself, enabled, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM arti_schedules))`,
      )
      .run(
        id,
        f.name,
        f.presentationId,
        JSON.stringify(f.days),
        f.date,
        f.time,
        f.promptMinutes,
        f.byItself ? 1 : 0,
        f.enabled ? 1 : 0,
      );
    return id;
  }

  save(id: string, f: ArtiFields): boolean {
    return (
      this.db
        .prepare(
          `UPDATE arti_schedules SET name = ?, presentation_id = ?, days = ?, date = ?, time = ?,
             prompt_minutes = ?, by_itself = ?, enabled = ?, updated_at = ${NOW}
           WHERE id = ?`,
        )
        .run(
          f.name,
          f.presentationId,
          JSON.stringify(f.days),
          f.date,
          f.time,
          f.promptMinutes,
          f.byItself ? 1 : 0,
          f.enabled ? 1 : 0,
          id,
        ).changes > 0
    );
  }

  setEnabled(id: string, enabled: boolean): boolean {
    return (
      this.db
        .prepare(`UPDATE arti_schedules SET enabled = ?, updated_at = ${NOW} WHERE id = ?`)
        .run(enabled ? 1 : 0, id).changes > 0
    );
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM arti_schedules WHERE id = ?').run(id).changes > 0;
  }
}
