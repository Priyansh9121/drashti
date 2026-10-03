/**
 * Migration 17: converting media Drashti cannot play (Session 9).
 *
 * A converted file is a media item of its own (converted_from names the
 * original, which is never changed or deleted). A conversion keeps which
 * rows it moved from the original to the converted file, so Undo can put
 * back exactly those (and none that were changed by hand since).
 */
export const up = `
ALTER TABLE media ADD COLUMN converted_from TEXT REFERENCES media(id) ON DELETE SET NULL;
CREATE INDEX media_converted_from ON media(converted_from) WHERE converted_from IS NOT NULL;
CREATE TABLE media_conversions (
  id TEXT PRIMARY KEY,
  original_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  converted_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  moved TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(moved)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  undone_at TEXT
);
CREATE INDEX media_conversions_original ON media_conversions(original_id);
`;
