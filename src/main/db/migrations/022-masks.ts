/**
 * Migration 22: the mask library (Session 11).
 *
 * A mask is shapes on a canvas of its own size that hide what is under them,
 * or show only what is inside them (src/shared/masks.ts), as JSON. A Look
 * can give a screen group one as its screens' own shape; the operator puts
 * one up on the Masks layer.
 */
const now = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

export const up = `
CREATE TABLE masks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  definition TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(definition)),
  position INTEGER NOT NULL DEFAULT 0,
  source_kind TEXT CHECK (source_kind IS NULL OR source_kind IN ('pp6', 'pp7', 'text', 'docx', 'media', 'drashti')),
  source_path TEXT,
  source_ref TEXT,
  source_imported_at TEXT,
  created_at TEXT NOT NULL DEFAULT ${now},
  updated_at TEXT NOT NULL DEFAULT ${now}
);
`;
