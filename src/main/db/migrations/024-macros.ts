/**
 * Migration 24: macros (Session 11).
 *
 * The macros table from migration 1 holds macros made in Drashti: a name,
 * a colour and actions as JSON (src/shared/macros.ts); they get a place in
 * the list. A slide can run one when it goes up (its macro cue); removing
 * the macro removes the cue.
 */
export const up = `
ALTER TABLE macros ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE slides ADD COLUMN macro_id TEXT REFERENCES macros(id) ON DELETE SET NULL;
`;
