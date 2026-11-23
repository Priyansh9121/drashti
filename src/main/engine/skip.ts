import { type PlaybackClock, playbackAtMs, playbackSpanMs } from '../../shared/media';

/*
 * Back 15 s and Forward 15 s (Session 50, seen on the mandir's audio controls; Last 10 s went in alpha.21, the
 * owner's "remove last 10s whole concept"): where each takes
 * the background video or the sound playing, never past the file's start or end points. The engine makes the
 * jump as it makes a jump to a marker (show-engine.ts, skip), so it lands in step everywhere.
 */

/** How far Back 15 s and Forward 15 s go (ms). */
export const SKIP_MS = 15_000;
export type SkipJump = 'back' | 'forward';

/**
 * Where a skip from `atMs` goes (ms into the file), between the start and end points: Back within the first
 * 15 s goes to the start; Forward within the last 15 s goes to the end. `atEnd`: it goes to the end, which does
 * what an end does.
 */
export function skipTarget(
  jump: SkipJump,
  atMs: number,
  span: { start: number; end: number },
): { toMs: number; atEnd: boolean } {
  const { start, end } = span;
  if (jump === 'back') return { toMs: Math.max(start, atMs - SKIP_MS), atEnd: false };
  const toMs = Math.min(end, atMs + SKIP_MS);
  return { toMs, atEnd: toMs >= end };
}

/**
 * Where a skip takes a file playing (or a paused track) at `now`, from where it is (`atMs`; `startMs`, its
 * start point); null while its length is not known (learned as a window starts playing it): without it there
 * is no end to keep to, nor a place in a loop.
 */
export function skipFrom(
  playing: PlaybackClock & { durationMs?: number; pausedAtMs?: number },
  jump: SkipJump,
  now: number,
): { atMs: number; startMs: number; toMs: number; atEnd: boolean } | null {
  if (playing.durationMs === undefined) return null;
  const span = playbackSpanMs(playing.clip, playing.durationMs);
  const atMs = playbackAtMs(playing, playing.durationMs, now);
  return { atMs, startMs: span.start, ...skipTarget(jump, atMs, span) };
}
