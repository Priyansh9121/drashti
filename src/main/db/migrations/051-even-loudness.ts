/**
 * Migration 51: even loudness (Session 55, Part 7; shared/sound.ts, main/sound/). `media.loudness` is what FFmpeg's
 * EBU R128 meter read in a video's or sound's bytes, as JSON: `{"sha": the sha256 of the bytes read, "lufs":
 * integrated loudness or null (no sound), "peak": true peak (dBTP) or null}`, or `{"sha": …, "failed": true}` when
 * the file could not be read; NULL before it is measured. Bytes that change (a file found again, its copy) are
 * measured again, as their sha differs. `media.even_loudness` is the file's own switch: 1 (the default) plays it at
 * the even level, 0 as it is. An older library gains both columns as nothing measured and every file on, so it opens
 * and plays as before until each file is measured; nothing else changes.
 */
export const up = `
ALTER TABLE media ADD COLUMN loudness TEXT CHECK (loudness IS NULL OR json_valid(loudness));
ALTER TABLE media ADD COLUMN even_loudness INTEGER NOT NULL DEFAULT 1 CHECK (even_loudness IN (0, 1));
`;
