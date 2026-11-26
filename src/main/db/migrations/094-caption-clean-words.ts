/**
 * Migration 94: words left out of captions (alpha.24, QA24-CAPCLEAN-1). The admin's own words, per language and in
 * the admin's order, that live captions and translated captions never show (besides Drashti's own list, which ships
 * with the app as hashes and is never in the library). Settings, so kept with the library (and its backups).
 * Number 093 is a24-captrans's (caption_settings.caption_language).
 */
export const up = `
CREATE TABLE caption_clean_words (
  language TEXT NOT NULL CHECK (language IN ('gu', 'hi', 'sa', 'en')),
  position INTEGER NOT NULL CHECK (position >= 0),
  word TEXT NOT NULL CHECK (length(word) BETWEEN 1 AND 40),
  PRIMARY KEY (language, position)
);
`;
