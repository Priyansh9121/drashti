/**
 * Migration 45: Lower Thirds (Session 44, shared/lower-thirds.ts), in Macros' place. Each is up to three lines
 * (JSON, an array of strings), its look (JSON), where it shows (the hall's screens, the stream or both) and its
 * animation's id, in a list's order. Deleting one only marks it (`deleted_at`), so Undo can bring it back;
 * marked ones go for good when Drashti next starts. The macros' tables (migrations 24 and 32) stay as they were.
 */
export const up = `
CREATE TABLE lower_thirds (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  lines TEXT NOT NULL CHECK (json_valid(lines)),
  look TEXT NOT NULL CHECK (json_valid(look)),
  target TEXT NOT NULL CHECK (target IN ('hall', 'stream', 'both')),
  animation TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
`;
