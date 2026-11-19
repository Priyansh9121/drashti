/**
 * A screen's geometry (x27): its zoom and move, its corners pinned, its part of one wide picture and the ramps over its
 * overlaps, as JSON (shared/screen-geometry.ts); NULL for nothing set, as every screen has until it is adjusted.
 */
export const up = `
ALTER TABLE screens ADD COLUMN geometry TEXT;
`;
