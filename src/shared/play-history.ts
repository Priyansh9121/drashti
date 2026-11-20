import { formatDuration } from './format';

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

/** The offer's words: "Resume at 6:00", "Resume at 1:02:10". */
export const resumeWords = (atMs: number): string => `Resume at ${formatDuration(atMs)}`;

/** A day as this computer writes it, long ("20 Nov 2026") or short ("20 Nov"); null for a time that is no time. */
export function dayWords(iso: string, short = false, locale?: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(short ? {} : { year: 'numeric' }),
  }).format(at);
}

/** A file's plays for people: "Not yet", "Once, last on 20 Nov 2026", "12 times, last on 20 Nov 2026". */
export function playedWords(count: number, lastPlayedAt: string | null, locale?: string): string {
  if (count <= 0) return 'Not yet';
  const day = lastPlayedAt ? dayWords(lastPlayedAt, false, locale) : null;
  const times = count === 1 ? 'Once' : `${String(count)} times`;
  return day ? `${times}, last on ${day}` : times;
}
