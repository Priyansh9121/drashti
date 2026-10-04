/**
 * Migration 28: Samvat and tithi (Session 12).
 *
 * Calendars an admin loads from files (src/shared/calendar.ts): each known
 * by its name (folded, so loading it again updates it), with its days, each
 * day's names kept as JSON. Where two calendars give the same date, the one
 * loaded last is used. Drashti computes no tithi.
 */
export const up = `
CREATE TABLE calendars (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  first_date TEXT NOT NULL,
  last_date TEXT NOT NULL,
  day_count INTEGER NOT NULL CHECK (day_count >= 0),
  source_path TEXT,
  source_hash TEXT,
  loaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE calendar_days (
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  samvat INTEGER NOT NULL,
  names TEXT NOT NULL CHECK (json_valid(names)),
  PRIMARY KEY (calendar_id, date)
);
CREATE INDEX calendar_days_by_date ON calendar_days(date);
`;
