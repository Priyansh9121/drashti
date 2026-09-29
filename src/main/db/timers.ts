import { randomUUID } from 'node:crypto';
import type { TimerDefinition, TimerFields, TimerKind } from '../../shared/timers';
import type { Db } from './database';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

interface TimerRow {
  id: string;
  name: string;
  kind: TimerKind;
  duration_ms: number | null;
  target_time: string | null;
  allows_overrun: number;
}

const toTimer = (r: TimerRow): TimerDefinition => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  durationMs: r.duration_ms ?? 0,
  targetTime: r.target_time,
  allowsOverrun: r.allows_overrun === 1,
});

/** The timers the operator has made (how they count; whether they run is the engine's). */
export class TimerRepo {
  constructor(private readonly db: Db) {}

  list(): TimerDefinition[] {
    return (
      this.db
        .prepare('SELECT id, name, kind, duration_ms, target_time, allows_overrun FROM timers ORDER BY rowid')
        .all() as TimerRow[]
    ).map(toTimer);
  }

  create(fields: TimerFields): string {
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO timers (id, name, kind, duration_ms, target_time, allows_overrun) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, fields.name, fields.kind, fields.durationMs, fields.targetTime, fields.allowsOverrun ? 1 : 0);
    return id;
  }

  update(id: string, fields: TimerFields): boolean {
    return (
      this.db
        .prepare(
          `UPDATE timers SET name = ?, kind = ?, duration_ms = ?, target_time = ?, allows_overrun = ?, updated_at = ${NOW}
            WHERE id = ?`,
        )
        .run(fields.name, fields.kind, fields.durationMs, fields.targetTime, fields.allowsOverrun ? 1 : 0, id)
        .changes === 1
    );
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM timers WHERE id = ?').run(id).changes === 1;
  }
}
