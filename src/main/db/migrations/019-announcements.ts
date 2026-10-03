/**
 * Migration 19: announcements from phones (Session 10).
 *
 * Each is kept with what happened to it: waiting for the operator, showing
 * (until a time), ended, or rejected. The words as sent are kept beside the
 * words as shown (the operator may edit them). The device's name is copied,
 * so the record outlives the device being removed. No address or token is
 * kept.
 */
export const up = `
CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 200),
  sent_text TEXT NOT NULL CHECK (length(sent_text) BETWEEN 1 AND 200),
  from_name TEXT NOT NULL CHECK (length(from_name) BETWEEN 1 AND 60),
  minutes INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 120),
  device_id TEXT REFERENCES network_devices(id) ON DELETE SET NULL,
  device_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'showing', 'ended', 'rejected')),
  shown_as TEXT CHECK (shown_as IS NULL OR shown_as IN ('message', 'ticker')),
  sent_at TEXT NOT NULL,
  decided_at TEXT,
  until TEXT,
  ended_at TEXT
);
CREATE INDEX announcements_by_status ON announcements (status, sent_at);
`;
