/**
 * Migration 2: imports (PLAN.md 4.4).
 *
 * - presentations.source_hash: sha256 of the file a presentation came from,
 *   so re-importing an unchanged file is skipped and a changed one is noticed.
 * - media.missing: a media item a presentation uses but whose file was not
 *   found yet (path is '' until the operator relinks it). The same bytes are
 *   stored once: sha256 is unique.
 * - import_runs, import_items, import_issues: every import and its report.
 */
const now = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

export const up = `
ALTER TABLE presentations ADD COLUMN source_hash TEXT;
CREATE INDEX presentations_by_source_ref ON presentations(source_kind, source_ref);
CREATE INDEX presentations_by_source_hash ON presentations(source_kind, source_hash);

ALTER TABLE media ADD COLUMN missing INTEGER NOT NULL DEFAULT 0 CHECK (missing IN (0, 1));
CREATE UNIQUE INDEX media_by_sha256 ON media(sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX media_missing ON media(missing) WHERE missing = 1;

CREATE TABLE import_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed', 'cancelled')),
  paths TEXT NOT NULL CHECK (json_valid(paths)),
  options TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(options)),
  totals TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(totals)),
  message TEXT,
  started_at TEXT NOT NULL DEFAULT ${now},
  finished_at TEXT
);
CREATE INDEX import_runs_by_start ON import_runs(started_at);

CREATE TABLE import_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  source_path TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('text', 'media', 'pp6', 'pp7', 'unknown')),
  outcome TEXT NOT NULL CHECK (outcome IN ('imported', 'replaced', 'kept-both', 'skipped', 'conflict', 'failed', 'unsupported')),
  name TEXT,
  target_kind TEXT CHECK (target_kind IS NULL OR target_kind IN ('presentation', 'media', 'playlist')),
  target_id TEXT,
  counts TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(counts)),
  message TEXT
);
CREATE INDEX import_items_by_run ON import_items(run_id, position);

CREATE TABLE import_issues (
  id INTEGER PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES import_items(id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  fix TEXT CHECK (fix IS NULL OR json_valid(fix))
);
CREATE INDEX import_issues_by_item ON import_issues(item_id);
`;
