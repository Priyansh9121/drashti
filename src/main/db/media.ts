import type { Statement } from 'better-sqlite3';
import type { MediaSummary } from '../../shared/playlists';
import type { MediaFileRow } from '../media/media-protocol';
import type { Db } from './database';

/** The media library, as the main process reads it (the import worker writes it). */
export class MediaRepo {
  private readonly fileStmt: Statement<[string], { path: string; missing: number; sha256: string | null }>;

  constructor(private readonly db: Db) {
    this.fileStmt = db.prepare('SELECT path, missing, sha256 FROM media WHERE id = ?');
  }

  /** Every media item, for the library's media list: by name. */
  list(): MediaSummary[] {
    return (
      this.db
        .prepare(
          `SELECT m.id, m.name, m.kind, m.missing, m.playable, m.format,
                  (SELECT c.name FROM media_conversions mc JOIN media c ON c.id = mc.converted_id
                    WHERE mc.original_id = m.id AND mc.undone_at IS NULL
                    ORDER BY mc.created_at DESC LIMIT 1) AS converted_to
             FROM media m ORDER BY m.name COLLATE NOCASE, m.rowid`,
        )
        .all() as {
        id: string;
        name: string;
        kind: MediaSummary['kind'];
        missing: number;
        playable: number | null;
        format: string | null;
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
    }));
  }

  /** A media item's kind and where its file is (relative to the media folder), for a preview; null for an unknown id. */
  kindAndFile(mediaId: string): { kind: 'image' | 'video' | 'audio'; path: string; missing: boolean } | null {
    const row = this.db.prepare('SELECT kind, path, missing FROM media WHERE id = ?').get(mediaId) as
      { kind: 'image' | 'video' | 'audio'; path: string; missing: number } | undefined;
    return row ? { kind: row.kind, path: row.path, missing: row.missing === 1 } : null;
  }

  /** Where a media item's file is, relative to the media folder; null for an unknown id. */
  file(mediaId: string): MediaFileRow | null {
    const row = this.fileStmt.get(mediaId);
    return row ? { path: row.path, missing: row.missing === 1, sha256: row.sha256 } : null;
  }
}
