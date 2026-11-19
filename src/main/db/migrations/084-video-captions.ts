/** Parsed video captions are library data; the source file is never needed by a show. */
export const up = `
ALTER TABLE media ADD COLUMN caption_choice TEXT;
CREATE TABLE video_caption_tracks (
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  language TEXT NOT NULL,
  automatic INTEGER NOT NULL CHECK (automatic IN (0, 1)),
  name TEXT NOT NULL,
  cues TEXT NOT NULL CHECK (json_valid(cues)),
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (media_id, id)
);
`;
