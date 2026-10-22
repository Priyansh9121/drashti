/**
 * Migration 46: a timer on a slide (Session 50, shared/model.ts TimerElement). An element's kind may be 'timer'
 * too: the elements table is built again with its CHECK widened (SQLite cannot change a CHECK in place),
 * keeping every row, rowid and index as it was. No table refers to an element and no trigger names the table.
 * An older Drashti never meets a timer: it refuses a library written by a newer one.
 */
export const up = `
CREATE TABLE elements_new (
  id TEXT PRIMARY KEY,
  slide_id TEXT NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'shape', 'image', 'video', 'timer')),
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL CHECK (width >= 0),
  height REAL NOT NULL CHECK (height >= 0),
  rotation REAL NOT NULL DEFAULT 0,
  props TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(props))
);
INSERT INTO elements_new (rowid, id, slide_id, position, kind, x, y, width, height, rotation, props)
  SELECT rowid, id, slide_id, position, kind, x, y, width, height, rotation, props FROM elements;
DROP TABLE elements;
ALTER TABLE elements_new RENAME TO elements;
CREATE INDEX elements_by_slide ON elements(slide_id, position);
`;
