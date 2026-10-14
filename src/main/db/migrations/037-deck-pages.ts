/**
 * Migration 37: a deck's pages out of the Media list (Session 26a).
 *
 * A PDF, PowerPoint or Keynote file becomes a presentation of pictures, one
 * media row per page that Drashti drew (Session 15). Those rows filled the
 * library's Media list, page after page. A media row is now `listed` only
 * when it was imported as media: a picture, video or sound dropped in on its
 * own, or one a presentation from another program uses. A deck's pages are
 * found by what they came from ('drashti', a "#page=" in the path), and stay
 * listed when the same picture was also imported on its own (the rows are
 * shared by sha256, so its import report names the same row).
 */
export const up = `
ALTER TABLE media ADD COLUMN listed INTEGER NOT NULL DEFAULT 1 CHECK (listed IN (0, 1));
UPDATE media SET listed = 0
 WHERE source_kind = 'drashti' AND source_path LIKE '%#page=%'
   AND id NOT IN (SELECT target_id FROM import_items
                   WHERE target_kind = 'media' AND format = 'media' AND target_id IS NOT NULL);
`;
