/**
 * Migration 23: key and fill outputs (Session 11).
 *
 * A screen group can be a key and fill pair for a video switcher (its role
 * 'keyfill', allowed since migration 20). Each of its screens is the fill
 * (the picture, black where empty) or the key (white wherever the fill has
 * something, by its opacity). Other groups' screens have no feed.
 */
export const up = `
ALTER TABLE screens ADD COLUMN feed TEXT CHECK (feed IS NULL OR feed IN ('fill', 'key'));
`;
