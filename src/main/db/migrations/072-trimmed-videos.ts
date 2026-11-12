/** A trimmed video keeps its source and its cut in the source's time. */
export const up = `
CREATE TABLE trimmed_videos (
  media_id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  original_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
  end_ms INTEGER NOT NULL CHECK (end_ms > start_ms),
  source_markers TEXT NOT NULL CHECK (json_valid(source_markers)),
  CHECK (media_id <> original_id)
);
CREATE INDEX trimmed_videos_by_original ON trimmed_videos(original_id);

-- Reset suppresses the old media bounds in the reset row. New bounds take effect if edited later.
CREATE TABLE playlist_trim_resets (
  item_id TEXT PRIMARY KEY REFERENCES playlist_items(id) ON DELETE CASCADE,
  original_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  start_ms INTEGER,
  end_ms INTEGER,
  CHECK (start_ms IS NOT NULL OR end_ms IS NOT NULL)
);
CREATE INDEX playlist_trim_resets_by_original ON playlist_trim_resets(original_id);
CREATE TRIGGER playlist_trim_reset_after_marker_edit AFTER UPDATE OF markers ON media
WHEN json_extract(OLD.markers, '$.startMs') IS NOT json_extract(NEW.markers, '$.startMs')
  OR json_extract(OLD.markers, '$.endMs') IS NOT json_extract(NEW.markers, '$.endMs')
BEGIN
  DELETE FROM playlist_trim_resets WHERE original_id = NEW.id;
END;
`;
