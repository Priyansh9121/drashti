import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isLowerThirdAnimation } from '../../shared/lower-third-animations';
import { FIRST_MOTIONS, LOWER_THIRD_MOTIONS, NEAREST_ALPHA17_MOTION } from '../../shared/lower-third-styles';
import type { LowerThirdMotion } from '../../shared/lower-third-styles';
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
 * or seconds this Drashti cannot use are left out, the rest kept. So is a moving background a later Drashti added
 * (Session 58, Q58-30): the rest of the look is kept. Anything else in the look this Drashti cannot read
 * still reads as the default.
 *
 * For a background added in alpha.18, the look holds the closest alpha.17 background and app_meta holds both
 * background IDs. Alpha.17 ignores these keys and sees a look it can read. Alpha.18 uses the new background
 * while the look still has the paired one, including after alpha.17 edits other fields of the lower third.
 */

interface Row {
  id: string;
  lines: string;
  look: string;
  target: string;
  animation: string;
  saved_motion: string | null;
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const MOTION_KEY_PREFIX = 'lower-third.motion.';
const SELECT_WITH_MOTION = `
  SELECT t.id, t.lines, t.look, t.target, t.animation, m.value AS saved_motion
    FROM lower_thirds t LEFT JOIN app_meta m ON m.key = ? || t.id`;
const motionPairSchema = z
  .object({
    motion: z.enum(LOWER_THIRD_MOTIONS),
    fallback: z.enum(FIRST_MOTIONS),
  })
  .nullable();
type MotionPair = z.infer<typeof motionPairSchema>;
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
function lookOf(
  json: string,
  savedMotion: string | null,
): Pick<LowerThird, 'look' | 'outAnimation' | 'seconds'> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { look: DEFAULT_LOWER_THIRD_LOOK };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { look: DEFAULT_LOWER_THIRD_LOOK };
  const { outAnimation, seconds, ...rest } = raw as Record<string, unknown>;
  const { motion, ...still } = rest;
  const later = typeof motion === 'string' && !(LOWER_THIRD_MOTIONS as readonly string[]).includes(motion);
  const parsed = lowerThirdLookSchema.safeParse(later ? still : rest);
  const look = parsed.success ? parsed.data : DEFAULT_LOWER_THIRD_LOOK;
  const pair = savedMotion === null ? null : parse(motionPairSchema, savedMotion, null);
  const kept = lowerThirdSecondsSchema.safeParse(seconds);
  return {
    // Compare with the fallback written then, so a mapping change cannot undo an older edit.
    look:
      pair && look.motion === pair.fallback && NEAREST_ALPHA17_MOTION[pair.motion] !== undefined
        ? { ...look, motion: pair.motion }
        : look,
    ...(typeof outAnimation === 'string' && isLowerThirdAnimation(outAnimation) ? { outAnimation } : {}),
    ...(kept.success ? { seconds: kept.data } : {}),
  };
}

function motionPairOf(motion: LowerThirdMotion | undefined): MotionPair {
  const fallback = motion === undefined ? undefined : NEAREST_ALPHA17_MOTION[motion];
  return motion !== undefined && fallback !== undefined ? { motion, fallback } : null;
}

/** What the look column keeps: the look, with the studio's out and seconds when it has them. */
const lookColumn = (input: LowerThirdInput, pair: MotionPair): string =>
  JSON.stringify({
    ...input.look,
    motion: pair?.fallback ?? input.look.motion,
    ...(input.outAnimation === undefined ? {} : { outAnimation: input.outAnimation }),
    ...(input.seconds === undefined ? {} : { seconds: input.seconds }),
  });

function fromRow(r: Row): LowerThird {
  return {
    id: r.id,
    lines: parse(linesSchema, r.lines, ['']),
    ...lookOf(r.look, r.saved_motion),
    where: r.target === 'hall' || r.target === 'stream' ? r.target : 'both',
    animation: r.animation,
  };
}

export class LowerThirdRepo {
  constructor(private readonly db: Db) {}

  /** Every one not deleted, in the list's order. */
  list(): LowerThird[] {
    const rows = this.db
      .prepare<[string], Row>(`${SELECT_WITH_MOTION} WHERE t.deleted_at IS NULL ORDER BY t.position, t.rowid`)
      .all(MOTION_KEY_PREFIX);
    return rows.map(fromRow);
  }

  get(id: string): LowerThird | null {
    const row = this.db
      .prepare<[string, string], Row>(`${SELECT_WITH_MOTION} WHERE t.id = ? AND t.deleted_at IS NULL`)
      .get(MOTION_KEY_PREFIX, id);
    return row ? fromRow(row) : null;
  }

  /** A new one at the end of the list: its id. */
  create(input: LowerThirdInput): string {
    const id = randomUUID();
    const pair = motionPairOf(input.look.motion);
    this.db.transaction(() => {
      const { next } = this.db
        .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM lower_thirds')
        .get() as { next: number };
      this.db
        .prepare(
          'INSERT INTO lower_thirds (id, position, lines, look, target, animation) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(id, next, JSON.stringify(input.lines), lookColumn(input, pair), input.where, input.animation);
      if (pair) this.setMotion(id, pair);
    })();
    return id;
  }

  /** Change one: false when it is not there (or deleted). */
  update(id: string, input: LowerThirdInput): boolean {
    const pair = motionPairOf(input.look.motion);
    return this.db.transaction(() => {
      const result = this.db
        .prepare(
          `UPDATE lower_thirds SET lines = ?, look = ?, target = ?, animation = ?, updated_at = ${NOW}
            WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(JSON.stringify(input.lines), lookColumn(input, pair), input.where, input.animation, id);
      if (result.changes === 0) return false;
      this.setMotion(id, pair);
      return true;
    })();
  }

  private setMotion(id: string, pair: MotionPair): void {
    const key = `${MOTION_KEY_PREFIX}${id}`;
    if (pair)
      this.db
        .prepare(
          'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        )
        .run(key, JSON.stringify(pair));
    else this.db.prepare('DELETE FROM app_meta WHERE key = ?').run(key);
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

  /** Those deleted before this start go for good, along with background choices an older Drashti replaced. */
  purge(): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM lower_thirds WHERE deleted_at IS NOT NULL').run();
      this.db
        .prepare(
          `DELETE FROM app_meta WHERE key GLOB ?
            AND NOT EXISTS (
              SELECT 1 FROM lower_thirds
                WHERE id = substr(app_meta.key, ?)
                  AND CASE WHEN json_valid(look) AND json_valid(app_meta.value) THEN
                    json_extract(look, '$.motion') = json_extract(app_meta.value, '$.fallback')
                  END
            )`,
        )
        .run(`${MOTION_KEY_PREFIX}*`, MOTION_KEY_PREFIX.length + 1);
    })();
  }
}
