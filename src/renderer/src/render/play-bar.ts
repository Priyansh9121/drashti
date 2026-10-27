import { formatDuration } from '../../../shared/format';
import { type PlaybackClock, playbackBounds, playbackPosition } from '../../../shared/media';

/*
 * A video's play bar on the screens (Session 54, render/PlayBar.tsx): what it draws at a moment, from the engine's
 * state and time alone (shared/media.ts playbackPosition, as the video itself plays), never from the video element,
 * so every screen, node and key and fill draws the same bar at the same moment (§40).
 */

/** What a video's play bar draws at a moment. */
export interface PlayBarFrame {
  /** How far along the part between its start and end points it is, 0 to 1. */
  fraction: number;
  /** Its time since its start point, of that part's length: "0:12 / 1:15". */
  text: string;
  /** Playing on (the mark is a pause mark, as a deck's video shows), or paused or held at its end (a play mark). */
  playing: boolean;
}

/** The play bar of a video playing as `clock` says, its file `duration` seconds long, at `now` (the engine's time). */
export function playBarAt(clock: PlaybackClock, duration: number, now: number): PlayBarFrame | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const { start, end } = playbackBounds(clock.clip, duration);
  const span = end - start;
  const into = Math.max(0, playbackPosition(clock, duration, now) - start);
  const ended = !clock.loop && into >= span - 0.01;
  return {
    fraction: span > 0 ? Math.min(1, into / span) : 0,
    text: `${formatDuration(into * 1000)} / ${formatDuration(span * 1000)}`,
    playing: clock.seek?.paused !== true && !ended,
  };
}
