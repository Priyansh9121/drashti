/**
 * Migration 7: arrangements set the order.
 *
 * A presentation keeps the arrangement it plays in when nothing says
 * otherwise (its source file's selection, or the operator's). Arrangements
 * keep their order and their id in the source file, so a playlist item that
 * names one (both ProPresenter versions store it) can be matched. A
 * playlist item plays its presentation's own order, a given arrangement,
 * or every slide.
 */
export const up = `
ALTER TABLE arrangements ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE arrangements ADD COLUMN source_ref TEXT;
CREATE INDEX arrangements_by_presentation ON arrangements(presentation_id, position);
ALTER TABLE presentations ADD COLUMN selected_arrangement_id TEXT REFERENCES arrangements(id) ON DELETE SET NULL;
ALTER TABLE playlist_items ADD COLUMN order_mode TEXT NOT NULL DEFAULT 'presentation'
  CHECK (order_mode IN ('presentation', 'arrangement', 'all'));
`;
