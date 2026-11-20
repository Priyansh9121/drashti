/*
 * Resume where it stopped, last played and play counts (alpha.20: the owner's Q60-34 item 3 and "last played", his
 * "Yes, all A" to Q60-39: P1 A, P6 (e) A and (j) A): what the main process keeps of each file's plays
 * (main/media/play-history.ts), and its words for the window (markers/ResumeOffers.tsx, Media, Media information).
 */

/** A video or sound this long or longer keeps where it was taken off (ms): a talk, a katha. */
export const RESUME_FROM_MS = 10 * 60_000;

/** Taken off within this of its end point, it was played to its end, and nothing is kept (ms). */
export const RESUME_END_MS = 30_000;

/** For how long after it goes up "Resume at …" is offered (ms). */
export const RESUME_OFFER_MS = 30_000;

/** Where a file was taken off before its end (ms into it), and when (ISO-8601). */
export interface ResumePoint {
  atMs: number;
  at: string;
}

/* Red (x47, slice 3): the words, still to be written. */
export const resumeWords = (_atMs: number): string => '';
export const dayWords = (_iso: string, _short = false, _locale?: string): string | null => null;
export const playedWords = (_count: number, _lastPlayedAt: string | null, _locale?: string): string => '';
