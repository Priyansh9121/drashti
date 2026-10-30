import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isAnimation } from '../../shared/lower-third-animations';
import type { LowerThird, LowerThirdInput } from '../../shared/lower-thirds';
import {
  DEFAULT_LOWER_THIRD_LOOK,
  lowerThirdLookSchema,
  lowerThirdSecondsSchema,
} from '../../shared/lower-thirds';
import type { Db } from './database';

/*
 * Lower Thirds in the library (migration 45, Session 44): its lines, look, where it shows and its animation, in
 * the list's order. Deleting only marks one (`remove`), so Undo can bring it back (`restore`); marked ones are
 * gone for good when Drashti next starts (`purge`). A look or lines that cannot be read come back as the
 * defaults, so one bad row never hides the rest.
 *
 * The Lower Thirds studio (Session 55, Part 16) keeps its choices in the look's JSON, so no migration is needed: the
 * look's own new fields (a style, an accent, a moving background), and beside them how it goes out (`outAnimation`)
 * and the seconds it stays up (`seconds`). One kept before the studio has none of them and reads as it was; an out
 * or seconds this Drashti cannot use are left out, the rest kept.
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

/** The look column: the look itself, and the studio's out and seconds kept beside it. */
function lookOf(json: string): Pick<LowerThird, 'look' | 'outAnimation' | 'seconds'> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { look: DEFAULT_LOWER_THIRD_LOOK };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { look: DEFAULT_LOWER_THIRD_LOOK };
  const { outAnimation, seconds, ...rest } = raw as Record<string, unknown>;
  const look = lowerThirdLookSchema.safeParse(rest);
  const kept = lowerThirdSecondsSchema.safeParse(seconds);
  return {
    look: look.success ? look.data : DEFAULT_LOWER_THIRD_LOOK,
    ...(typeof outAnimation === 'string' && isAnimation(outAnimation) ? { outAnimation } : {}),
    ...(kept.success ? { seconds: kept.data } : {}),
  };
}

/** What the look column keeps: the look, with the studio's out and seconds when it has them. */
const lookColumn = (input: LowerThirdInput): string =>
  JSON.stringify({
    ...input.look,
    ...(input.outAnimation === undefined ? {} : { outAnimation: input.outAnimation }),
    ...(input.seconds === undefined ? {} : { seconds: input.seconds }),
  });

function fromRow(r: Row): LowerThird {
  return {
    id: r.id,
    lines: parse(linesSchema, r.lines, ['']),
    ...lookOf(r.look),
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
      .run(id, next, JSON.stringify(input.lines), lookColumn(input), input.where, input.animation);
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
        .run(JSON.stringify(input.lines), lookColumn(input), input.where, input.animation, id).changes > 0
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
