/**
 * Migration 5: a cheap library list.
 *
 * The list showed each presentation's slide count and kirtan languages by
 * counting and joining on every refresh (about 20 ms at 5,000
 * presentations on a fast Mac, far more on the mandir's). Both are now
 * kept on the presentation when its content is written, and an index gives
 * the list in order.
 */
export const up = `
ALTER TABLE presentations ADD COLUMN slide_count INTEGER NOT NULL DEFAULT 0;
-- Comma-separated language tracks for a kirtan ('' for a kirtan with none); NULL otherwise.
ALTER TABLE presentations ADD COLUMN kirtan_tracks TEXT;
UPDATE presentations SET slide_count = (
  SELECT COUNT(*) FROM slides s JOIN slide_groups g ON g.id = s.group_id
   WHERE g.presentation_id = presentations.id AND s.enabled = 1
);
UPDATE presentations SET kirtan_tracks = COALESCE(
  (SELECT group_concat(t.lang) FROM kirtan_tracks t WHERE t.kirtan_id = presentations.id), ''
) WHERE EXISTS (SELECT 1 FROM kirtans k WHERE k.presentation_id = presentations.id);
CREATE INDEX presentations_listed ON presentations(library_id, name COLLATE NOCASE) WHERE deleted_at IS NULL;
`;
