/**
 * Migration 6: media Drashti's windows cannot play.
 *
 * Found at import from the file's own bytes (src/main/import/probe.ts):
 * playable is 1 (plays), 0 (cannot play: ProRes, AVI, HEIC and the like,
 * until conversion arrives in Phase 2) or NULL (not known: imported before,
 * or not sure). format says what the file is, for people.
 */
export const up = `
ALTER TABLE media ADD COLUMN playable INTEGER CHECK (playable IS NULL OR playable IN (0, 1));
ALTER TABLE media ADD COLUMN format TEXT;
CREATE INDEX media_unplayable ON media(playable) WHERE playable = 0;
`;
