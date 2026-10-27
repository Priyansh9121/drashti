/**
 * Migration 52: files between Drashti and its phones (Session 54, D3 and D4; shared/phone-files.ts).
 * `playlists.shared_at` says when a playlist was shared with phones and tablets (Remote devices list it under
 * "Shared from Drashti"), NULL when it is not; `media.from_device` and `presentations.from_device` name the
 * device a file came from when a phone added it ("Add from this Phone…": a picture, video or sound is media, a
 * PDF, PowerPoint or Keynote file a presentation), NULL for everything else. Columns added, nothing rebuilt:
 * every row, and an alpha.12 library or backup, comes through as it was.
 */
export const up = `
ALTER TABLE playlists ADD COLUMN shared_at TEXT;
ALTER TABLE media ADD COLUMN from_device TEXT;
ALTER TABLE presentations ADD COLUMN from_device TEXT;
`;
