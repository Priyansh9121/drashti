import { playingNow } from './engine/playing';
import type { EngineState } from './engine/state';

/*
 * A video still up that one of this computer's screens could not play (alpha.23, a22-halldrop): a video on the slide or
 * in the picture-in-picture box that was not playing when the screen said so (paused, waiting for its click, or held at
 * its end), which Main has nothing to take off for (main/media/cannot-play.ts heardOutcome), or one on the slide that it
 * paused there. Until then Main said nothing and logged nothing for the first, while LIVE showed the video and the
 * screen did not. Now the operator is told, the log has it, and LIVE says under its picture which screens could not
 * play it, or are still loading it (Q60-51), until each draws it after all, or the showing goes (main's HallWords). What
 * the screens show is not changed.
 */

/** A showing still up that a screen could not play: its file, when it went up, and what LIVE says of it. */
export interface NotOnScreen {
  mediaId: string;
  startedAt: number;
  /** LIVE's lines under its picture for it (notOnScreenLine, notOnScreenYetLine). */
  lines: string[];
  /** LIVE's line while screens wait for its first frame (the owner's QA23-HALLDROP-1 (a): startingLine). */
  starting?: string;
}

/** How many showings Main keeps, at most: the newest. */
export const NOT_ON_SCREENS_MAX = 20;

/** The showings of videos up now (the background, on the slide, in the box), each as `file@when it went up`. */
function upNow(state: EngineState | null | undefined): Set<string> {
  return new Set(
    playingNow(state)
      .filter((p) => p.ref.layer !== 'audio' && p.sound !== true)
      .map((p) => `${p.mediaId}@${String(p.clock.startedAt)}`),
  );
}

/** Whether that showing of a video (its file, when it went up) is still up: the background, on the slide or in the box. */
export function stillUp(state: EngineState | null | undefined, mediaId: string, startedAt: number): boolean {
  return upNow(state).has(`${mediaId}@${String(startedAt)}`);
}

/** Those of `list` still up in `state`, oldest first. */
export function notOnScreensNow(
  list: readonly NotOnScreen[],
  state: EngineState | null | undefined,
): NotOnScreen[] {
  if (list.length === 0) return [];
  const up = upNow(state);
  return list.filter((e) => up.has(`${e.mediaId}@${String(e.startedAt)}`));
}

/** What LIVE says for the screens that could not play it (`where`: "the screen “…”", "the screens “…” and “…”"). */
export const notOnScreenLine = (name: string, where: string): string =>
  `Not on ${where}: “${name}” could not play there.`;

/** What LIVE says for the screens still loading it (Q60-51: slow is not "cannot play"). */
export const notOnScreenYetLine = (name: string, where: string): string =>
  `Not on ${where} yet: “${name}” is still loading there.`;

/** What LIVE says while screens wait for a video's first frame (the owner's QA23-HALLDROP-1 (a)). */
export const startingLine = (where: string): string => `Starting on ${where}…`;

/**
 * The showings of videos on the slide or in the box that play now in `state` (not paused, not waiting for their click),
 * each as `file@when it went up`: what Play on one the hall said it could not play is followed by the take-off for.
 */
export function playingCannotNow(state: EngineState | null | undefined): Set<string> {
  return new Set(
    playingNow(state)
      .filter((p) => ((p.ref.layer === 'slide' && p.sound !== true) || p.ref.layer === 'pip') && !p.paused)
      .map((p) => `${p.mediaId}@${String(p.clock.startedAt)}`),
  );
}
