/**
 * Migration 18: the local network's paired devices (Session 10).
 *
 * Each device has a kind (what it may do) and the SHA-256 of its token: the
 * token itself is shown to the device once, when it pairs, and kept nowhere
 * else, so neither the library nor a backup holds anything a device could be
 * impersonated with. Removing a device cuts it off at once. The
 * announcements poster link is a device too (poster = 1), one at a time.
 */
export const up = `
CREATE TABLE network_devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  kind TEXT NOT NULL CHECK (kind IN ('remote', 'stage', 'announcements')),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  poster INTEGER NOT NULL DEFAULT 0 CHECK (poster IN (0, 1)),
  paired_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT
);
`;
