/**
 * Migration 29: the idle rotation's quotes (Session 12).
 *
 * The admin's list of quotes (src/shared/idle.ts): words per language as
 * JSON and an attribution, in the admin's order. The rotation's pictures
 * and timing are a setting (`idleRotation`); which groups show it is in each
 * Look. Drashti ships no quotes.
 */
export const up = `
CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  words TEXT NOT NULL CHECK (json_valid(words)),
  attribution TEXT NOT NULL DEFAULT '' CHECK (length(attribution) <= 120),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;
