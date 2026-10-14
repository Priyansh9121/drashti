/**
 * Migration 36: deleting media, and music, with Undo (Session 26a).
 *
 * Media could not be removed at all before. A deleted media item keeps its
 * row (and its file) with deleted_at set, so Undo can bring it back exactly;
 * deleting it also takes it out of playlists and music, marking those rows
 * with the same moment, so Undo puts back just what it took. Removing an
 * audio playlist, or a track from one, now marks it too (it was deleted
 * outright). What is marked can no longer be undone once Drashti starts
 * again: it goes for good then, a media item's file with it, unless it is
 * on the screens.
 */
export const up = `
ALTER TABLE media ADD COLUMN deleted_at TEXT;
CREATE INDEX media_removed ON media(deleted_at) WHERE deleted_at IS NOT NULL;
ALTER TABLE audio_playlists ADD COLUMN deleted_at TEXT;
ALTER TABLE audio_playlist_tracks ADD COLUMN deleted_at TEXT;
`;
