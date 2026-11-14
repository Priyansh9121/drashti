import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { PresentationUsage, UsedIn } from '../../shared/media-removal';
import { MEDIA_ID_PATTERN } from '../../shared/media';
import { NAME_MAX, USED_IN_NAMES } from '../../shared/media-removal';
import { cleanRenameName, type RenameAnswer } from '../../shared/rename-name';
import type { Db } from '../db/database';
import { isInside } from '../media/contained';

/*
 * The one right-click menu's Delete, Rename and Show in Finder (Session 55, Part 14), as the main process answers
 * them for presentations and media. Delete asks first only when what it deletes is on the screens or in a playlist,
 * and says which: a presentation's playlists here (media's usage is MediaRemoval's). Rename changes the library's
 * name (a media file's playlist rows that had its name follow, one given a label of its own keeps it), and says why
 * not in words: the name, or what is no longer in the library (Session 58, X3: not the name rule then). Show in Finder
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

const KEPT: RenameAnswer = { ok: true };
/** The name rule, as a phone's own check says it too. */
const NAME_RULE: RenameAnswer = { ok: false, message: 'A name needs 1 to 200 characters.' };
const gone = (what: string): RenameAnswer => ({
  ok: false,
  message: `That ${what} is no longer in the library.`,
});
/** A media file's kind, as Rename…'s words say it. */
const MEDIA_WORDS: Readonly<Record<string, string | undefined>> = {
  image: 'picture',
  video: 'video',
  audio: 'sound',
};

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

  /** Rename a presentation (not deleted); refused, in words, when the name is none or it is no longer there. */
  renamePresentation(id: string, name: string): RenameAnswer {
    const clean = cleanName(name);
    if (clean === null) return NAME_RULE;
    const changed = this.db
      .prepare(
        "UPDATE presentations SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND deleted_at IS NULL",
      )
      .run(clean, id).changes;
    return changed === 1 ? KEPT : gone('presentation');
  }

  /**
   * Rename a media file (not deleted), and the playlist rows that had its name: one given a label of its own keeps it.
   * Refused, in words, when the name is none or the file is no longer there (said by its kind).
   */
  renameMedia(id: string, name: string): RenameAnswer {
    const clean = cleanName(name);
    if (clean === null) return NAME_RULE;
    if (!MEDIA_ID_PATTERN.test(id)) return gone('file');
    return this.db.transaction((): RenameAnswer => {
      const row = this.db.prepare('SELECT name FROM media WHERE id = ? AND deleted_at IS NULL').get(id) as
        { name: string } | undefined;
      if (!row) return gone(this.mediaWord(id));
      this.db.prepare('UPDATE media SET name = ? WHERE id = ?').run(clean, id);
      this.db
        .prepare(
          'UPDATE playlist_items SET label = ? WHERE media_id = ? AND label = ? AND deleted_at IS NULL',
        )
        .run(clean, id, row.name);
      return KEPT;
    })();
  }

  /** A media file's kind in words, deleted or not: "file" when Drashti has no row for it. */
  private mediaWord(id: string): string {
    const row = this.db.prepare('SELECT kind FROM media WHERE id = ?').get(id) as
      { kind: string } | undefined;
    return MEDIA_WORDS[row?.kind ?? ''] ?? 'file';
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
