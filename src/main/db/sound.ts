import { z } from 'zod';
import { evenGainDb, gainOfDb, hasSound, type Loudness, roundedGain } from '../../shared/sound';
import type { Db } from './database';

/*
 * What the sound pass measured of each video and sound (Session 55, Part 7; migration 51), and each file's own Even
 * loudness switch. The main process reads and writes it (main/sound/sound-pass.ts); the import worker never does.
 */

const measuredSchema = z.union([
  z.object({ sha: z.string(), lufs: z.number().nullable(), peak: z.number().nullable() }),
  z.object({ sha: z.string(), failed: z.literal(true) }),
]);

type Measured = z.infer<typeof measuredSchema>;

function measuredOf(json: string | null): Measured | null {
  if (!json) return null;
  try {
    const parsed = measuredSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A video or sound the sound pass reads: where its bytes are (in the media folder), and what is known of it. */
export interface SoundFile {
  id: string;
  kind: 'video' | 'audio';
  /** Relative to the media folder. */
  path: string;
  sha256: string;
  durationMs: number | null;
}

/** How a file sounds, as the library knows it now. */
export interface FileSound {
  /** Measured for its bytes as they are now; null while not (or it could not be read). */
  loudness: Loudness | null;
  /** Its own switch: at the even level (true, the default), or as it is. */
  even: boolean;
  /** The gain it plays with: its even gain while its switch is on and it is measured, else 1. */
  gain: number;
  /** Measured, and no sound in it to speak of. */
  silent: boolean;
}

export class SoundRepo {
  constructor(private readonly db: Db) {}

  /**
   * The videos and sounds whose bytes are not measured yet (never, or other bytes since), there to read (not missing,
   * not deleted), in the order they came into the library; or, given ids, only those of them.
   */
  toMeasure(ids?: readonly string[]): SoundFile[] {
    const rows = this.db
      .prepare(
        `SELECT id, kind, path, sha256, duration_ms FROM media
          WHERE kind IN ('video', 'audio') AND missing = 0 AND deleted_at IS NULL AND path <> '' AND sha256 IS NOT NULL
            AND (loudness IS NULL OR json_extract(loudness, '$.sha') IS NOT sha256)
          ORDER BY rowid`,
      )
      .all() as {
      id: string;
      kind: 'video' | 'audio';
      path: string;
      sha256: string;
      duration_ms: number | null;
    }[];
    const wanted = ids ? new Set(ids) : null;
    return rows
      .filter((r) => !wanted || wanted.has(r.id))
      .map((r) => ({ id: r.id, kind: r.kind, path: r.path, sha256: r.sha256, durationMs: r.duration_ms }));
  }

  /** One video or sound to read now (a menu's Trim black and silence), or null when it is not one there to read. */
  file(id: string): SoundFile | null {
    const r = this.db
      .prepare(
        `SELECT id, kind, path, sha256, duration_ms FROM media
          WHERE id = ? AND kind IN ('video', 'audio') AND missing = 0 AND deleted_at IS NULL AND path <> ''`,
      )
      .get(id) as
      | {
          id: string;
          kind: 'video' | 'audio';
          path: string;
          sha256: string | null;
          duration_ms: number | null;
        }
      | undefined;
    return r
      ? { id: r.id, kind: r.kind, path: r.path, sha256: r.sha256 ?? '', durationMs: r.duration_ms }
      : null;
  }

  /** Keep what the meter read in these bytes (or that they could not be read). True when the row is still those bytes. */
  saveMeasured(id: string, sha256: string, measured: Loudness | 'failed'): boolean {
    const value: Measured =
      measured === 'failed' ? { sha: sha256, failed: true } : { sha: sha256, ...round(measured) };
    return (
      this.db
        .prepare('UPDATE media SET loudness = ? WHERE id = ? AND sha256 = ?')
        .run(JSON.stringify(value), id, sha256).changes > 0
    );
  }

  /** A file's length read with it (Session 55, P3), kept while none is known. True when it was kept. */
  keepLength(id: string, durationMs: number): boolean {
    return (
      this.db
        .prepare(
          "UPDATE media SET duration_ms = ? WHERE id = ? AND kind IN ('video', 'audio') AND duration_ms IS NULL",
        )
        .run(durationMs, id).changes > 0
    );
  }

  /** How a file sounds now; null for no such video or sound. */
  soundOf(id: string): FileSound | null {
    const r = this.db
      .prepare(
        "SELECT sha256, loudness, even_loudness FROM media WHERE id = ? AND kind IN ('video', 'audio')",
      )
      .get(id) as { sha256: string | null; loudness: string | null; even_loudness: number } | undefined;
    if (!r) return null;
    const m = measuredOf(r.loudness);
    const loudness = m && !('failed' in m) && m.sha === r.sha256 ? { lufs: m.lufs, peak: m.peak } : null;
    const even = r.even_loudness === 1;
    return {
      loudness,
      even,
      gain: loudness && even ? roundedGain(gainOfDb(evenGainDb(loudness))) : 1,
      silent: loudness !== null && !hasSound(loudness),
    };
  }

  /** A file's own Even loudness switch. True when it is a video or a sound. */
  setEven(id: string, on: boolean): boolean {
    return (
      this.db
        .prepare("UPDATE media SET even_loudness = ? WHERE id = ? AND kind IN ('video', 'audio')")
        .run(on ? 1 : 0, id).changes > 0
    );
  }

  /** The files played as they are (their switch off), for the menus' ticks. */
  evenOff(): string[] {
    return (
      this.db.prepare('SELECT id FROM media WHERE even_loudness = 0 AND deleted_at IS NULL').all() as {
        id: string;
      }[]
    ).map((r) => r.id);
  }
}

/** A tenth of a decibel is all the meter says that matters. */
function round(m: Loudness): Loudness {
  const tenth = (v: number | null) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
  return { lufs: tenth(m.lufs), peak: tenth(m.peak) };
}
