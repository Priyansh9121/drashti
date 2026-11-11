/** Migration 69 adds Sanskrit to the existing caption language choices. */
export const up = `
CREATE TABLE caption_settings_069 (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  language TEXT NOT NULL DEFAULT 'auto' CHECK (language IN ('auto', 'gu', 'hi', 'sa', 'en')),
  audience INTEGER NOT NULL DEFAULT 0 CHECK (audience IN (0, 1)),
  size TEXT NOT NULL DEFAULT 'medium' CHECK (size IN ('small', 'medium', 'large')),
  place TEXT NOT NULL DEFAULT 'bottom' CHECK (place IN ('bottom', 'top'))
);
INSERT INTO caption_settings_069 (id, language, audience, size, place)
SELECT id, language, audience, size, place FROM caption_settings;
DROP TABLE caption_settings;
ALTER TABLE caption_settings_069 RENAME TO caption_settings;
`;
