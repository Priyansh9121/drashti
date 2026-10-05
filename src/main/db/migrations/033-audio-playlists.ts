/**
 * Migration 33: audio playlists (Session 14).
 *
 * An ordered list of sounds from the media library, played one after
 * another on the audio layer (music before the sabha), independent of the
 * slides: whether it goes round again at the end, and whether it plays in a
 * shuffled order. Removing a sound from the library takes it out of every
 * audio playlist.
 */
export const up = `
CREATE TABLE audio_playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  loop INTEGER NOT NULL DEFAULT 1 CHECK (loop IN (0, 1)),
  shuffle INTEGER NOT NULL DEFAULT 0 CHECK (shuffle IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE audio_playlist_tracks (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES audio_playlists(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  position INTEGER NOT NULL
);
CREATE INDEX audio_playlist_tracks_in_order ON audio_playlist_tracks(playlist_id, position);
CREATE INDEX audio_playlist_tracks_by_media ON audio_playlist_tracks(media_id);
`;
