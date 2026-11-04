/**
 * Migration 66: live captions (Session 55, Part 10).
 *
 * One row of settings: the language listened for ('auto', or Gujarati, Hindi or English alone), whether the
 * audience screens show the captions too (the stream and the stage always do), and their size and place. Whether
 * captions are on at all belongs to the computer (drashti-captions.json in the data folder), not the library. The
 * library never keeps a word heard. 062–065 are Part 17b's; 067 stays Part 10's, unused.
 */
export const up = `
CREATE TABLE caption_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  language TEXT NOT NULL DEFAULT 'auto' CHECK (language IN ('auto', 'gu', 'hi', 'en')),
  audience INTEGER NOT NULL DEFAULT 0 CHECK (audience IN (0, 1)),
  size TEXT NOT NULL DEFAULT 'medium' CHECK (size IN ('small', 'medium', 'large')),
  place TEXT NOT NULL DEFAULT 'bottom' CHECK (place IN ('bottom', 'top'))
);
INSERT INTO caption_settings (id) VALUES (1);
`;
