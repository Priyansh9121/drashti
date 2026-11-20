/**
 * Migration 87 (alpha.20, x47: resume where it stopped, last played and play counts; the owner's Q60-34 item 3 and his
 * "Yes, all A" to Q60-39): how many times each file has gone up and when it last did, and, for a video or sound of 10
 * minutes or more taken off before its end, where (ms into it) and when. Written by main/media/play-history.ts as the
 * show goes, never in its way (db/later-writes.ts).
 */
export const up = `
ALTER TABLE media ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0 CHECK (play_count >= 0);
ALTER TABLE media ADD COLUMN last_played_at TEXT;
ALTER TABLE media ADD COLUMN resume_ms INTEGER CHECK (resume_ms IS NULL OR resume_ms >= 0);
ALTER TABLE media ADD COLUMN resume_at TEXT;
`;
