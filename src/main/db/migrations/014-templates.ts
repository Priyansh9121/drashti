/**
 * Migration 14: sabha templates (Session 8).
 *
 * A template is a playlist kept apart from the week's playlists, so it is
 * never run by mistake: a running order to make playlists from. Its slots
 * are placeholder items (as the importer leaves for what it cannot find),
 * which can now name a category: filling one starts the search there.
 */
export const up = `
ALTER TABLE playlists ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0 CHECK (is_template IN (0, 1));
ALTER TABLE playlist_items ADD COLUMN category TEXT;
`;
