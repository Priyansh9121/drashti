/**
 * Migration 41: several platforms at once (Session 28, decision 18).
 *
 * A stream profile still has its own address (rtmp_url) and its key, kept by the profile's id in the key
 * store, as before; up to two more places now go beside it, each with its own address, in
 * stream_destinations (its key kept by the place's id, never here). A third preset, 'several' (1080p30 at
 * 5 Mbps to each place), widens the preset CHECK, which SQLite cannot change in place: the table is built
 * again, keeping every row and rowid.
 */
export const up = `
CREATE TABLE stream_profiles_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  service TEXT NOT NULL DEFAULT 'youtube',
  rtmp_url TEXT NOT NULL,
  video_bitrate_kbps INTEGER,
  audio_bitrate_kbps INTEGER,
  width INTEGER,
  height INTEGER,
  fps INTEGER,
  encoder TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  preset TEXT NOT NULL DEFAULT 'good' CHECK (preset IN ('good', 'weak', 'several')),
  camera TEXT CHECK (camera IS NULL OR json_valid(camera)),
  sound TEXT CHECK (sound IS NULL OR json_valid(sound)),
  sound_delay_ms INTEGER NOT NULL DEFAULT 0 CHECK (sound_delay_ms BETWEEN 0 AND 1000),
  mix_own_sound INTEGER NOT NULL DEFAULT 0 CHECK (mix_own_sound IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO stream_profiles_new (rowid, id, name, service, rtmp_url, video_bitrate_kbps, audio_bitrate_kbps, width, height, fps,
    encoder, created_at, updated_at, preset, camera, sound, sound_delay_ms, mix_own_sound, position)
  SELECT rowid, id, name, service, rtmp_url, video_bitrate_kbps, audio_bitrate_kbps, width, height, fps,
    encoder, created_at, updated_at, preset, camera, sound, sound_delay_ms, mix_own_sound, position
  FROM stream_profiles;
DROP TABLE stream_profiles;
ALTER TABLE stream_profiles_new RENAME TO stream_profiles;

CREATE TABLE stream_destinations (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES stream_profiles(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  -- After the profile's own address: 1 or 2 (three places at most).
  position INTEGER NOT NULL CHECK (position IN (1, 2)),
  UNIQUE (profile_id, position)
);
`;
