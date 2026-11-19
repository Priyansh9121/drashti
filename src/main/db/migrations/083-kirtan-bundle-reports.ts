/** Bundle reports use the existing import report, with every prior row and issue preserved. */
export const up = `
PRAGMA legacy_alter_table = ON;
CREATE TABLE import_items_new (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  source_path TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('text', 'media', 'pp6', 'pp7', 'unknown', 'shastra', 'calendar', 'quotes', 'pictures', 'kirtan-bundle')),
  outcome TEXT NOT NULL CHECK (outcome IN ('imported', 'replaced', 'kept-both', 'skipped', 'conflict', 'failed', 'unsupported')),
  name TEXT,
  target_kind TEXT CHECK (target_kind IS NULL OR target_kind IN ('presentation', 'media', 'playlist', 'shastra', 'calendar', 'quotes')),
  target_id TEXT,
  counts TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(counts)),
  message TEXT
);
INSERT INTO import_items_new (rowid, id, run_id, position, source_path, format, outcome, name, target_kind, target_id, counts, message)
  SELECT rowid, id, run_id, position, source_path, format, outcome, name, target_kind, target_id, counts, message FROM import_items;
DROP TABLE import_items;
ALTER TABLE import_items_new RENAME TO import_items;
CREATE INDEX import_items_by_run ON import_items(run_id, position);
PRAGMA legacy_alter_table = OFF;
`;
