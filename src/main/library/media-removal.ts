import { type BigIntStats, lstatSync, realpathSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { type EngineState, nothingUp } from '../../shared/engine/state';
import type { MediaUsage, UsedIn } from '../../shared/media-removal';
import { USED_IN_NAMES } from '../../shared/media-removal';
import { stillPath } from '../media/media-protocol';
import { removeCopiesOf } from '../media/sharpened';
import { removeBlurredOf } from '../media/blurred';
import { isInside } from '../media/contained';
import type { Db } from '../db/database';
import { MediaStore } from '../import/media-store';
import { hashOffMain } from './hash-off-main';

/*
 * Deleting media from the library (Session 26a; migration 36). Media could
 * not be removed at all before.
 *
 * - Before: where it is used (shared/media-removal.ts), for the question.
 * - Deleting marks the media row, and the playlist items and music tracks
 *   that hold it, with one moment, so Undo puts back exactly those. Slides,
 *   themes, and props and the idle rotation (unseen since Session 55), keep pointing at it: while it
 *   is deleted they treat it as a missing file (nothing in its place), except
 *   that what is on the screens now stays up until it is changed.
 * - Once it can no longer be undone (Drashti starting again), its file,
 *   still frame and sharpened copies go, and the row stays as a missing file, so what pointed at
 *   it still loads and saves as with any missing file. Importing the same
 *   file again brings it back to life everywhere (media-store.ts).
 */

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/** An earlier Trim cut in the library: its row, its file in Media, and the sha256 its cut was saved with. */
interface TrimRow {
  id: string;
  path: string;
  sha256: string;
  /** Its name in Media, for the operator's notice. */
  name: string;
}

/**
 * An earlier Trim cut whose row is gone (TM-7's mark, or the purge's): its bytes' sha256 and length, its name for the
 * notice, and its original's path and sha256, for the folder Trim wrote it into.
 */
interface GoneTrim {
  id: string;
  sha256: string;
  bytes: number | null;
  name: string;
  originalPath: string;
  originalSha256: string | null;
}

/** A cut's row as the statements bind it. */
const rowKey = ({ id, path, sha256 }: TrimRow) => ({ id, path, sha256 });

/** The files Drashti made from a media file, kept by its sha256: its still frame, sharpened and blurred copies. */
async function removeDerived(mediaDir: string, sha256: string): Promise<void> {
  await rm(join(mediaDir, stillPath(sha256)), { force: true }).catch(() => undefined);
  // Its sharpened copies (Session 26f), and its blurred copy (Session 55).
  await removeCopiesOf(mediaDir, sha256);
  await removeBlurredOf(mediaDir, sha256);
}

/**
 * The operator's notice once earlier Trim cuts went to the Trash (TM-4): which, and where to take them back from (the
 * Recycle Bin on Windows). Null when none went.
 */
export function trashedTrimsNotice(
  names: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (names.length === 0) return null;
  const trash = platform === 'win32' ? 'the Recycle Bin' : 'the Trash';
  const list = new Intl.ListFormat('en').format(names.map((name) => `“${name}”`));
  return names.length === 1
    ? `An earlier Trim cut that nothing uses any more went to ${trash}: ${list}. Take it back from there if you need it.`
    : `Earlier Trim cuts that nothing uses any more went to ${trash}: ${list}. Take them back from there if you need them.`;
}

/** The same regular file as `before`, at its own real path (no link): nothing replaced or moved it since. */
function sameFile(file: string, before: BigIntStats): boolean {
  try {
    const now = lstatSync(file, { bigint: true, throwIfNoEntry: false });
    return (
      now !== undefined &&
      now.isFile() &&
      now.dev === before.dev &&
      now.ino === before.ino &&
      now.size === before.size &&
      now.mtimeNs === before.mtimeNs &&
      realpathSync.native(file) === file
    );
  } catch {
    return false;
  }
}

/**
 * The show lets the unused Trim cuts sweep run (Session 57; review HIGH-1 of d487b875): nothing is up, and nothing
 * earlier in this run can come back by Oops, Put it back or Back. A cut no row uses now could otherwise be put up
 * again from the Trash.
 */
export function sweepQuiet(show: {
  readonly current: EngineState;
  readonly remembersEarlier: boolean;
}): boolean {
  return nothingUp(show.current.layers) && !show.remembersEarlier;
}

const usedIn = (rows: readonly { name: string }[]): UsedIn => ({
  names: rows.slice(0, USED_IN_NAMES).map((r) => r.name),
  count: rows.length,
});

export class MediaRemoval {
  constructor(
    private readonly db: Db,
    private readonly deps: {
      /** Media on the screens now (and playing on the audio layer). */
      onScreens: () => ReadonlySet<string>;
      /** Media a crash now would put back on the screens (the show saved last): the unused Trim cuts keep it. */
      putBack?: () => ReadonlySet<string>;
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
           SELECT presentation_id FROM kirtans WHERE audio_media_id IN (${list})
           UNION
           SELECT g.presentation_id FROM slides s JOIN slide_groups g ON g.id = s.group_id,
             json_tree(CASE WHEN json_valid(s.editor_design) THEN s.editor_design ELSE NULL END) j
             WHERE j.key = 'mediaId' AND j.type = 'text' AND j.value IN (${list})
           UNION
           SELECT p.id FROM presentations p,
             json_tree(CASE WHEN json_valid(p.editor_master) THEN p.editor_master ELSE NULL END) j
             WHERE j.key = 'mediaId' AND j.type = 'text' AND j.value IN (${list}))
         ORDER BY name COLLATE NOCASE`,
      )
      .all(...ids, ...ids, ...ids, ...ids, ...ids) as { name: string }[];
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
    const themes = all(
      `SELECT name FROM themes WHERE json_extract(definition, '$.background.mediaId') IN (${list})
        ORDER BY name COLLATE NOCASE`,
    );
    // The wallpapers it is in (Session 55, Part 6): it is left out of them while deleted.
    const wallpapers = all(
      `SELECT name FROM wallpapers WHERE deleted_at IS NULL AND id IN (
         SELECT wallpaper_id FROM wallpaper_pictures WHERE media_id IN (${list}))
       ORDER BY position, rowid`,
    );
    const live = this.deps.onScreens();
    return {
      presentations: usedIn(presentationRows),
      playlists: usedIn(playlists),
      music: usedIn(music),
      themes: usedIn(themes),
      live: ids.some((id) => live.has(id)),
      ...(wallpapers.length > 0 ? { wallpapers: usedIn(wallpapers) } : {}),
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
   * Earlier Trim cuts that nothing uses any more go to the computer's Trash (Session 57, TR-3), in a quiet moment
   * after the window opens: never one up now or in what a crash now would put back (`putBack`), and only while
   * `quiet` holds (index.ts: nothing up, nothing Oops, Put it back or Back could bring back, no stream or
   * recording). The library's JSON is read twice at most: once before the hashes, and once for all the cuts left
   * just before they move. Any other library write while they move leaves the rest for a later start.
   * Each cut's row is marked gone in the same turn as its last check, before it moves, so nothing can take it up
   * meanwhile; a move that fails puts the mark back (TM-7). A cut that moved takes its still frame, sharpened and
   * blurred copies with it (TM-5). The names of the cuts that moved, for the operator's notice (TM-4).
   */
  async trashUnusedTrims(
    mediaDir: string,
    trash: (file: string) => Promise<void>,
    quiet: () => boolean,
    signal: AbortSignal,
  ): Promise<string[]> {
    const paused = () => signal.aborted || !quiet();
    if (paused()) return [];
    const rows = this.db
      .prepare(
        `SELECT m.id, m.path, m.sha256, m.name FROM trimmed_videos t JOIN media m ON m.id = t.media_id
         WHERE m.source_kind = 'drashti' AND m.deleted_at IS NULL AND m.missing = 0
           AND m.path <> '' AND m.sha256 IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM playlist_items i WHERE i.media_id = m.id)
         ORDER BY m.id`,
      )
      .all() as TrimRow[];
    if (rows.length === 0) return [];

    // Include soft-deleted rows for Undo, plus durable media uses outside the removal dialog's summary.
    const used = this.db.prepare(
      `SELECT 1 WHERE
         EXISTS (SELECT 1 FROM playlist_items WHERE media_id = @id)
         OR EXISTS (SELECT 1 FROM audio_playlist_tracks WHERE media_id = @id)
         OR EXISTS (SELECT 1 FROM slide_cues WHERE media_id = @id)
         OR EXISTS (SELECT 1 FROM kirtans WHERE audio_media_id = @id)
         OR EXISTS (SELECT 1 FROM wallpaper_pictures WHERE media_id = @id)
         OR EXISTS (SELECT 1 FROM document_original_previews WHERE media_id = @id)
         OR EXISTS (SELECT 1 FROM drop_files WHERE media_id = @id)
         OR EXISTS (SELECT 1 FROM trimmed_videos WHERE original_id = @id)
         OR EXISTS (SELECT 1 FROM playlist_trim_resets WHERE original_id = @id)
         OR EXISTS (SELECT 1 FROM media_conversions WHERE original_id = @id OR converted_id = @id)
         OR EXISTS (
           SELECT 1 FROM media WHERE id <> @id AND (
             converted_from = @id
             OR replace(path, char(92), '/') COLLATE NOCASE IN (@path, @absolute, @real)
             OR replace(source_path, char(92), '/') COLLATE NOCASE IN (@path, @absolute, @real)
           )
         )`,
    );
    const scanJson = this.db.prepare<[string], { id: string }>(
      `WITH candidates(id) AS MATERIALIZED (SELECT value FROM json_each(?)),
            documents(data) AS (
              SELECT props FROM elements
              UNION ALL SELECT deck FROM slides
              UNION ALL SELECT editor_design FROM slides
              UNION ALL SELECT editor_master FROM presentations
              UNION ALL SELECT definition FROM props
              UNION ALL SELECT definition FROM themes
              UNION ALL SELECT actions FROM macros
              UNION ALL SELECT value FROM app_meta WHERE key LIKE 'setting.%'
            ),
            possible(data) AS MATERIALIZED (
              SELECT data FROM documents
               WHERE EXISTS (SELECT 1 FROM candidates WHERE instr(data, id) > 0)
                  OR instr(data, char(92) || 'u') > 0
            )
       SELECT DISTINCT j.atom AS id
         FROM possible, json_tree(CASE WHEN json_valid(data) THEN data ELSE NULL END) j
        WHERE j.type = 'text' AND j.atom IN (SELECT id FROM candidates)`,
    );
    // Every write to the library: this connection's (less the rows this pass has marked) and another's commit.
    const revision = this.db.prepare<[number], { stamp: string }>(
      'SELECT (total_changes() - ?) || char(58) || data_version AS stamp FROM pragma_data_version',
    );
    const stillManaged = this.db.prepare(
      `SELECT 1 FROM trimmed_videos t JOIN media m ON m.id = t.media_id
        WHERE m.id = @id AND m.path = @path AND m.sha256 = @sha256
          AND m.source_kind = 'drashti' AND m.deleted_at IS NULL AND m.missing = 0`,
    );
    const forget = this.db.prepare(
      `UPDATE media SET path = '', missing = 1, deleted_at = @at
       WHERE id = @id AND path = @path AND sha256 = @sha256 AND deleted_at IS NULL`,
    );
    // The mark put back when the move fails: only the one this pass made (an import of the same bytes meanwhile
    // brings the row back to life itself, at a path of its own).
    const unmark = this.db.prepare(
      `UPDATE media SET path = @path, missing = 0, deleted_at = NULL
       WHERE id = @id AND path = '' AND missing = 1 AND deleted_at = @at AND sha256 = @sha256`,
    );
    const stillMarked = this.db.prepare(
      "SELECT 1 FROM media WHERE id = @id AND path = '' AND deleted_at = @at AND sha256 = @sha256",
    );
    const root = realpathSync.native(mediaDir);
    const slash = (path: string) => path.replaceAll('\\', '/');
    const inUse = () => new Set([...this.deps.onScreens(), ...(this.deps.putBack?.() ?? [])]);
    const usedNow = (row: TrimRow, file: string, up: ReadonlySet<string>) =>
      up.has(row.id) ||
      used.get({
        id: row.id,
        path: slash(row.path),
        absolute: slash(resolve(mediaDir, row.path)),
        real: slash(file),
      }) !== undefined;
    // The cheap checks for each cut, then one pass over the library's JSON for all of them at once.
    const unused = <T extends { row: TrimRow; file: string }>(cuts: readonly T[]): T[] => {
      const up = inUse();
      const left = cuts.filter(({ row, file }) => !usedNow(row, file, up));
      if (left.length === 0) return left;
      const named = new Set(scanJson.all(JSON.stringify(left.map(({ row }) => row.id))).map(({ id }) => id));
      return left.filter(({ row }) => !named.has(row.id));
    };

    const inMedia = rows.flatMap((row) => {
      const file = resolve(root, row.path);
      return isAbsolute(row.path) || !isInside(root, file) ? [] : [{ row, file }];
    });
    const checked: { row: TrimRow; file: string; before: BigIntStats }[] = [];
    for (const { row, file } of unused(inMedia)) {
      await setImmediate();
      if (paused()) return [];
      try {
        const before = lstatSync(file, { bigint: true });
        if (!before.isFile() || realpathSync.native(file) !== file) continue;
        const { sha256 } = await hashOffMain(file, signal);
        if (paused()) return [];
        // Only the bytes Drashti wrote, the same file before and after the hash.
        if (sha256 === row.sha256 && sameFile(file, before)) checked.push({ row, file, before });
      } catch {
        // A file the system could not check stays in the library for the next start.
      }
    }
    await setImmediate();
    if (paused() || checked.length === 0) return [];

    // The last check, for all of them at once, in the same turn as the first move.
    const ready = unused(
      checked.filter(
        ({ row, file, before }) => stillManaged.get(rowKey(row)) !== undefined && sameFile(file, before),
      ),
    );
    const checkedAt = revision.get(0)?.stamp;
    const gone: string[] = [];
    // This pass's own writes to the library (each mark, and each mark put back), which the stamp leaves out.
    let own = 0;
    for (const { row, file, before } of ready) {
      // Anything else written to the library since that check (an edit, an import, bookkeeping) could name the
      // rest: they wait for a later start.
      if (paused() || revision.get(own)?.stamp !== checkedAt) break;
      const key = rowKey(row);
      if (usedNow(row, file, inUse()) || stillManaged.get(key) === undefined || !sameFile(file, before))
        continue;
      // Marked gone in the same turn as its last check (TM-7): from here it reads as a missing file that can't be
      // added anywhere, so no use can name it while it moves.
      const marked = { ...key, at: new Date().toISOString() };
      if (forget.run(marked).changes !== 1) continue;
      own++;
      try {
        await trash(file);
      } catch {
        // A file the system could not move stays in the library as it was, for the next start.
        own += unmark.run(marked).changes;
        continue;
      }
      gone.push(row.name);
      // Its still frame, sharpened and blurred copies go with it (TM-5), as the purge's do: unless an import of the
      // same bytes brought its row back to life meanwhile, when they are that file's.
      if (stillMarked.get({ id: marked.id, at: marked.at, sha256: marked.sha256 }) !== undefined)
        await removeDerived(mediaDir, row.sha256);
    }
    return gone;
  }

  /**
   * Earlier Trim cuts whose move to the Trash a quit cut short (FT-8): each row was marked gone (TM-7's mark, or the
   * purge's) but its file stayed in Media, named by nothing. In the same quiet moment as trashUnusedTrims, such a file
   * goes to the Trash with its still frame, sharpened and blurred copies (TM-5). Only a regular file (no link, no hidden
   * part) in the folder Trim wrote the cut into (its original's: trim-copy.ts), named by no row, held by none of Trim's
   * records (`held`: a cut being made or waiting, its copy, its original), with the very bytes of one cut whose row is
   * gone, and the only file with them. Anything less certain stays where it is, and the log says why. The names of the
   * cuts whose files moved, for the operator's notice (TM-4).
   *
   * No row can come to name such a file while it moves: an import keeps its copy at a path named by its own bytes
   * (media-store.ts), and Trim publishes a cut only at a free name (trim.ts's freeFileName). An import of the same bytes
   * meanwhile brings the cut's row back to life at that other path: the file left still goes, its still frame and
   * copies stay (the row's again).
   */
  async trashLeftTrims(
    mediaDir: string,
    trash: (file: string) => Promise<void>,
    quiet: () => boolean,
    signal: AbortSignal,
    options: { held: () => ReadonlySet<string>; log?: (message: string) => void },
  ): Promise<string[]> {
    const paused = () => signal.aborted || !quiet();
    if (paused()) return [];
    const cuts = this.db
      .prepare(
        `SELECT m.id, m.sha256, m.bytes, m.name, o.path AS originalPath, o.sha256 AS originalSha256
           FROM trimmed_videos t JOIN media m ON m.id = t.media_id JOIN media o ON o.id = t.original_id
          WHERE m.source_kind = 'drashti' AND m.path = '' AND m.missing = 1 AND m.deleted_at IS NOT NULL
            AND m.sha256 IS NOT NULL
          ORDER BY m.id`,
      )
      .all() as GoneTrim[];
    if (cuts.length === 0) return [];
    const say = (message: string) => options.log?.(`Media: ${message}`);
    const root = realpathSync.native(mediaDir);
    const slash = (path: string) => path.replaceAll('\\', '/');
    const inMedia = (file: string) => slash(relative(root, file));
    // Why, by the cut's id where there is one: never a file's name or path (the log's rule).
    const left = (why: string) => {
      say(`left a file in a Trim cut's folder where it is: ${why}`);
    };
    // The folder Trim wrote a cut into: its original's, or (the original gone for good) where Media keeps its bytes.
    const folderOf = (cut: GoneTrim): string | null => {
      const folder =
        cut.originalPath !== ''
          ? isAbsolute(cut.originalPath)
            ? null
            : dirname(resolve(root, cut.originalPath))
          : cut.originalSha256
            ? dirname(join(root, MediaStore.storedPath(cut.originalSha256, '')))
            : null;
      return folder !== null && (folder === root || isInside(root, folder)) ? folder : null;
    };
    const bySha = new Map(cuts.map((cut) => [cut.sha256, cut]));
    const folders = new Map<string, GoneTrim[]>();
    for (const cut of cuts) {
      const folder = folderOf(cut);
      if (folder === null)
        say(
          `earlier Trim cut ${cut.id} may have left its file in Media: the folder it was written into is not known, so none was looked for`,
        );
      else folders.set(folder, [...(folders.get(folder) ?? []), cut]);
    }

    // Every path a row names (its file, or where it came from), as compared: slashes one way, any case.
    const named = new Set(
      (
        this.db
          .prepare(
            `SELECT path AS named FROM media WHERE path <> ''
             UNION SELECT source_path FROM media WHERE source_path IS NOT NULL AND source_path <> ''`,
          )
          .all() as { named: string }[]
      ).map(({ named: path }) => slash(path).toLowerCase()),
    );
    const namedNow = this.db.prepare(
      `SELECT 1 FROM media
        WHERE replace(path, char(92), '/') COLLATE NOCASE IN (@path, @absolute, @real)
           OR replace(source_path, char(92), '/') COLLATE NOCASE IN (@path, @absolute, @real)
        LIMIT 1`,
    );
    const keys = (file: string) => {
      const path = inMedia(file);
      return { path, absolute: slash(resolve(mediaDir, path)), real: slash(file) };
    };
    const heldNow = () => new Set([...options.held()].map((path) => slash(path).toLowerCase()));
    // A file's path in Media, full and real, each compared in any case.
    const forms = (file: string) => Object.values(keys(file)).map((key) => key.toLowerCase());
    const known = (file: string, held: ReadonlySet<string>) =>
      forms(file).some((key) => named.has(key) || held.has(key));
    const heldAny = (file: string) => {
      const held = heldNow();
      return forms(file).some((key) => held.has(key));
    };

    const found: { cut: GoneTrim; file: string; before: BigIntStats }[] = [];
    for (const [folder, inFolder] of folders) {
      // No such folder any more: nothing was left in it.
      const entries = await readdir(folder, { withFileTypes: true }).catch(() => null);
      if (!entries) continue;
      const held = heldNow();
      for (const entry of entries) {
        const file = join(folder, entry.name);
        // A link, a folder or a hidden part (a cut being made, an import's copy) is never one.
        if (!entry.isFile() || entry.name.startsWith('.') || known(file, held)) continue;
        await setImmediate();
        if (paused()) return [];
        try {
          const before = lstatSync(file, { bigint: true });
          // Only a file as long as a cut of this folder whose row is gone (or one whose length was never kept).
          if (
            !before.isFile() ||
            !inFolder.some((cut) => cut.bytes === null || BigInt(cut.bytes) === before.size)
          )
            continue;
          if (realpathSync.native(file) !== file) {
            left('it is reached through a link');
            continue;
          }
          const { sha256 } = await hashOffMain(file, signal);
          if (paused()) return [];
          const cut = bySha.get(sha256);
          if (!cut) left('no earlier Trim cut whose row is gone has its bytes');
          else if (folderOf(cut) !== folder)
            left(`it has the bytes of cut ${cut.id}, written into another folder`);
          else if (!sameFile(file, before)) left(`cut ${cut.id}'s file changed while it was read`);
          else found.push({ cut, file, before });
        } catch {
          if (paused()) return [];
          left('it could not be read');
        }
      }
    }
    await setImmediate();
    if (paused() || found.length === 0) return [];

    const files = new Map<string, number>();
    for (const { cut } of found) files.set(cut.id, (files.get(cut.id) ?? 0) + 1);
    const stillGone = this.db.prepare(
      "SELECT 1 FROM media WHERE id = @id AND sha256 = @sha256 AND path = '' AND deleted_at IS NOT NULL",
    );
    const inUse = () => new Set([...this.deps.onScreens(), ...(this.deps.putBack?.() ?? [])]);
    const gone: string[] = [];
    for (const { cut, file, before } of found) {
      if ((files.get(cut.id) ?? 0) > 1) {
        left(`the bytes of cut ${cut.id} are in more than one file, so which is the cut cannot be known`);
        continue;
      }
      if (paused()) break;
      const key = { id: cut.id, sha256: cut.sha256 };
      // The last check, in the same turn as the move: its row still gone and not on the screens or in what a crash
      // would put back, the file named by no row and held by no Trim record, and the same file as was read.
      if (
        stillGone.get(key) === undefined ||
        inUse().has(cut.id) ||
        namedNow.get(keys(file)) !== undefined ||
        heldAny(file) ||
        !sameFile(file, before)
      ) {
        left(`cut ${cut.id} or its file changed since it was read`);
        continue;
      }
      try {
        await trash(file);
      } catch {
        // A file the system could not move stays, for a later start.
        continue;
      }
      gone.push(cut.name);
      // Its still frame, sharpened and blurred copies go with it (TM-5): unless an import of the same bytes brought
      // its row back to life meanwhile, when they are that file's.
      if (stillGone.get(key) !== undefined) await removeDerived(mediaDir, cut.sha256);
    }
    return gone;
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
      // Only Drashti's own copy, inside its media folder (Session 55, Part 14): never a file of the owner's, named by
      // its full path or by one that climbs out of the folder.
      const own = resolve(mediaDir, r.path);
      if (keep.has(r.id) || isAbsolute(r.path) || !isInside(resolve(mediaDir), own)) continue;
      forget.run(r.id);
      // Another row with the same bytes would share the file (never, one row per sha256), so it can go.
      await rm(own, { force: true }).catch(() => undefined);
      // Its still frame, sharpened copies (Session 26f) and blurred copy (Session 55) go with it.
      if (r.sha256) await removeDerived(mediaDir, r.sha256);
      gone++;
    }
    return gone;
  }
}

/**
 * Start once the operator window has opened, `delayMs` into a quiet moment (as long as kept conversions wait after
 * the start, AFTER_START_MS). Yield to a show, a stream, or a recording.
 */
export class TrimCleanup {
  private opened = false;
  private closed = false;
  private timer: NodeJS.Timeout | null = null;
  private running: AbortController | null = null;

  constructor(
    private readonly quiet: () => boolean,
    private readonly sweep: (signal: AbortSignal) => Promise<void>,
    private readonly failed: (error: unknown) => void,
    private readonly delayMs = 10_000,
  ) {}

  open(): void {
    this.opened = true;
    this.activityChanged();
  }

  activityChanged(): void {
    if (!this.opened || this.closed) return;
    if (!this.quiet()) {
      this.pause();
      return;
    }
    if (!this.timer && !this.running) this.timer = setTimeout(() => this.start(), this.delayMs).unref();
  }

  close(): void {
    this.closed = true;
    this.pause();
  }

  private pause(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running?.abort();
  }

  private start(): void {
    this.timer = null;
    if (this.closed || !this.quiet()) return;
    const attempt = new AbortController();
    this.running = attempt;
    void this.sweep(attempt.signal)
      .catch(this.failed)
      .finally(() => {
        this.running = null;
        if (attempt.signal.aborted) this.activityChanged();
        else this.closed = true;
      });
  }
}
