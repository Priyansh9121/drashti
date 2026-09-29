/**
 * Migration 8: playlists the operator edits.
 *
 * Removing a playlist, a folder or items keeps their rows with deleted_at
 * set, so Undo can bring them back exactly (as with presentations);
 * Drashti purges them 30 days later.
 */
export const up = `
ALTER TABLE playlists ADD COLUMN deleted_at TEXT;
ALTER TABLE playlist_items ADD COLUMN deleted_at TEXT;
CREATE INDEX playlists_removed ON playlists(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX playlist_items_removed ON playlist_items(deleted_at) WHERE deleted_at IS NOT NULL;
`;
