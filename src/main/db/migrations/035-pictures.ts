/**
 * Migration 35: PDF, PowerPoint and Keynote as pictures (Session 15).
 *
 * Such a file becomes a presentation of pictures: its import report lines
 * say 'pictures', and so does where the presentation came from, so importing
 * the same file again is known. Both CHECKs are widened by building the two
 * tables again (SQLite cannot change a CHECK in place), keeping every row,
 * rowid and index as it was. The pictures themselves are media Drashti made
 * ('drashti'), so the media table is unchanged.
 *
 * The kirtans' triggers name the presentations table: renaming the new
 * table checks them, and they would name a table that is gone at that
 * moment. Renaming the old way (legacy_alter_table) leaves them as they are,
 * naming the new table once it has the old name.
 */
export const up = `
PRAGMA legacy_alter_table = ON;

CREATE TABLE import_items_new (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  source_path TEXT NOT NULL,
  format TEXT NOT NULL
    CHECK (format IN ('text', 'media', 'pp6', 'pp7', 'unknown', 'shastra', 'calendar', 'quotes', 'pictures')),
  outcome TEXT NOT NULL
    CHECK (outcome IN ('imported', 'replaced', 'kept-both', 'skipped', 'conflict', 'failed', 'unsupported')),
  name TEXT,
  target_kind TEXT CHECK (target_kind IS NULL OR target_kind IN ('presentation', 'media', 'playlist', 'shastra', 'calendar', 'quotes')),
  target_id TEXT,
  counts TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(counts)),
  message TEXT
);
INSERT INTO import_items_new (rowid, id, run_id, position, source_path, format, outcome, name, target_kind, target_id, counts, message)
  SELECT rowid, id, run_id, position, source_path, format, outcome, name, target_kind, target_id, counts, message
  FROM import_items;
DROP TABLE import_items;
ALTER TABLE import_items_new RENAME TO import_items;
CREATE INDEX import_items_by_run ON import_items(run_id, position);

CREATE TABLE presentations_new (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 1920 CHECK (width BETWEEN 16 AND 16384),
  height INTEGER NOT NULL DEFAULT 1080 CHECK (height BETWEEN 16 AND 16384),
  theme_id TEXT REFERENCES themes(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  source_kind TEXT CHECK (source_kind IS NULL OR source_kind IN ('pp6', 'pp7', 'text', 'docx', 'media', 'drashti', 'pictures')),
  source_path TEXT,
  source_ref TEXT,
  source_imported_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  source_hash TEXT,
  deleted_at TEXT,
  slide_count INTEGER NOT NULL DEFAULT 0,
  kirtan_tracks TEXT,
  selected_arrangement_id TEXT REFERENCES arrangements(id) ON DELETE SET NULL,
  transition TEXT CHECK (transition IS NULL OR json_valid(transition)),
  loop INTEGER NOT NULL DEFAULT 0 CHECK (loop IN (0, 1)),
  kirtan TEXT CHECK (kirtan IS NULL OR json_valid(kirtan))
);
INSERT INTO presentations_new (rowid, id, library_id, name, width, height, theme_id, notes, source_kind, source_path,
    source_ref, source_imported_at, created_at, updated_at, source_hash, deleted_at, slide_count, kirtan_tracks,
    selected_arrangement_id, transition, loop, kirtan)
  SELECT rowid, id, library_id, name, width, height, theme_id, notes, source_kind, source_path,
    source_ref, source_imported_at, created_at, updated_at, source_hash, deleted_at, slide_count, kirtan_tracks,
    selected_arrangement_id, transition, loop, kirtan
  FROM presentations;
DROP TABLE presentations;
ALTER TABLE presentations_new RENAME TO presentations;
CREATE INDEX presentations_by_library ON presentations(library_id, name);
CREATE INDEX presentations_by_source ON presentations(source_kind, source_path);
CREATE INDEX presentations_by_source_ref ON presentations(source_kind, source_ref);
CREATE INDEX presentations_by_source_hash ON presentations(source_kind, source_hash);
CREATE INDEX presentations_removed ON presentations(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX presentations_listed ON presentations(library_id, name COLLATE NOCASE) WHERE deleted_at IS NULL;

PRAGMA legacy_alter_table = OFF;
`;
