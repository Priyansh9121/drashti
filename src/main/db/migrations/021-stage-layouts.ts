/**
 * Migration 21: stage layouts (Session 11).
 *
 * The stage_layouts table from migration 1 holds the layouts made in
 * Drashti: boxes on a 1920 x 1080 canvas and a background, as JSON
 * (src/shared/stage-layouts.ts). They get a place in the list. The Standard
 * stage screen is built in and is not a row.
 */
export const up = `
ALTER TABLE stage_layouts ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
`;
