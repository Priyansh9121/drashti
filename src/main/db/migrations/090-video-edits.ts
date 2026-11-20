/** Edit Video…: desired recipes and immutable prepared revisions. Originals and existing trim/tone records stay put. */
export const up = `
ALTER TABLE media ADD COLUMN video_edit TEXT CHECK (video_edit IS NULL OR json_valid(video_edit));
ALTER TABLE media ADD COLUMN video_edit_revision INTEGER NOT NULL DEFAULT 0 CHECK (video_edit_revision >= 0);
ALTER TABLE media ADD COLUMN video_edit_ready_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE media ADD COLUMN video_edit_copy_id TEXT REFERENCES media(id);
ALTER TABLE media ADD COLUMN video_edit_error TEXT;
CREATE TABLE video_edit_copies (
  source_id TEXT NOT NULL REFERENCES media(id),
  revision INTEGER NOT NULL,
  copy_id TEXT NOT NULL UNIQUE REFERENCES media(id),
  PRIMARY KEY (source_id, revision)
);
`;
