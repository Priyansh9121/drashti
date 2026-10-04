/**
 * Migration 27: the arti at its time (Session 12).
 *
 * An admin's arti schedules (src/shared/arti.ts): days of the week (JSON) or
 * one date, a time, the presentation that is the arti, how long before to
 * prompt, and whether it goes up by itself. Removing the presentation for
 * good leaves the schedule, saying its presentation is gone.
 */
export const up = `
CREATE TABLE arti_schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  presentation_id TEXT REFERENCES presentations(id) ON DELETE SET NULL,
  days TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(days)),
  date TEXT CHECK (date IS NULL OR date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  time TEXT NOT NULL CHECK (time GLOB '[0-2][0-9]:[0-5][0-9]'),
  prompt_minutes INTEGER NOT NULL DEFAULT 5 CHECK (prompt_minutes BETWEEN 0 AND 60),
  by_itself INTEGER NOT NULL DEFAULT 0 CHECK (by_itself IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX arti_schedules_presentation ON arti_schedules(presentation_id);
`;
