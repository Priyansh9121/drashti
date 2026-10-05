/**
 * Migration 30: output nodes (Session 13).
 *
 * The placeholder `nodes` table from the core model becomes the nodes Main
 * has paired: each with the SHA-256 of its token (the token itself is given
 * to the node once, when it pairs, and kept nowhere on Main), when it paired,
 * the version it last ran, whether it copies every picture and video in the
 * library ("Get everything ready"), and the displays it last reported, so
 * Screens can list them while it is offline. `host` is the address it last
 * connected from. A screen on a node's display has `node_id` set (unused
 * until now); removing a node removes its screens.
 *
 * Nodes copy the week's playlists' media ahead of time, so a playlist's
 * `updated_at` now changes whenever its items do (triggers), not only when
 * it is renamed.
 */
export const up = `
DELETE FROM nodes;
ALTER TABLE nodes ADD COLUMN token_hash TEXT CHECK (token_hash IS NULL OR length(token_hash) = 64);
ALTER TABLE nodes ADD COLUMN paired_at TEXT;
ALTER TABLE nodes ADD COLUMN version TEXT;
ALTER TABLE nodes ADD COLUMN everything INTEGER NOT NULL DEFAULT 0 CHECK (everything IN (0, 1));
ALTER TABLE nodes ADD COLUMN displays TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(displays));
CREATE UNIQUE INDEX nodes_by_token ON nodes(token_hash);
CREATE INDEX screens_by_node ON screens(node_id, position);
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
