/**
 * Migration 13: finding kirtans by their details (Session 8).
 *
 * The search index gets a third column, a kirtan's details (kavi, raag,
 * category and occasions), so typing a kavi's or raag's name finds their
 * kirtans. The index is filled by the app: it is rebuilt at the next start
 * (SEARCH_VERSION 3), and the trigger keeps working on the new table.
 */
export const up = `
DROP TABLE search_fts;
CREATE VIRTUAL TABLE search_fts USING fts5(title, body, details, tokenize = 'ascii', prefix = '2 3');
DELETE FROM app_meta WHERE key = 'search.version';
`;
