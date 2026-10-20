import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { LowerThird, LowerThirdInput, LowerThirdLook } from '../../shared/lower-thirds';
import { DEFAULT_LOWER_THIRD_LOOK, lowerThirdLookSchema } from '../../shared/lower-thirds';
import type { Db } from './database';

/*
 * Lower Thirds in the library (migration 45, Session 44): its lines, look, where it shows and its animation, in
 * the list's order. Deleting only marks one (`remove`), so Undo can bring it back (`restore`); marked ones are
 * gone for good when Drashti next starts (`purge`). A look or lines that cannot be read come back as the
 * defaults, so one bad row never hides the rest.
 */

interface Row {
  id: string;
  lines: string;
  look: string;
  target: string;
  animation: string;
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const linesSchema = z.array(z.string()).min(1).max(3);
const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

function parse<T>(schema: z.ZodType<T>, json: string, otherwise: T): T {
  try {
    const parsed = schema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : otherwise;
  } catch {
    return otherwise;
  }
}

function fromRow(r: Row): LowerThird {
  return {
    id: r.id,
    lines: parse(linesSchema, r.lines, ['']),
    look: parse<LowerThirdLook>(lowerThirdLookSchema, r.look, DEFAULT_LOWER_THIRD_LOOK),
    where: r.target === 'hall' || r.target === 'stream' ? r.target : 'both',
    animation: r.animation,
  };
}

export class LowerThirdRepo {
  constructor(private readonly db: Db) {}

  /** Every one not deleted, in the list's order. */
  list(): LowerThird[] {
    const rows = this.db
      .prepare(
        `SELECT id, lines, look, target, animation FROM lower_thirds
          WHERE deleted_at IS NULL ORDER BY position, rowid`,
      )
      .all() as Row[];
    return rows.map(fromRow);
  }

  get(id: string): LowerThird | null {
    const row = this.db
      .prepare(
        'SELECT id, lines, look, target, animation FROM lower_thirds WHERE id = ? AND deleted_at IS NULL',
      )
      .get(id) as Row | undefined;
    return row ? fromRow(row) : null;
  }

  /** A new one at the end of the list: its id. */
  create(input: LowerThirdInput): string {
    const id = randomUUID();
    const { next } = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM lower_thirds')
      .get() as {
      next: number;
    };
    this.db
      .prepare(
        'INSERT INTO lower_thirds (id, position, lines, look, target, animation) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, next, JSON.stringify(input.lines), JSON.stringify(input.look), input.where, input.animation);
    return id;
  }

  /** Change one: false when it is not there (or deleted). */
  update(id: string, input: LowerThirdInput): boolean {
    return (
      this.db
        .prepare(
          `UPDATE lower_thirds SET lines = ?, look = ?, target = ?, animation = ?, updated_at = ${NOW}
            WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(JSON.stringify(input.lines), JSON.stringify(input.look), input.where, input.animation, id)
        .changes > 0
    );
  }

  /** Mark these deleted (Undo can bring them back until Drashti next starts): the ids it marked. */
  remove(ids: readonly string[]): string[] {
    if (ids.length === 0) return [];
    return this.db.transaction(() => {
      const rows = (
        this.db
          .prepare(
            `SELECT id FROM lower_thirds WHERE deleted_at IS NULL AND id IN (${placeholders(ids.length)})`,
          )
          .all(...ids) as { id: string }[]
      ).map((r) => r.id);
      // In the order asked for.
      const there = new Set(rows);
      const found = [...new Set(ids)].filter((id) => there.has(id));
      if (found.length > 0)
        this.db
          .prepare(`UPDATE lower_thirds SET deleted_at = ${NOW} WHERE id IN (${placeholders(found.length)})`)
          .run(...found);
      return found;
    })();
  }

  /** Bring back these deleted ones, in their places: the ids it brought back. */
  restore(ids: readonly string[]): string[] {
    if (ids.length === 0) return [];
    return this.db.transaction(() => {
      const rows = (
        this.db
          .prepare(
            `SELECT id FROM lower_thirds WHERE deleted_at IS NOT NULL AND id IN (${placeholders(ids.length)})`,
          )
          .all(...ids) as { id: string }[]
      ).map((r) => r.id);
      // In the order asked for.
      const there = new Set(rows);
      const found = [...new Set(ids)].filter((id) => there.has(id));
      if (found.length > 0)
        this.db
          .prepare(`UPDATE lower_thirds SET deleted_at = NULL WHERE id IN (${placeholders(found.length)})`)
          .run(...found);
      return found;
    })();
  }

  /** Those deleted before this start go for good (they can no longer be undone). */
  purge(): void {
    this.db.prepare('DELETE FROM lower_thirds WHERE deleted_at IS NOT NULL').run();
  }
}
