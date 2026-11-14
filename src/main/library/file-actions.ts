import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { PresentationUsage, UsedIn } from '../../shared/media-removal';
import { NAME_MAX, USED_IN_NAMES } from '../../shared/media-removal';
import { cleanRenameName } from '../../shared/rename-name';
import type { Db } from '../db/database';
import { isInside } from '../media/contained';

/*
 * The one right-click menu's Delete, Rename and Show in Finder (Session 55, Part 14), as the main process answers
 * them for presentations and media. Delete asks first only when what it deletes is on the screens or in a playlist,
 * and says which: a presentation's playlists here (media's usage is MediaRemoval's). Rename changes the library's
 * name (a media file's playlist rows that had its name follow, one given a label of its own keeps it). Show in Finder
 * (Show in Explorer on Windows) shows the file it was imported from while it is still there, else Drashti's own copy,
 * never a path that leads out of Drashti's media folder.
 */

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

const usedIn = (rows: readonly { name: string }[]): UsedIn => ({
  names: rows.slice(0, USED_IN_NAMES).map((r) => r.name),
  count: rows.length,
});

/** A name as Rename takes it, 1 to NAME_MAX characters after cleaning. */
export function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const cleaned = cleanRenameName(name);
  return cleaned === '' || cleaned.length > NAME_MAX ? null : cleaned;
}

export class FileActions {
  constructor(
    private readonly db: Db,
    private readonly deps: {
      /** Drashti's media folder: its own copies. */
      mediaDir: string;
      /** The presentation on the screens now, or null. */
      livePresentation: () => string | null;
    },
  ) {}

  /** The playlists that hold these presentations (not deleted), and whether one is on the screens. */
  presentationUsage(ids: readonly string[]): PresentationUsage {
    if (ids.length === 0) return { playlists: { names: [], count: 0 }, live: false };
    const rows = this.db
      .prepare(
        `SELECT name FROM playlists WHERE deleted_at IS NULL AND is_template = 0 AND id IN (
           SELECT playlist_id FROM playlist_items WHERE deleted_at IS NULL AND presentation_id IN (${placeholders(ids.length)}))
         ORDER BY name COLLATE NOCASE`,
      )
      .all(...ids) as { name: string }[];
    const live = this.deps.livePresentation();
    return { playlists: usedIn(rows), live: live !== null && ids.includes(live) };
  }

  /** Rename a presentation (not deleted). False when the name is none or it is not there. */
  renamePresentation(id: string, name: string): boolean {
    const clean = cleanName(name);
    if (clean === null) return false;
    return (
      this.db
        .prepare(
          "UPDATE presentations SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND deleted_at IS NULL",
        )
        .run(clean, id).changes === 1
    );
  }

  /**
   * Rename a media file (not deleted), and the playlist rows that had its name: one given a label of its own keeps it.
   * False when the name is none or it is not there.
   */
  renameMedia(id: string, name: string): boolean {
    const clean = cleanName(name);
    if (clean === null) return false;
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT name FROM media WHERE id = ? AND deleted_at IS NULL').get(id) as
        { name: string } | undefined;
      if (!row) return false;
      this.db.prepare('UPDATE media SET name = ? WHERE id = ?').run(clean, id);
      this.db
        .prepare(
          'UPDATE playlist_items SET label = ? WHERE media_id = ? AND label = ? AND deleted_at IS NULL',
        )
        .run(clean, id, row.name);
      return true;
    })();
  }

  /**
   * The file Show in Finder shows for a media file: the one it was imported from while it is there, else Drashti's own
   * copy in its media folder (or the owner's file a row points at by its full path). Null when there is none, or its
   * path would lead out of the media folder.
   */
  mediaFile(id: string): string | null {
    const row = this.db.prepare('SELECT path, source_path FROM media WHERE id = ?').get(id) as
      { path: string; source_path: string | null } | undefined;
    if (!row) return null;
    if (row.source_path !== null && isAbsolute(row.source_path) && existsSync(row.source_path))
      return row.source_path;
    if (row.path === '') return null;
    if (isAbsolute(row.path)) return existsSync(row.path) ? row.path : null;
    const dir = resolve(this.deps.mediaDir);
    const own = resolve(dir, row.path);
    return isInside(dir, own) && existsSync(own) ? own : null;
  }

  /** The file a presentation was imported from, while it is there; null for one made in Drashti. */
  presentationFile(id: string): string | null {
    const row = this.db.prepare('SELECT source_path FROM presentations WHERE id = ?').get(id) as
      { source_path: string | null } | undefined;
    const path = row?.source_path ?? null;
    return path !== null && isAbsolute(path) && existsSync(path) ? path : null;
  }
}
