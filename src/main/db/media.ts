import type { PictureLook } from '../../shared/picture-look';
import { isPlain, lookOf } from '../../shared/picture-look';
import type { Statement } from 'better-sqlite3';
import type { MediaMarkers } from '../../shared/markers';
import { mediaMarkersSchema } from '../../shared/markers';
import type { MediaSummary } from '../../shared/playlists';
import type { MediaFileRow } from '../media/media-protocol';
import type { Db } from './database';

/** The media library, as the main process reads it (the import worker writes it). */
export class MediaRepo {
  private readonly fileStmt: Statement<
    [string],
    { path: string; missing: number; sha256: string | null; deleted: number }
  >;

  constructor(private readonly db: Db) {
    this.fileStmt = db.prepare(
      'SELECT path, missing, sha256, deleted_at IS NOT NULL AS deleted FROM media WHERE id = ?',
    );
  }

  /**
   * Every media item, for the library's media list: by name. Deleted ones (Session 26a) are left out:
   * until Undo, everything else treats them as missing files. So are a deck's pages (migration 37):
   * only what was imported as media is listed.
   */
  list(): MediaSummary[] {
    return (
      this.db
        .prepare(
          `SELECT m.id, m.name, m.kind, m.missing, m.playable, m.format, m.dropped_at,
                  (SELECT c.name FROM media_conversions mc JOIN media c ON c.id = mc.converted_id
                    WHERE mc.original_id = m.id AND mc.undone_at IS NULL
                    ORDER BY mc.created_at DESC LIMIT 1) AS converted_to
             FROM media m WHERE m.deleted_at IS NULL AND m.listed = 1 ORDER BY m.name COLLATE NOCASE, m.rowid`,
        )
        .all() as {
        id: string;
        name: string;
        kind: MediaSummary['kind'];
        missing: number;
        playable: number | null;
        format: string | null;
        dropped_at: string | null;
        converted_to: string | null;
      }[]
    ).map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      missing: r.missing === 1,
      unplayable: r.playable === 0 ? (r.format ?? 'a kind of file Drashti cannot play') : null,
      format: r.format,
      convertedTo: r.converted_to,
      ...(r.dropped_at === null ? {} : { fromDrop: true as const }),
    }));
  }

  /** A media item's kind and where its file is (relative to the media folder), for a preview; null for an unknown id. */
  kindAndFile(mediaId: string): { kind: 'image' | 'video' | 'audio'; path: string; missing: boolean } | null {
    const row = this.db
      .prepare('SELECT kind, path, missing OR deleted_at IS NOT NULL AS missing FROM media WHERE id = ?')
      .get(mediaId) as { kind: 'image' | 'video' | 'audio'; path: string; missing: number } | undefined;
    return row ? { kind: row.kind, path: row.path, missing: row.missing === 1 } : null;
  }

  /** A media item's kind and name, when it is there to play (not missing); null otherwise. */
  kindAndName(mediaId: string): { kind: 'image' | 'video' | 'audio'; name: string } | null {
    const row = this.db
      .prepare('SELECT kind, name, missing OR deleted_at IS NOT NULL AS missing FROM media WHERE id = ?')
      .get(mediaId) as { kind: 'image' | 'video' | 'audio'; name: string; missing: number } | undefined;
    return row?.missing === 0 ? { kind: row.kind, name: row.name } : null;
  }

  /** How long a video or sound is, in ms, once Drashti has played it; null when not known. */
  lengthOf(mediaId: string): number | null {
    const row = this.db.prepare('SELECT duration_ms FROM media WHERE id = ?').get(mediaId) as
      { duration_ms: number | null } | undefined;
    return row?.duration_ms ?? null;
  }

  /** Keep a file's length, learned as it played. True when it changed. */
  setLength(mediaId: string, durationMs: number): boolean {
    return (
      this.db
        .prepare(
          "UPDATE media SET duration_ms = ? WHERE id = ? AND kind IN ('video', 'audio') AND (duration_ms IS NULL OR duration_ms <> ?)",
        )
        .run(durationMs, mediaId, durationMs).changes > 0
    );
  }

  /** A video's or sound's start and end points and markers (Session 14), or null when it has none. */
  markersOf(mediaId: string): MediaMarkers | null {
    const row = this.db.prepare('SELECT markers FROM media WHERE id = ?').get(mediaId) as
      { markers: string | null } | undefined;
    if (!row?.markers) return null;
    try {
      const parsed = mediaMarkersSchema.safeParse(JSON.parse(row.markers));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** Keep them (null: none); only on a video or a sound. True when the item is one. */
  setMarkers(mediaId: string, markers: MediaMarkers | null): boolean {
    const empty = markers?.startMs === null && markers.endMs === null && markers.markers.length === 0;
    return (
      this.db
        .prepare("UPDATE media SET markers = ? WHERE id = ? AND kind IN ('video', 'audio')")
        .run(markers && !empty ? JSON.stringify(markers) : null, mediaId).changes > 0
    );
  }

  /** Where a media item's file is, relative to the media folder; null for an unknown id. */
  /** A picture's look (Session 26e), or null: shown as it is. */
  look(mediaId: string): PictureLook | null {
    const row = this.db.prepare('SELECT look FROM media WHERE id = ?').get(mediaId) as
      { look: string | null } | undefined;
    return lookOf(row?.look ?? null);
  }

  /** Keep a picture's look (null, or one that changes nothing: shown as it is). False when it is not a picture. */
  setLook(mediaId: string, look: PictureLook | null): boolean {
    const json = look && !isPlain(look) ? JSON.stringify(look) : null;
    return (
      this.db.prepare("UPDATE media SET look = ? WHERE id = ? AND kind = 'image'").run(json, mediaId)
        .changes === 1
    );
  }

  /** Every picture's look that changes something, by media id (for the window's thumbnails). */
  looks(): Record<string, PictureLook> {
    const rows = this.db
      .prepare("SELECT id, look FROM media WHERE look IS NOT NULL AND kind = 'image' AND deleted_at IS NULL")
      .all() as { id: string; look: string }[];
    const out: Record<string, PictureLook> = {};
    for (const r of rows) {
      const look = lookOf(r.look);
      if (look) out[r.id] = look;
    }
    return out;
  }

  /**
   * Pictures whose looks sharpen them (Session 26f), for their sharpened copies: the file and the sharpness.
   * Deleted ones too, until their files go (Undo puts them back as they were).
   */
  sharpenWants(): { mediaId: string; sha256: string; path: string; sharpness: number; zoom: number }[] {
    const rows = this.db
      .prepare(
        `SELECT id, sha256, path, look FROM media
          WHERE kind = 'image' AND look IS NOT NULL AND sha256 IS NOT NULL AND missing = 0 AND path <> ''`,
      )
      .all() as { id: string; sha256: string; path: string; look: string }[];
    return rows.flatMap((r) => {
      const look = lookOf(r.look);
      return look && look.sharpness > 0
        ? [{ mediaId: r.id, sha256: r.sha256, path: r.path, sharpness: look.sharpness, zoom: look.zoom }]
        : [];
    });
  }

  file(mediaId: string): MediaFileRow | null {
    const row = this.fileStmt.get(mediaId);
    return row
      ? { path: row.path, missing: row.missing === 1, sha256: row.sha256, deleted: row.deleted === 1 }
      : null;
  }
}
