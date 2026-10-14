import { rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { MediaUsage, UsedIn } from '../../shared/media-removal';
import { USED_IN_NAMES } from '../../shared/media-removal';
import { stillPath } from '../media/media-protocol';
import { removeCopiesOf } from '../media/sharpened';
import type { Db } from '../db/database';

/*
 * Deleting media from the library (Session 26a; migration 36). Media could
 * not be removed at all before.
 *
 * - Before: where it is used (shared/media-removal.ts), for the question.
 * - Deleting marks the media row, and the playlist items and music tracks
 *   that hold it, with one moment, so Undo puts back exactly those. Slides,
 *   props, themes, macros and the idle rotation keep pointing at it: while it
 *   is deleted they treat it as a missing file (nothing in its place), except
 *   that what is on the screens now stays up until it is changed.
 * - Once it can no longer be undone (Drashti starting again), its file,
 *   still frame and sharpened copies go, and the row stays as a missing file, so what pointed at
 *   it still loads and saves as with any missing file. Importing the same
 *   file again brings it back to life everywhere (media-store.ts).
 */

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

const usedIn = (rows: readonly { name: string }[]): UsedIn => ({
  names: rows.slice(0, USED_IN_NAMES).map((r) => r.name),
  count: rows.length,
});

export class MediaRemoval {
  constructor(
    private readonly db: Db,
    private readonly deps: {
      /** The idle rotation's pictures. */
      idlePictures: () => readonly string[];
      /** Media on the screens now (and playing on the audio layer). */
      onScreens: () => ReadonlySet<string>;
    },
  ) {}

  /** Where these media items are used. */
  usage(ids: readonly string[]): MediaUsage {
    const list = placeholders(ids.length);
    const all = (sql: string) => this.db.prepare(sql).all(...ids) as { name: string }[];
    // The same ids three times over (elements, cues, kirtans).
    const presentationRows = this.db
      .prepare(
        `SELECT name FROM presentations WHERE deleted_at IS NULL AND id IN (
           SELECT g.presentation_id FROM elements e JOIN slides s ON s.id = e.slide_id
             JOIN slide_groups g ON g.id = s.group_id
            WHERE e.kind IN ('image', 'video') AND json_extract(e.props, '$.mediaId') IN (${list})
           UNION
           SELECT g.presentation_id FROM slide_cues c JOIN slides s ON s.id = c.slide_id
             JOIN slide_groups g ON g.id = s.group_id WHERE c.media_id IN (${list})
           UNION
           SELECT presentation_id FROM kirtans WHERE audio_media_id IN (${list}))
         ORDER BY name COLLATE NOCASE`,
      )
      .all(...ids, ...ids, ...ids) as { name: string }[];
    const playlists = all(
      `SELECT name FROM playlists WHERE deleted_at IS NULL AND id IN (
         SELECT playlist_id FROM playlist_items WHERE deleted_at IS NULL AND media_id IN (${list}))
       ORDER BY name COLLATE NOCASE`,
    );
    const music = all(
      `SELECT name FROM audio_playlists WHERE deleted_at IS NULL AND id IN (
         SELECT playlist_id FROM audio_playlist_tracks WHERE deleted_at IS NULL AND media_id IN (${list}))
       ORDER BY name COLLATE NOCASE`,
    );
    const props = all(
      `SELECT DISTINCT p.name FROM props p, json_each(p.definition, '$.elements') e
        WHERE json_extract(e.value, '$.mediaId') IN (${list}) ORDER BY p.name COLLATE NOCASE`,
    );
    const themes = all(
      `SELECT name FROM themes WHERE json_extract(definition, '$.background.mediaId') IN (${list})
        ORDER BY name COLLATE NOCASE`,
    );
    const macros = all(
      `SELECT DISTINCT m.name FROM macros m, json_each(m.actions) a
        WHERE json_extract(a.value, '$.mediaId') IN (${list}) ORDER BY m.name COLLATE NOCASE`,
    );
    const idle = this.deps.idlePictures();
    const live = this.deps.onScreens();
    return {
      presentations: usedIn(presentationRows),
      playlists: usedIn(playlists),
      music: usedIn(music),
      props: usedIn(props),
      themes: usedIn(themes),
      macros: usedIn(macros),
      idle: ids.some((id) => idle.includes(id)),
      live: ids.some((id) => live.has(id)),
    };
  }

  /** Delete media (those not deleted already), taking them out of playlists and music. The ids deleted. */
  remove(ids: readonly string[]): string[] {
    return this.db.transaction(() => {
      const stamp = new Date().toISOString();
      const mark = this.db.prepare('UPDATE media SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL');
      const items = this.db.prepare(
        'UPDATE playlist_items SET deleted_at = ? WHERE media_id = ? AND deleted_at IS NULL',
      );
      const tracks = this.db.prepare(
        'UPDATE audio_playlist_tracks SET deleted_at = ? WHERE media_id = ? AND deleted_at IS NULL',
      );
      const done: string[] = [];
      for (const id of ids) {
        if (mark.run(stamp, id).changes !== 1) continue;
        items.run(stamp, id);
        tracks.run(stamp, id);
        done.push(id);
      }
      return done;
    })();
  }

  /** Undo: media deleted (not yet gone for good) back, with the playlist items and tracks deleting took. */
  restore(ids: readonly string[]): string[] {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT deleted_at FROM media WHERE id = ? AND deleted_at IS NOT NULL');
      const items = this.db.prepare(
        'UPDATE playlist_items SET deleted_at = NULL WHERE media_id = ? AND deleted_at = ?',
      );
      const tracks = this.db.prepare(
        'UPDATE audio_playlist_tracks SET deleted_at = NULL WHERE media_id = ? AND deleted_at = ?',
      );
      const back = this.db.prepare("UPDATE media SET deleted_at = NULL WHERE id = ? AND path <> ''");
      const done: string[] = [];
      for (const id of ids) {
        const found = row.get(id) as { deleted_at: string } | undefined;
        if (!found) continue;
        // Gone for good already (its file removed): it stays a missing file.
        if (back.run(id).changes !== 1) continue;
        items.run(id, found.deleted_at);
        tracks.run(id, found.deleted_at);
        done.push(id);
      }
      return done;
    })();
  }

  /**
   * Drashti is starting: deleted media can no longer be undone. Each one's file and still frame go (but
   * never one in `keep`, on the screens again after a restart) and its row stays as a missing file.
   * Returns how many went.
   */
  async purge(mediaDir: string, keep: ReadonlySet<string>): Promise<number> {
    const rows = this.db
      .prepare("SELECT id, path, sha256 FROM media WHERE deleted_at IS NOT NULL AND path <> ''")
      .all() as { id: string; path: string; sha256: string | null }[];
    const forget = this.db.prepare(
      "UPDATE media SET path = '', missing = 1 WHERE id = ? AND deleted_at IS NOT NULL",
    );
    let gone = 0;
    for (const r of rows) {
      if (keep.has(r.id) || isAbsolute(r.path)) continue;
      forget.run(r.id);
      // Another row with the same bytes would share the file (never, one row per sha256), so it can go.
      await rm(join(mediaDir, r.path), { force: true }).catch(() => undefined);
      if (r.sha256) {
        await rm(join(mediaDir, stillPath(r.sha256)), { force: true }).catch(() => undefined);
        // Its sharpened copies (Session 26f) go with it.
        await removeCopiesOf(mediaDir, r.sha256);
      }
      gone++;
    }
    return gone;
  }
}
