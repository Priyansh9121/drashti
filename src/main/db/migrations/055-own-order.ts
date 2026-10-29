/**
 * Migration 55: a playlist item's own order of its presentation's slides (Session 55, Part 4b; shared/playlists.ts
 * ItemOrder 'slides'): a slide's row dragged within its deck in a playlist, or out of it into an item of its own.
 * `own_order` is JSON, { slideIds, known? } (db/playlists.ts), kept with the item: the library's presentation never
 * changes. NULL, as every item made before has it, for an item playing the presentation's own order, every slide or an
 * arrangement (order_mode and arrangement_id, as before). An older library gains the column empty: every item plays
 * as it did.
 */
export const up = `
ALTER TABLE playlist_items ADD COLUMN own_order TEXT CHECK (own_order IS NULL OR json_valid(own_order));
`;
