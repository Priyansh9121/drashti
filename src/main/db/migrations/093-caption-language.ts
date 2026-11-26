/**
 * Migration 93 (alpha.24, QA24-CAPLANG-2): "Captions in", the language live captions are shown in on the audience
 * screens and the stream: the speaker's own words ('same', every library before alpha.24) or a translation into
 * Gujarati, Hindi or English (shared/caption-translation.ts).
 */
export const up = `
ALTER TABLE caption_settings ADD COLUMN caption_language TEXT NOT NULL DEFAULT 'same'
  CHECK (caption_language IN ('same', 'gu', 'hi', 'en'));
`;
