/**
 * Migration 1: the core model from PLAN.md section 4.3.
 *
 * Conventions:
 * - ids are TEXT UUIDs, so libraries can later be merged across mandirs;
 * - timestamps are ISO-8601 UTC text;
 * - JSON columns are checked with json_valid();
 * - every item that can be imported carries source_kind, source_path,
 *   source_ref (the original UUID) and source_imported_at, so imports can
 *   be re-run and traced back to the ProPresenter file they came from.
 */
const now = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
const source = `
  source_kind TEXT CHECK (source_kind IS NULL OR source_kind IN ('pp6', 'pp7', 'text', 'docx', 'media', 'drashti')),
  source_path TEXT,
  source_ref TEXT,
  source_imported_at TEXT`;
const stamps = `
  created_at TEXT NOT NULL DEFAULT ${now},
  updated_at TEXT NOT NULL DEFAULT ${now}`;
const json = (column: string, fallback: string) =>
  `${column} TEXT NOT NULL DEFAULT '${fallback}' CHECK (json_valid(${column}))`;
const langs = "('en', 'gu', 'hi', 'translit')";

export const up = `
CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Library ------------------------------------------------------------------

CREATE TABLE libraries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,${source},${stamps}
);

CREATE TABLE themes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ${json('definition', '{}')},${source},${stamps}
);

CREATE TABLE presentations (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 1920 CHECK (width BETWEEN 16 AND 16384),
  height INTEGER NOT NULL DEFAULT 1080 CHECK (height BETWEEN 16 AND 16384),
  theme_id TEXT REFERENCES themes(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',${source},${stamps}
);
CREATE INDEX presentations_by_library ON presentations(library_id, name);
CREATE INDEX presentations_by_source ON presentations(source_kind, source_path);

-- Groups (Verse, Chorus, ...) hold slides; arrangements reorder groups.
CREATE TABLE slide_groups (
  id TEXT PRIMARY KEY,
  presentation_id TEXT NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  position INTEGER NOT NULL
);
CREATE INDEX slide_groups_by_presentation ON slide_groups(presentation_id, position);

CREATE TABLE slides (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES slide_groups(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  background TEXT,
  transition TEXT CHECK (transition IS NULL OR json_valid(transition)),
  auto_advance_ms INTEGER CHECK (auto_advance_ms IS NULL OR auto_advance_ms > 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);
CREATE INDEX slides_by_group ON slides(group_id, position);

-- Elements are drawn in position order (z-order). props holds the
-- kind-specific data (text, style and language; fill; media reference).
CREATE TABLE elements (
  id TEXT PRIMARY KEY,
  slide_id TEXT NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'shape', 'image', 'video')),
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL CHECK (width >= 0),
  height REAL NOT NULL CHECK (height >= 0),
  rotation REAL NOT NULL DEFAULT 0,
  ${json('props', '{}')}
);
CREATE INDEX elements_by_slide ON elements(slide_id, position);

CREATE TABLE arrangements (
  id TEXT PRIMARY KEY,
  presentation_id TEXT NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);
CREATE TABLE arrangement_groups (
  arrangement_id TEXT NOT NULL REFERENCES arrangements(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  group_id TEXT NOT NULL REFERENCES slide_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (arrangement_id, position)
);

-- Kirtan = a presentation + parallel language tracks + metadata.
CREATE TABLE kirtans (
  presentation_id TEXT PRIMARY KEY REFERENCES presentations(id) ON DELETE CASCADE,
  category TEXT,
  kavi TEXT,
  raag TEXT,
  occasion TEXT,
  audio_url TEXT
);
CREATE TABLE kirtan_tracks (
  kirtan_id TEXT NOT NULL REFERENCES kirtans(presentation_id) ON DELETE CASCADE,
  lang TEXT NOT NULL CHECK (lang IN ${langs}),
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'auto', 'imported')),
  PRIMARY KEY (kirtan_id, lang)
);
-- One line of a track per slide, so each screen can show its own languages.
CREATE TABLE kirtan_track_lines (
  kirtan_id TEXT NOT NULL,
  lang TEXT NOT NULL,
  slide_id TEXT NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  PRIMARY KEY (kirtan_id, lang, slide_id),
  FOREIGN KEY (kirtan_id, lang) REFERENCES kirtan_tracks(kirtan_id, lang) ON DELETE CASCADE
);

-- Media and playlists -------------------------------------------------------

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT,
  bytes INTEGER CHECK (bytes IS NULL OR bytes >= 0),
  duration_ms INTEGER,
  width INTEGER,
  height INTEGER,${source},${stamps}
);
CREATE INDEX media_by_source ON media(source_kind, source_path);

CREATE TABLE playlists (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES playlists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_folder INTEGER NOT NULL DEFAULT 0 CHECK (is_folder IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0,${source},${stamps}
);
CREATE TABLE playlist_items (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('presentation', 'media', 'header', 'placeholder')),
  presentation_id TEXT REFERENCES presentations(id) ON DELETE CASCADE,
  arrangement_id TEXT REFERENCES arrangements(id) ON DELETE SET NULL,
  media_id TEXT REFERENCES media(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  color TEXT,
  hint TEXT,
  CHECK ((kind = 'presentation') = (presentation_id IS NOT NULL)),
  CHECK ((kind = 'media') = (media_id IS NOT NULL))
);
CREATE INDEX playlist_items_by_playlist ON playlist_items(playlist_id, position);

-- Shastra texts -------------------------------------------------------------

CREATE TABLE shastra_texts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  abbreviation TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',${source},${stamps}
);
CREATE TABLE shastra_sections (
  id TEXT PRIMARY KEY,
  text_id TEXT NOT NULL REFERENCES shastra_texts(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES shastra_sections(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  reference TEXT
);
CREATE TABLE shastra_verses (
  id TEXT PRIMARY KEY,
  section_id TEXT NOT NULL REFERENCES shastra_sections(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  reference TEXT NOT NULL
);
CREATE TABLE shastra_verse_texts (
  verse_id TEXT NOT NULL REFERENCES shastra_verses(id) ON DELETE CASCADE,
  lang TEXT NOT NULL CHECK (lang IN ('en', 'gu', 'hi', 'sa', 'translit')),
  text TEXT NOT NULL,
  PRIMARY KEY (verse_id, lang)
);

-- Show configuration ----------------------------------------------------------

CREATE TABLE looks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ${json('definition', '{}')},${source},${stamps}
);

CREATE TABLE screen_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'audience' CHECK (role IN ('audience', 'stage', 'stream', 'other')),
  look_id TEXT REFERENCES looks(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,${stamps}
);

-- Drashti Nodes (Phase 3): other computers that render screens.
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT,
  port INTEGER,
  last_seen_at TEXT,${stamps}
);

-- A screen is one output. display_key identifies the OS display it is
-- assigned to (null = not assigned, or an offscreen output such as a stream).
CREATE TABLE screens (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES screen_groups(id) ON DELETE CASCADE,
  node_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_key TEXT CHECK (display_key IS NULL OR json_valid(display_key)),
  canvas_width INTEGER NOT NULL DEFAULT 1920 CHECK (canvas_width BETWEEN 16 AND 16384),
  canvas_height INTEGER NOT NULL DEFAULT 1080 CHECK (canvas_height BETWEEN 16 AND 16384),
  scaling TEXT NOT NULL DEFAULT 'fit' CHECK (scaling IN ('fit', 'fill', 'stretch')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0,${stamps}
);
CREATE INDEX screens_by_group ON screens(group_id, position);

CREATE TABLE stage_layouts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ${json('definition', '{}')},${source},${stamps}
);

CREATE TABLE props (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ${json('definition', '{}')},${source},${stamps}
);

-- Messages are templates with {tokens}, e.g. 'Car {plate} please move'.
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  template TEXT NOT NULL,
  ${json('definition', '{}')},${source},${stamps}
);

CREATE TABLE timers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('countdown', 'countup', 'countdown_to_time', 'clock')),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  target_time TEXT,
  allows_overrun INTEGER NOT NULL DEFAULT 0 CHECK (allows_overrun IN (0, 1)),${source},${stamps}
);

CREATE TABLE macros (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  ${json('actions', '[]')},${source},${stamps}
);

-- The stream key itself lives in the OS keychain (Electron safeStorage), never here.
CREATE TABLE stream_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  service TEXT NOT NULL DEFAULT 'youtube',
  rtmp_url TEXT NOT NULL,
  video_bitrate_kbps INTEGER,
  audio_bitrate_kbps INTEGER,
  width INTEGER,
  height INTEGER,
  fps INTEGER,
  encoder TEXT,${stamps}
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'volunteer')),
  pin_hash TEXT,${stamps}
);
`;
