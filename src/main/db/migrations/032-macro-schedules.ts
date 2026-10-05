/**
 * Migration 32: macros that run by themselves at set times (Session 14).
 *
 * Each macro keeps its times as JSON (src/shared/macros.ts MacroSchedule:
 * days of the week and a time, or one date, and whether it is on), checked
 * when saved and again when read.
 */
export const up = `
ALTER TABLE macros ADD COLUMN schedules TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(schedules));
`;
