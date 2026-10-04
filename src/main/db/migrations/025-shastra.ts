/**
 * Migration 25: the Shastra module (Session 12).
 *
 * Migration 1 made placeholder tables for Shastra texts that nothing ever
 * wrote to; they are made again as the module needs them (src/shared/
 * shastra.ts). A text is known by its abbreviation's key, so loading it
 * again updates it; sections by their path of keys from the text down,
 * and items by their section and number, so updating keeps their ids. Each
 * item's words are kept per language, with a mark on those Drashti made
 * (transliteration, Sanskrit in its other script). Search has an index of
 * its own, over words folded as the library's are (src/shared/search.ts).
 *
 * import_items is rebuilt so the import report can list the files an admin
 * loads that are not presentations: Shastra texts, and (for the calendar
 * and the quotes on idle screens, also Session 12) calendars and quotes.
 *
 * playlist_items is rebuilt so an item can be a passage ('shastra'), named
 * by keys as JSON (shared/shastra.ts PassageKey) rather than by ids: a
 * playlist keeps its passage when the text is loaded again, even after it
 * was removed.
 */
const now = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

export const up = `
DROP TABLE shastra_verse_texts;
DROP TABLE shastra_verses;
DROP TABLE shastra_sections;
DROP TABLE shastra_texts;

CREATE TABLE shastra_texts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  abbreviation TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  theme_id TEXT REFERENCES themes(id) ON DELETE SET NULL,
  languages TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(languages)),
  item_count INTEGER NOT NULL DEFAULT 0,
  section_count INTEGER NOT NULL DEFAULT 0,
  source_path TEXT,
  source_hash TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  loaded_at TEXT NOT NULL DEFAULT ${now},
  created_at TEXT NOT NULL DEFAULT ${now},
  updated_at TEXT NOT NULL DEFAULT ${now}
);

CREATE TABLE shastra_sections (
  id TEXT PRIMARY KEY,
  text_id TEXT NOT NULL REFERENCES shastra_texts(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES shastra_sections(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  abbreviation TEXT,
  UNIQUE (text_id, path)
);

CREATE TABLE shastra_items (
  id TEXT PRIMARY KEY,
  text_id TEXT NOT NULL REFERENCES shastra_texts(id) ON DELETE CASCADE,
  section_id TEXT REFERENCES shastra_sections(id) ON DELETE CASCADE,
  section_path TEXT NOT NULL DEFAULT '',
  number INTEGER NOT NULL,
  position INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  UNIQUE (text_id, section_path, number)
);
CREATE INDEX shastra_items_in_order ON shastra_items(text_id, position);

CREATE TABLE shastra_item_texts (
  item_id TEXT NOT NULL REFERENCES shastra_items(id) ON DELETE CASCADE,
  lang TEXT NOT NULL CHECK (lang IN ('en', 'gu', 'hi', 'translit', 'sa', 'sa-gu')),
  text TEXT NOT NULL,
  made INTEGER NOT NULL DEFAULT 0 CHECK (made IN (0, 1)),
  PRIMARY KEY (item_id, lang)
);

-- Rows are shastra_items' rowids.
CREATE VIRTUAL TABLE shastra_fts USING fts5(reference, body, tokenize = 'ascii', prefix = '2 3');

CREATE TABLE import_items_new (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  source_path TEXT NOT NULL,
  format TEXT NOT NULL
    CHECK (format IN ('text', 'media', 'pp6', 'pp7', 'unknown', 'shastra', 'calendar', 'quotes')),
  outcome TEXT NOT NULL
    CHECK (outcome IN ('imported', 'replaced', 'kept-both', 'skipped', 'conflict', 'failed', 'unsupported')),
  name TEXT,
  target_kind TEXT CHECK (target_kind IS NULL OR target_kind IN ('presentation', 'media', 'playlist', 'shastra', 'calendar', 'quotes')),
  target_id TEXT,
  counts TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(counts)),
  message TEXT
);
INSERT INTO import_items_new SELECT id, run_id, position, source_path, format, outcome, name, target_kind, target_id, counts, message
  FROM import_items;
DROP TABLE import_items;
ALTER TABLE import_items_new RENAME TO import_items;
CREATE INDEX import_items_by_run ON import_items(run_id, position);

CREATE TABLE playlist_items_new (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('presentation', 'media', 'header', 'placeholder', 'shastra')),
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
  CHECK ((kind = 'presentation') = (presentation_id IS NOT NULL)),
  CHECK ((kind = 'media') = (media_id IS NOT NULL)),
  CHECK ((kind = 'shastra') = (passage IS NOT NULL))
);
INSERT INTO playlist_items_new
  (id, playlist_id, position, kind, presentation_id, arrangement_id, media_id, label, color, hint,
   order_mode, deleted_at, category)
  SELECT id, playlist_id, position, kind, presentation_id, arrangement_id, media_id, label, color, hint,
         order_mode, deleted_at, category
  FROM playlist_items;
DROP TABLE playlist_items;
ALTER TABLE playlist_items_new RENAME TO playlist_items;
CREATE INDEX playlist_items_by_playlist ON playlist_items(playlist_id, position);
CREATE INDEX playlist_items_removed ON playlist_items(deleted_at) WHERE deleted_at IS NOT NULL;
`;
