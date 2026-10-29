import { randomUUID } from 'node:crypto';
import type { Wallpaper, WallpaperPicture } from '../../shared/wallpapers';
import {
  WALLPAPER_FADE_DEFAULT_MS,
  WALLPAPER_FADE_MAX_MS,
  WALLPAPER_SECONDS_DEFAULT,
  WALLPAPER_SECONDS_MAX,
  WALLPAPER_SECONDS_MIN,
} from '../../shared/wallpapers';
import type { Db } from './database';

/*
 * Wallpapers in the library (migration 50, Session 55, Part 6): each its name, its pictures in their order and how
 * they go round, in the list's order. Deleting only marks one (`remove`), so Undo can bring it back (`restore`);
 * marked ones are gone for good when Drashti next starts (`purge`). A picture deleted from the library, or whose file
 * is missing, stays in its wallpaper, said missing, and is left out on the screens.
 */

interface Row {
  id: string;
  name: string;
  seconds_each: number;
  fade_ms: number;
}

interface PictureRow {
  wallpaper_id: string;
  media_id: string;
  name: string | null;
  missing: number;
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

export class WallpaperRepo {
  constructor(private readonly db: Db) {}

  /** Every one not deleted, in the list's order, with its pictures. */
  list(): Wallpaper[] {
    const rows = this.db
      .prepare(
        'SELECT id, name, seconds_each, fade_ms FROM wallpapers WHERE deleted_at IS NULL ORDER BY position, rowid',
      )
      .all() as Row[];
    const pictures = this.picturesOf(rows.map((r) => r.id));
    return rows.map((r) => this.fromRow(r, pictures.get(r.id) ?? []));
  }

  get(id: string): Wallpaper | null {
    const row = this.db
      .prepare('SELECT id, name, seconds_each, fade_ms FROM wallpapers WHERE id = ? AND deleted_at IS NULL')
      .get(id) as Row | undefined;
    return row ? this.fromRow(row, this.picturesOf([id]).get(id) ?? []) : null;
  }

  /** A new one at the end of the list, of these pictures in order: its id. */
  create(
    name: string,
    mediaIds: readonly string[],
    timing?: { secondsEach: number; fadeMs: number },
  ): string {
    const id = randomUUID();
    this.db.transaction(() => {
      const { next } = this.db
        .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM wallpapers')
        .get() as { next: number };
      this.db
        .prepare('INSERT INTO wallpapers (id, name, position, seconds_each, fade_ms) VALUES (?, ?, ?, ?, ?)')
        .run(
          id,
          name,
          next,
          clamp(
            timing?.secondsEach ?? WALLPAPER_SECONDS_DEFAULT,
            WALLPAPER_SECONDS_MIN,
            WALLPAPER_SECONDS_MAX,
          ),
          clamp(timing?.fadeMs ?? WALLPAPER_FADE_DEFAULT_MS, 0, WALLPAPER_FADE_MAX_MS),
        );
      this.writePictures(id, mediaIds);
    })();
    return id;
  }

  rename(id: string, name: string): boolean {
    return (
      this.db.prepare('UPDATE wallpapers SET name = ? WHERE id = ? AND deleted_at IS NULL').run(name, id)
        .changes > 0
    );
  }

  /** Its pictures, in this order (the same picture may come more than once). */
  setPictures(id: string, mediaIds: readonly string[]): boolean {
    if (!this.get(id)) return false;
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM wallpaper_pictures WHERE wallpaper_id = ?').run(id);
      this.writePictures(id, mediaIds);
    })();
    return true;
  }

  setTiming(id: string, timing: { secondsEach: number; fadeMs: number }): boolean {
    return (
      this.db
        .prepare('UPDATE wallpapers SET seconds_each = ?, fade_ms = ? WHERE id = ? AND deleted_at IS NULL')
        .run(
          clamp(timing.secondsEach, WALLPAPER_SECONDS_MIN, WALLPAPER_SECONDS_MAX),
          clamp(timing.fadeMs, 0, WALLPAPER_FADE_MAX_MS),
          id,
        ).changes > 0
    );
  }

  /** Mark it deleted (Undo can bring it back until Drashti next starts). */
  remove(id: string): boolean {
    return (
      this.db.prepare(`UPDATE wallpapers SET deleted_at = ${NOW} WHERE id = ? AND deleted_at IS NULL`).run(id)
        .changes > 0
    );
  }

  /** Bring a deleted one back, in its place. */
  restore(id: string): boolean {
    return (
      this.db
        .prepare('UPDATE wallpapers SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL')
        .run(id).changes > 0
    );
  }

  /** Those deleted before this start are gone for good. */
  purge(): void {
    this.db.prepare('DELETE FROM wallpapers WHERE deleted_at IS NOT NULL').run();
  }

  /** Every wallpaper's pictures still in the library, each once: the files a node copies. */
  pictureIds(): string[] {
    return (
      this.db
        .prepare(
          `SELECT DISTINCT p.media_id AS id FROM wallpaper_pictures p
             JOIN wallpapers w ON w.id = p.wallpaper_id AND w.deleted_at IS NULL
             JOIN media m ON m.id = p.media_id AND m.deleted_at IS NULL AND m.missing = 0
            ORDER BY w.position, p.position`,
        )
        .all() as { id: string }[]
    ).map((r) => r.id);
  }

  /** The wallpapers a picture is in, by name (for what deleting it from the library would change). */
  usedBy(mediaId: string): string[] {
    return (
      this.db
        .prepare(
          `SELECT DISTINCT w.name FROM wallpaper_pictures p
             JOIN wallpapers w ON w.id = p.wallpaper_id AND w.deleted_at IS NULL
            WHERE p.media_id = ? ORDER BY w.position`,
        )
        .all(mediaId) as { name: string }[]
    ).map((r) => r.name);
  }

  private writePictures(id: string, mediaIds: readonly string[]): void {
    const insert = this.db.prepare(
      'INSERT INTO wallpaper_pictures (wallpaper_id, position, media_id) VALUES (?, ?, ?)',
    );
    mediaIds.forEach((mediaId, i) => insert.run(id, i, mediaId));
  }

  private picturesOf(ids: readonly string[]): Map<string, WallpaperPicture[]> {
    const out = new Map<string, WallpaperPicture[]>();
    if (ids.length === 0) return out;
    const rows = this.db
      .prepare(
        `SELECT p.wallpaper_id, p.media_id, m.name,
                (m.id IS NULL OR m.deleted_at IS NOT NULL OR m.missing = 1) AS missing
           FROM wallpaper_pictures p LEFT JOIN media m ON m.id = p.media_id
          WHERE p.wallpaper_id IN (${ids.map(() => '?').join(', ')})
          ORDER BY p.wallpaper_id, p.position`,
      )
      .all(...ids) as PictureRow[];
    for (const r of rows) {
      const list = out.get(r.wallpaper_id) ?? [];
      list.push({ mediaId: r.media_id, name: r.name ?? '', missing: r.missing === 1 });
      out.set(r.wallpaper_id, list);
    }
    return out;
  }

  private fromRow(r: Row, pictures: WallpaperPicture[]): Wallpaper {
    return { id: r.id, name: r.name, pictures, secondsEach: r.seconds_each, fadeMs: r.fade_ms };
  }
}
