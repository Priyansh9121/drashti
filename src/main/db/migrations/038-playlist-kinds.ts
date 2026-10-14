/**
 * Migration 38: kinds of playlist, with their settings (Session 26c).
 *
 * A playlist was one kind until now. A **smart** playlist follows a folder
 * on the computer: what Drashti imports as media or pictures there joins it
 * by itself (its settings name the folder). A **repeat** playlist (Repeat
 * Slides, Session 26d) goes round its slides by itself (its settings say
 * how). Every playlist already made is 'normal'.
 *
 * `smart_files` remembers each file a smart playlist follows: its path inside
 * the folder, its size and time when it was imported (to see it change), and
 * the playlist item it became; a file taken away is 'missing' (its item
 * stays, marked), one whose missing item was taken out is 'removed' (Undo
 * marks it missing again), and one that would not import is 'failed'.
 */
export const up = `
ALTER TABLE playlists ADD COLUMN kind TEXT NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal', 'smart', 'repeat'));
ALTER TABLE playlists ADD COLUMN settings TEXT CHECK (settings IS NULL OR json_valid(settings));
CREATE TABLE smart_files (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  relative TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  item_id TEXT,
  state TEXT NOT NULL DEFAULT 'ok' CHECK (state IN ('ok', 'missing', 'removed', 'failed')),
  PRIMARY KEY (playlist_id, relative)
);
CREATE INDEX smart_files_item ON smart_files(item_id) WHERE item_id IS NOT NULL;
`;
