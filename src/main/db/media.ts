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
          'SELECT id, name, kind, missing, playable, format FROM media ORDER BY name COLLATE NOCASE, rowid',
        )
        .all() as {
        id: string;
        name: string;
        kind: MediaSummary['kind'];
        missing: number;
        playable: number | null;
        format: string | null;
      }[]
    ).map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      missing: r.missing === 1,
      unplayable: r.playable === 0 ? (r.format ?? 'a kind of file Drashti cannot play') : null,
    }));
  }

  /** Where a media item's file is, relative to the media folder; null for an unknown id. */
  file(mediaId: string): MediaFileRow | null {
    const row = this.fileStmt.get(mediaId);
    return row ? { path: row.path, missing: row.missing === 1, sha256: row.sha256 } : null;
  }
}
