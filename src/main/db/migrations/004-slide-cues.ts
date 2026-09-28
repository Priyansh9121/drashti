/**
 * Migration 4: slide cues, and playlists that can be re-imported.
 *
 * Slide cues: what happens when a slide goes live besides its own picture.
 * A 'background' cue puts an image or video on the background layer (PLAN.md
 * 4.3: it stays up on later slides until replaced or cleared, and Clear
 * background leaves the text). Others play audio, start a video, clear a
 * layer, show a message, start a timer... Imported now so nothing is lost;
 * the show engine will act on them later. media_id points at the media
 * library when the cue uses a file; props hold the rest (fit, loop...).
 *
 * Playlists: source_hash, as presentations have.
 */
export const up = `
CREATE TABLE slide_cues (
  id TEXT PRIMARY KEY,
  slide_id TEXT NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('background', 'audio', 'media', 'clear', 'message', 'timer', 'other')),
  label TEXT NOT NULL DEFAULT '',
  media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  props TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(props))
);
CREATE INDEX slide_cues_by_slide ON slide_cues(slide_id, position);
CREATE INDEX slide_cues_by_media ON slide_cues(media_id) WHERE media_id IS NOT NULL;

-- sha256 of the playlist file a playlist came from (re-importing an unchanged file is skipped).
ALTER TABLE playlists ADD COLUMN source_hash TEXT;
CREATE INDEX playlists_by_source ON playlists(source_kind, source_path);
`;
