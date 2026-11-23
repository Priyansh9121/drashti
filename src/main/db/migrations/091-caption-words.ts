/**
 * Migration 91: caption words (alpha.22). The admin's names and terms a speaker says, spelt as live captions should
 * show them, per language, in the admin's order: the captions engine is given the first ones as hints, and a word
 * heard close to one is spelt as written. Settings, so kept with the library (and its backups); never a word heard.
 */
export const up = `
CREATE TABLE caption_words (
  language TEXT NOT NULL CHECK (language IN ('gu', 'hi', 'sa', 'en')),
  position INTEGER NOT NULL CHECK (position >= 0),
  word TEXT NOT NULL CHECK (length(word) BETWEEN 1 AND 40),
  PRIMARY KEY (language, position)
);
`;
