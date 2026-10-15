/**
 * Migration 42: the drop folder (Session 28, decision 21). Pictures and videos put in one folder an admin
 * chooses are imported by themselves; the library only ever gains from it. `media.dropped_at` says when a
 * media item was taken from the drop folder (Media's "From the drop folder" filter); `drop_files` remembers
 * each file seen there, by its folder and name with its size and time, so a file is taken once (again only
 * when it changes), and what was not taken, and why, can be listed.
 */
export const up = `
ALTER TABLE media ADD COLUMN dropped_at TEXT;

CREATE TABLE drop_files (
  folder TEXT NOT NULL,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('taken', 'not-taken', 'failed')),
  media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  reason TEXT,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (folder, name)
);
`;
