/**
 * Migration 47: a video input as a playlist item (Session 51, shared/playlists.ts). An item's kind may be 'input':
 * it names one of a computer's video inputs by the input's own name (`input_name`, "Input 1"), never by an id,
 * for the inputs belong to one computer while the library travels; each computer finds its own input of that
 * name (shared/video-inputs.ts inputNamed). The playlist_items table is built again with its CHECKs widened
 * (SQLite cannot change a CHECK in place), keeping every row and rowid (items in the same place keep their order
 * by it). No table refers to an item. Dropping the old table drops its indexes and the triggers that tell nodes
 * a playlist changed (migration 30), so they are made again as they were, after the rows are copied: the
 * upgrade itself changes no playlist's time. An older Drashti never meets an input item: it refuses a library
 * written by a newer one.
 */
export const up = `
CREATE TABLE playlist_items_new (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('presentation', 'media', 'header', 'placeholder', 'shastra', 'input')),
  presentation_id TEXT REFERENCES presentations(id) ON DELETE CASCADE,
  arrangement_id TEXT REFERENCES arrangements(id) ON DELETE SET NULL,
  media_id TEXT REFERENCES media(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  color TEXT,
  hint TEXT,
  order_mode TEXT NOT NULL DEFAULT 'presentation'
    CHECK (order_mode IN ('presentation', 'arrangement', 'all')),
  deleted_at TEXT,
  category TEXT,
  passage TEXT CHECK (passage IS NULL OR json_valid(passage)),
  timers TEXT CHECK (timers IS NULL OR json_valid(timers)),
  input_name TEXT,
  CHECK ((kind = 'presentation') = (presentation_id IS NOT NULL)),
  CHECK ((kind = 'media') = (media_id IS NOT NULL)),
  CHECK ((kind = 'shastra') = (passage IS NOT NULL)),
  CHECK ((kind = 'input') = (input_name IS NOT NULL))
);
INSERT INTO playlist_items_new
  (rowid, id, playlist_id, position, kind, presentation_id, arrangement_id, media_id, label, color, hint,
   order_mode, deleted_at, category, passage, timers)
  SELECT rowid, id, playlist_id, position, kind, presentation_id, arrangement_id, media_id, label, color, hint,
         order_mode, deleted_at, category, passage, timers
  FROM playlist_items;
DROP TABLE playlist_items;
ALTER TABLE playlist_items_new RENAME TO playlist_items;
CREATE INDEX playlist_items_by_playlist ON playlist_items(playlist_id, position);
CREATE INDEX playlist_items_removed ON playlist_items(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TRIGGER playlist_items_touch_insert AFTER INSERT ON playlist_items BEGIN
  UPDATE playlists SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.playlist_id;
END;
CREATE TRIGGER playlist_items_touch_update AFTER UPDATE ON playlist_items BEGIN
  UPDATE playlists SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE id IN (NEW.playlist_id, OLD.playlist_id);
END;
CREATE TRIGGER playlist_items_touch_delete AFTER DELETE ON playlist_items BEGIN
  UPDATE playlists SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = OLD.playlist_id;
END;
`;
