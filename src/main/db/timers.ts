import { randomUUID } from 'node:crypto';
import { type AudienceTimerLook, readTimerLook } from '../../shared/timer-look';
import type { TimerDefinition, TimerFields, TimerKind } from '../../shared/timers';
import type { Db } from './database';
import { SettingsRepo } from './settings';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/**
 * Each timer's look for the audience (Session 55, Part 15), by its id, in one setting beside the timers: no change to
 * the library's tables, so an older library reads whole (its timers have the default look) and an older Drashti
 * reading this library sees its timers as they were.
 */
const LOOKS = 'timer-looks';

interface TimerRow {
  id: string;
  name: string;
  kind: TimerKind;
  duration_ms: number | null;
  target_time: string | null;
  allows_overrun: number;
}

const toTimer = (r: TimerRow, look: AudienceTimerLook | undefined): TimerDefinition => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  durationMs: r.duration_ms ?? 0,
  targetTime: r.target_time,
  allowsOverrun: r.allows_overrun === 1,
  ...(look ? { look } : {}),
});

/** The timers the operator has made (how they count; whether they run is the engine's). */
export class TimerRepo {
  private readonly settings: SettingsRepo;

  constructor(private readonly db: Db) {
    this.settings = new SettingsRepo(db);
  }

  /** The looks kept, each read whole or left out (the default). */
  private looks(): Record<string, AudienceTimerLook> {
    const kept = this.settings.get(LOOKS);
    if (typeof kept !== 'object' || kept === null || Array.isArray(kept)) return {};
    const out: Record<string, AudienceTimerLook> = {};
    for (const [id, value] of Object.entries(kept)) {
      const look = readTimerLook(value);
      if (look) out[id] = look;
    }
    return out;
  }

  /** One timer's look kept (or let go, with null). */
  private keepLook(id: string, look: AudienceTimerLook | null): void {
    const looks = Object.entries(this.looks()).filter(([kept]) => kept !== id);
    this.settings.set(LOOKS, Object.fromEntries(look ? [...looks, [id, look]] : looks));
  }

  list(): TimerDefinition[] {
    const looks = this.looks();
    return (
      this.db
        .prepare('SELECT id, name, kind, duration_ms, target_time, allows_overrun FROM timers ORDER BY rowid')
        .all() as TimerRow[]
    ).map((r) => toTimer(r, Object.hasOwn(looks, r.id) ? looks[r.id] : undefined));
  }

  create(fields: TimerFields): string {
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO timers (id, name, kind, duration_ms, target_time, allows_overrun) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, fields.name, fields.kind, fields.durationMs, fields.targetTime, fields.allowsOverrun ? 1 : 0);
    if (fields.look) this.keepLook(id, fields.look);
    return id;
  }

  /** Its fields changed; its look too when given (left out, the one it has stays). */
  update(id: string, fields: TimerFields): boolean {
    const changed =
      this.db
        .prepare(
          `UPDATE timers SET name = ?, kind = ?, duration_ms = ?, target_time = ?, allows_overrun = ?, updated_at = ${NOW}
            WHERE id = ?`,
        )
        .run(fields.name, fields.kind, fields.durationMs, fields.targetTime, fields.allowsOverrun ? 1 : 0, id)
        .changes === 1;
    if (changed && fields.look) this.keepLook(id, fields.look);
    return changed;
  }

  remove(id: string): boolean {
    const removed = this.db.prepare('DELETE FROM timers WHERE id = ?').run(id).changes === 1;
    if (removed && Object.hasOwn(this.looks(), id)) this.keepLook(id, null);
    return removed;
  }
}
