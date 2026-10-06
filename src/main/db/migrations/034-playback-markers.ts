/**
 * Migration 34: playback markers (Session 14).
 *
 * A video or a sound keeps its start and end points and its named markers
 * as JSON (src/shared/markers.ts), with the file: every use of it plays the
 * same part. Null: none.
 */
export const up = `
ALTER TABLE media ADD COLUMN markers TEXT CHECK (markers IS NULL OR json_valid(markers));
`;
