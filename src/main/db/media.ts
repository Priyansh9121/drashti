import type { Statement } from 'better-sqlite3';
import type { MediaFileRow } from '../media/media-protocol';
import type { Db } from './database';

/** The media library, as the main process reads it (the import worker writes it). */
export class MediaRepo {
  private readonly fileStmt: Statement<[string], { path: string; missing: number }>;

  constructor(db: Db) {
    this.fileStmt = db.prepare('SELECT path, missing FROM media WHERE id = ?');
  }

  /** Where a media item's file is, relative to the media folder; null for an unknown id. */
  file(mediaId: string): MediaFileRow | null {
    const row = this.fileStmt.get(mediaId);
    return row ? { path: row.path, missing: row.missing === 1 } : null;
  }
}
