import { isPlainPlayback, type PlaybackSettings, readPlaybackSettings } from '../../shared/playback-settings';
import type { PictureLook } from '../../shared/picture-look';
import { isPlain, lookOf } from '../../shared/picture-look';
import type { Statement } from 'better-sqlite3';
import type { MediaMarkers } from '../../shared/markers';
import { mediaMarkersSchema } from '../../shared/markers';
import type { ResumePoint } from '../../shared/play-history';
import type { MediaSummary } from '../../shared/playlists';
import type { DetailsRow } from '../media/media-details';
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
   * only what was imported as media is listed. An original is converted while its copy is in the library
   * (Session 51: with the copy deleted, Convert is offered again).
   */
  list(): MediaSummary[] {
    return (
      this.db
        .prepare(
          `SELECT m.id, m.name, m.kind, m.missing, m.playable, m.format, m.dropped_at, m.from_device, m.play_count,
                  m.last_played_at,
                  (SELECT c.name FROM media_conversions mc JOIN media c ON c.id = mc.converted_id
                    WHERE mc.original_id = m.id AND mc.undone_at IS NULL AND c.deleted_at IS NULL
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
        from_device: string | null;
        play_count: number;
        last_played_at: string | null;
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
      // Added from a phone (Session 54): the device's name.
      ...(r.from_device === null ? {} : { fromDevice: r.from_device }),
      // Its plays (alpha.20, migration 87): how many, and when it last went up.
      ...(r.play_count > 0 ? { playCount: r.play_count } : {}),
      ...(r.last_played_at === null ? {} : { lastPlayedAt: r.last_played_at }),
    }));
  }

  /** A media item's kind and where its file is (relative to the media folder), for a preview; null for an unknown id. */
  kindAndFile(mediaId: string): { kind: 'image' | 'video' | 'audio'; path: string; missing: boolean } | null {
    const row = this.db
      .prepare('SELECT kind, path, missing OR deleted_at IS NOT NULL AS missing FROM media WHERE id = ?')
      .get(mediaId) as { kind: 'image' | 'video' | 'audio'; path: string; missing: number } | undefined;
    return row ? { kind: row.kind, path: row.path, missing: row.missing === 1 } : null;
  }

  /**
   * Whether a picture is a photo (Session 55, Part 5, D): a picture brought in any way, which has its blurred copy
   * behind it by itself, and not a page Drashti drew from a deck (its source 'drashti'), which has none unless asked.
   */
  photoByDefault(mediaId: string): boolean {
    const row = this.db
      .prepare("SELECT source_kind FROM media WHERE id = ? AND kind = 'image'")
      .get(mediaId) as { source_kind: string | null } | undefined;
    return row !== undefined && row.source_kind !== 'drashti';
  }

  /** A media item's kind and name, when it is there to play (not missing); null otherwise. */
  kindAndName(mediaId: string): { kind: 'image' | 'video' | 'audio'; name: string } | null {
    const row = this.db
      .prepare('SELECT kind, name, missing OR deleted_at IS NOT NULL AS missing FROM media WHERE id = ?')
      .get(mediaId) as { kind: 'image' | 'video' | 'audio'; name: string; missing: number } | undefined;
    return row?.missing === 0 ? { kind: row.kind, name: row.name } : null;
  }

  /**
   * A media item as a slide's background cue reads it (Session 52, as db/presentations.ts reads a slide's own): its
   * name, whether it is missing (not found at import, or deleted from the library) and what it is when Drashti cannot
   * play it; null for no such item. A Shastra passage's theme background is made from it.
   */
  asCue(mediaId: string): { name: string; missing: boolean; unplayable: string | null } | null {
    const row = this.db
      .prepare(
        'SELECT name, missing OR deleted_at IS NOT NULL AS missing, playable, format FROM media WHERE id = ?',
      )
      .get(mediaId) as
      { name: string; missing: number; playable: number | null; format: string | null } | undefined;
    if (!row) return null;
    return {
      name: row.name,
      missing: row.missing === 1,
      unplayable: row.playable === 0 ? (row.format ?? 'a kind of file Drashti cannot play') : null,
    };
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

  /** Files eligible for idle display preparation, without changing their rows or original hashes. */
  displayCandidates(): { mediaId: string; sha256: string; path: string; look: PictureLook | null }[] {
    const rows = this.db
      .prepare(
        `SELECT id, sha256, path, look FROM media WHERE kind = 'image' AND sha256 IS NOT NULL AND missing = 0 AND path <> '' AND (playable IS NULL OR playable = 1)`,
      )
      .all() as { id: string; sha256: string; path: string; look: string | null }[];
    return rows.map((row) => ({
      mediaId: row.id,
      sha256: row.sha256,
      path: row.path,
      look: lookOf(row.look),
    }));
  }

  /**
   * Pictures whose looks sharpen them (Session 26f), for their sharpened copies: the file and the sharpness.
   * Deleted ones too, until their files go (Undo puts them back as they were).
   */
  sharpenWants(): {
    mediaId: string;
    sha256: string;
    path: string;
    sharpness: number;
    zoom: number;
    look: PictureLook;
  }[] {
    const rows = this.db
      .prepare(
        `SELECT id, sha256, path, look FROM media
          WHERE kind = 'image' AND look IS NOT NULL AND sha256 IS NOT NULL AND missing = 0 AND path <> ''`,
      )
      .all() as { id: string; sha256: string; path: string; look: string }[];
    return rows.flatMap((r) => {
      const look = lookOf(r.look);
      return look && look.sharpness > 0
        ? [
            {
              mediaId: r.id,
              sha256: r.sha256,
              path: r.path,
              sharpness: look.sharpness,
              zoom: look.zoom,
              // Turned or cropped, its copy is made bigger (Session 55, P5).
              look,
            },
          ]
        : [];
    });
  }

  file(mediaId: string): MediaFileRow | null {
    const row = this.fileStmt.get(mediaId);
    return row
      ? { path: row.path, missing: row.missing === 1, sha256: row.sha256, deleted: row.deleted === 1 }
      : null;
  }

  /**
   * What Media information… (alpha.20, Q60-34) says of a media item from the library: its file, its size and length,
   * when and from where it came in, whether it plays as it is, and the copy everything uses when it was converted (or
   * the original, when it is Drashti's copy). Null for no such item.
   */
  /**
   * The bytes still in the library (page copies, QA23-FADE-9 candidate 1): every row's that has its file, deleted rows
   * that can be undone and missing ones too; never a purged row's, whose path is emptied before its files go
   * (a22-review-fadecopies S6).
   */
  liveSha256s(): Set<string> {
    const rows = this.db
      .prepare("SELECT DISTINCT sha256 FROM media WHERE sha256 IS NOT NULL AND path <> ''")
      .all() as { sha256: string }[];
    return new Set(rows.map((r) => r.sha256));
  }

  about(mediaId: string): DetailsRow | null {
    const row = this.db
      .prepare(
        `SELECT m.name, m.kind, m.path, m.sha256, m.bytes, m.missing, m.deleted_at IS NOT NULL AS deleted, m.playable,
                m.format, m.duration_ms, COALESCE(m.source_imported_at, m.created_at) AS imported_at, m.source_path,
                m.play_count, m.last_played_at,
                (SELECT c.name FROM media_conversions mc JOIN media c ON c.id = mc.converted_id
                  WHERE mc.original_id = m.id AND mc.undone_at IS NULL AND c.deleted_at IS NULL
                  ORDER BY mc.created_at DESC LIMIT 1) AS converted_to,
                (SELECT o.name FROM media o WHERE o.id = m.converted_from) AS copy_of
           FROM media m WHERE m.id = ?`,
      )
      .get(mediaId) as
      | {
          name: string;
          kind: DetailsRow['kind'];
          path: string;
          sha256: string | null;
          bytes: number | null;
          missing: number;
          deleted: number;
          playable: number | null;
          format: string | null;
          duration_ms: number | null;
          imported_at: string | null;
          source_path: string | null;
          play_count: number;
          last_played_at: string | null;
          converted_to: string | null;
          copy_of: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      name: row.name,
      kind: row.kind,
      path: row.path,
      sha256: row.sha256,
      bytes: row.bytes,
      missing: row.missing === 1,
      deleted: row.deleted === 1,
      playable: row.playable === null ? null : row.playable === 1,
      format: row.format,
      durationMs: row.duration_ms,
      importedAt: row.imported_at,
      importedFrom: row.source_path,
      convertedTo: row.converted_to,
      copyOf: row.copy_of,
      playCount: row.play_count,
      lastPlayedAt: row.last_played_at,
    };
  }

  /** A file gone up once more (alpha.20, migration 87): counted, with when. */
  countPlay(mediaId: string, at: string): void {
    this.db
      .prepare('UPDATE media SET play_count = play_count + 1, last_played_at = ? WHERE id = ?')
      .run(at, mediaId);
  }

  /** Where a long file was taken off before its end, and when (alpha.20). */
  keepResume(mediaId: string, atMs: number, at: string): void {
    this.db
      .prepare('UPDATE media SET resume_ms = ?, resume_at = ? WHERE id = ?')
      .run(Math.max(0, Math.round(atMs)), at, mediaId);
  }

  /** Played to its end (alpha.20): nothing to resume. */
  forgetResume(mediaId: string): void {
    this.db
      .prepare('UPDATE media SET resume_ms = NULL, resume_at = NULL WHERE id = ? AND resume_ms IS NOT NULL')
      .run(mediaId);
  }

  /** Where a file was taken off before its end, when it was; null when nothing is kept. */
  resumeOf(mediaId: string): ResumePoint | null {
    const row = this.db.prepare('SELECT resume_ms, resume_at FROM media WHERE id = ?').get(mediaId) as
      { resume_ms: number | null; resume_at: string | null } | undefined;
    return row?.resume_ms != null && row.resume_at !== null
      ? { atMs: row.resume_ms, at: row.resume_at }
      : null;
  }

  /** Sound and picture… (alpha.20): a video's or a sound's own playback settings; none for an unknown id. */
  playbackOf(mediaId: string): PlaybackSettings {
    const row = this.db.prepare('SELECT playback FROM media WHERE id = ?').get(mediaId) as
      { playback: string | null } | undefined;
    return readPlaybackSettings(row?.playback ?? null);
  }

  /** Keep a video's or a sound's playback settings (none: plays as it is). False when it is not a video or a sound. */
  setPlayback(mediaId: string, settings: PlaybackSettings): boolean {
    const json = isPlainPlayback(settings) ? null : JSON.stringify(settings);
    return (
      this.db
        .prepare("UPDATE media SET playback = ? WHERE id = ? AND kind IN ('video', 'audio')")
        .run(json, mediaId).changes === 1
    );
  }
}
