/**
 * Migration 9: searching the library.
 *
 * search_docs holds, per presentation, its searchable lines as written
 * (to show where a search matched) and how many runs of its text are in
 * legacy fonts (not searchable yet). search_fts is the full-text index of
 * its title and text, folded by the app (src/shared/search.ts): the ascii
 * tokenizer then only splits at spaces and ASCII punctuation, so Gujarati
 * and Devanagari words stay whole. The index is filled by the app, and
 * rebuilt when its version changes.
 */
export const up = `
CREATE TABLE search_docs (
  id INTEGER PRIMARY KEY,
  presentation_id TEXT NOT NULL UNIQUE REFERENCES presentations(id) ON DELETE CASCADE,
  lines TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(lines)),
  legacy_runs INTEGER NOT NULL DEFAULT 0
);
-- Counting presentations with legacy text must not read every row.
CREATE INDEX search_docs_legacy ON search_docs(presentation_id) WHERE legacy_runs > 0;
CREATE VIRTUAL TABLE search_fts USING fts5(title, body, tokenize = 'ascii', prefix = '2 3');
CREATE TRIGGER search_docs_gone AFTER DELETE ON search_docs BEGIN
  DELETE FROM search_fts WHERE rowid = old.id;
END;
`;
