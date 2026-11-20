/**
 * Migration 89 (alpha.20, x47, slice 6a "Sound and picture…": the owner's Q60-34 and his "Yes, all A" to Q60-39 P2 A
 * and P6 (a) A): a video's or a sound's own playback settings, kept with the file as JSON (shared/playback-settings.ts:
 * Bass, Treble, Voice boost, the sound's and the captions' delay). NULL: none, so it plays as it is, as every file did.
 */
export const up = `
ALTER TABLE media ADD COLUMN playback TEXT CHECK (playback IS NULL OR json_valid(playback));
`;
