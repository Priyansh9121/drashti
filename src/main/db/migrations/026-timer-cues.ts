/**
 * Migration 26: timers in sabha templates (Session 12).
 *
 * A playlist item can start, reset or show timers when it goes up
 * (shared/playlists.ts TimerCue), kept as JSON; templates keep them, and a
 * playlist made from a template gets them.
 */
export const up = `
ALTER TABLE playlist_items ADD COLUMN timers TEXT CHECK (timers IS NULL OR json_valid(timers));
`;
