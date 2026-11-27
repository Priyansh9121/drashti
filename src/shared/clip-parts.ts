import { parseVideoEditTime, videoEditTime } from './video-edit';

/*
 * Parts of one video joined into one exported clip (alpha.24; the owner, 27 Nov 2026: "one video can be cut in 2
 * parts and merged, for example a 30 minute video, i want from 0 to 10 and 20 to 30 but in 1 video"). In Edit
 * Video's Trim, part 1 is Start and End; "Add a part" adds more. Export clip… joins them, in time order, with a cut
 * at each join, from the original picture and sound. The parts are an export's only: Save keeps Start and End.
 */

/** One part of a video, in the original video's time. */
export interface ClipPart {
  startMs: number;
  endMs: number;
}
/** The most parts one export joins. */
export const CLIP_PARTS_MOST = 10;

/** What to type in a trim time field. */
export const TRIM_TIME_WORDS = 'Type seconds, such as 600, or a time, such as 10:00 or 1:20:00.';
/** Saved edits cover Start and End only, so joined parts come from the original. */
export const JOINED_PARTS_ORIGINAL =
  'Joined parts use the original picture and sound. Choose Original under Picture and sound.';

/** Seconds as the number fields took them: digits with a point (".5", "5." too) and an exponent ("1e3"). */
const SECONDS = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/u;

/**
 * A time typed in a trim field, in ms: seconds read exactly as the number fields read them (Math.round of seconds ×
 * 1000: "0.350" is 350), or a clock time as Go to time takes it ("10:00", "1:20:00", "0:03.500"); null when it is not
 * a time (empty, words, a negative or a broken clock time).
 */
export function parseTrimTime(text: string): number | null {
  const typed = text.trim();
  if (typed.includes(':')) return parseVideoEditTime(typed);
  if (!SECONDS.test(typed)) return null;
  const ms = Math.round(Number(typed) * 1000);
  return Number.isFinite(ms) ? ms : null;
}

/** A time as the trim fields show it: seconds, as the number fields showed them ("2", "0.35"). */
export const trimSeconds = (ms: number): string => String(ms / 1000);

/** A part as typed: either time null when its field holds no time. */
export interface TypedPart {
  startMs: number | null;
  endMs: number | null;
}
export type CheckedParts = { ok: true; parts: ClipPart[] } | { ok: false; message: string };

/**
 * The parts as one export joins them, in time order; or why not, in plain words, naming each part by its number as
 * shown (part 1 is Start and End). Nothing is ever changed to fit: an empty part, one past the video's end or an
 * overlap is refused. Parts that only touch (one ends where the next starts) are fine.
 */
export function checkClipParts(typed: readonly TypedPart[], durationMs: number | null): CheckedParts {
  if (typed.length > CLIP_PARTS_MOST)
    return {
      ok: false,
      message: `An export joins at most ${String(CLIP_PARTS_MOST)} parts. Remove a part, then export again.`,
    };
  const numbered: (ClipPart & { n: number })[] = [];
  for (const [at, part] of typed.entries()) {
    const n = at + 1;
    if (part.startMs === null || part.endMs === null)
      return {
        ok: false,
        message: `Part ${String(n)}: type its start and end as seconds, such as 600, or as a time, such as 10:00.`,
      };
    if (part.endMs <= part.startMs)
      return {
        ok: false,
        message: `Part ${String(n)} ends at or before its start. Give it an end after its start.`,
      };
    if (part.startMs < 0 || (durationMs !== null && part.endMs > durationMs))
      return {
        ok: false,
        message: `Part ${String(n)} goes past the end of the video (${videoEditTime(durationMs ?? 0)}). Choose an end inside it.`,
      };
    numbered.push({ startMs: part.startMs, endMs: part.endMs, n });
  }
  numbered.sort((a, b) => a.startMs - b.startMs || a.n - b.n);
  for (const [at, part] of numbered.entries()) {
    const before = numbered[at - 1];
    if (before && part.startMs < before.endMs) {
      const [low, high] = [before.n, part.n].sort((a, b) => a - b);
      return {
        ok: false,
        message: `Parts ${String(low)} and ${String(high)} overlap. Make each part end before the next one starts.`,
      };
    }
  }
  return { ok: true, parts: numbered.map(({ startMs, endMs }) => ({ startMs, endMs })) };
}

/** Whether parts are in time order, each with an end after its start and none overlapping the next. */
export function clipPartsInOrder(parts: readonly ClipPart[]): boolean {
  return parts.every(
    (part, at) => part.endMs > part.startMs && (at === 0 || part.startMs >= (parts[at - 1]?.endMs ?? 0)),
  );
}

/** How long the joined clip is: the parts added up. */
export const clipPartsLength = (parts: readonly ClipPart[]): number =>
  parts.reduce((all, part) => all + part.endMs - part.startMs, 0);

/** What a joined export holds, in time order, and how long it is, in the operator's words. */
export function clipPartsSummary(parts: readonly ClipPart[]): string {
  const list = parts
    .map((part) => `${videoEditTime(part.startMs)} to ${videoEditTime(part.endMs)}`)
    .join(', then ');
  return `Export clip… joins ${String(parts.length)} parts, in time order: ${list}. The new video is ${videoEditTime(clipPartsLength(parts))} long.`;
}
