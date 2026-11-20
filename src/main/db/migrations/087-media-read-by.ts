/**
 * Migration 87 (alpha.20, x47, "Plays anything", the owner's Q60-34 item 2): whether the bundled FFmpeg has read each
 * video and sound. NULL: never, so its file's own header judged it (a library from before Session 50, a computer that
 * had no FFmpeg then); 'ffmpeg': read, and what FFmpeg read decided, as at an import; 'nothing': FFmpeg found nothing it
 * could read in it (a damaged file) or took too long, so its header's judgement stands. The idle sweep
 * (convert/reread.ts) reads each NULL one once, when the show is idle.
 */
export const up = `
ALTER TABLE media ADD COLUMN read_by TEXT CHECK (read_by IS NULL OR read_by IN ('ffmpeg', 'nothing'));
`;
