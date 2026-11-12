export const up = `
ALTER TABLE playlist_trim_resets ADD COLUMN sound_start_ms INTEGER;
ALTER TABLE playlist_trim_resets ADD COLUMN sound_end_ms INTEGER;

DROP TRIGGER playlist_trim_reset_after_marker_edit;
CREATE TRIGGER playlist_trim_reset_after_marker_edit AFTER UPDATE OF markers ON media
WHEN json_extract(OLD.markers, '$.startMs') IS NOT json_extract(NEW.markers, '$.startMs')
  OR json_extract(OLD.markers, '$.endMs') IS NOT json_extract(NEW.markers, '$.endMs')
BEGIN
  -- Keep the reset only while applying or undoing the matching sound trim.
  DELETE FROM playlist_trim_resets
   WHERE original_id = NEW.id AND (
     sound_start_ms IS NULL OR NOT (
       (json_extract(OLD.markers, '$.startMs') IS start_ms
        AND json_extract(OLD.markers, '$.endMs') IS end_ms
        AND json_extract(NEW.markers, '$.startMs') IS sound_start_ms
        AND json_extract(NEW.markers, '$.endMs') IS sound_end_ms)
       OR
       (json_extract(OLD.markers, '$.startMs') IS sound_start_ms
        AND json_extract(OLD.markers, '$.endMs') IS sound_end_ms
        AND json_extract(NEW.markers, '$.startMs') IS start_ms
        AND json_extract(NEW.markers, '$.endMs') IS end_ms)
     )
   );

  -- Returning to the old bounds consumes the sound trim exception.
  UPDATE playlist_trim_resets SET sound_start_ms = NULL, sound_end_ms = NULL
   WHERE original_id = NEW.id
     AND json_extract(NEW.markers, '$.startMs') IS start_ms
     AND json_extract(NEW.markers, '$.endMs') IS end_ms;
END;
`;
