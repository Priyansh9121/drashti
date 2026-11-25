import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Db } from '../db/database';

/*
 * What uses a media row in the library. Session 57's Trim cleanup (TR-3, media-removal.ts trashUnusedTrims) wrote these
 * two checks; since alpha.23 (a22-review-combine2 MUST-1) discardUnlisted asks the very same before it removes a
 * combine's or an export's unlisted copy, because an import can take up a row by its bytes without listing it (an
 * editable document object, a kirtan bundle's link, Edit Video's copy).
 */

/**
 * Anything that holds the row, soft-deleted uses included (for Undo): running orders, music tracks, cues, kirtans,
 * wallpapers, document previews, the drop folder, trims, conversions, or another row keeping its file (its path or its
 * source, with \ read as / and any case). Bound by name: @id, and its file as @path (as kept), @absolute (inside Media)
 * and @real (inside Media's real folder), each with / only.
 */
export const MEDIA_USED_SQL = `SELECT 1 WHERE
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
         )`;

/** The ids among a JSON array of candidates that any of the library's JSON names (slides, decks, designs, props, themes, macros, settings). */
export const MEDIA_NAMED_SQL = `WITH candidates(id) AS MATERIALIZED (SELECT value FROM json_each(?)),
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
        WHERE j.type = 'text' AND j.atom IN (SELECT id FROM candidates)`;

/**
 * Which of `rows` anything in the library uses (MEDIA_USED_SQL for each, then one MEDIA_NAMED_SQL pass for the rest).
 * Synchronous, so it can run inside the transaction that removes them.
 */
export function mediaInUse(
  db: Db,
  mediaDir: string,
  rows: readonly { id: string; path: string }[],
): Set<string> {
  const found = new Set<string>();
  if (rows.length === 0) return found;
  const slash = (path: string) => path.replaceAll('\\', '/');
  let root = resolve(mediaDir);
  try {
    root = realpathSync.native(mediaDir);
  } catch {
    /* Media's folder as given. */
  }
  const used = db.prepare(MEDIA_USED_SQL);
  for (const row of rows) {
    const named = {
      id: row.id,
      path: slash(row.path),
      absolute: slash(resolve(mediaDir, row.path)),
      real: slash(resolve(root, row.path)),
    };
    if (used.get(named) !== undefined) found.add(row.id);
  }
  const left = rows.filter((row) => !found.has(row.id)).map((row) => row.id);
  if (left.length > 0)
    for (const { id } of db.prepare<[string], { id: string }>(MEDIA_NAMED_SQL).all(JSON.stringify(left)))
      found.add(id);
  return found;
}
