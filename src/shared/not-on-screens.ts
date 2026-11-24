import { playingNow } from './engine/playing';
import type { EngineState } from './engine/state';

/*
 * A video still up that one of this computer's screens could not play (alpha.23, a22-halldrop): a video on the slide or
 * in the picture-in-picture box that was not playing when the screen said so (paused, waiting for its click, or held at
 * its end), which Main has nothing to take off for (main/media/cannot-play.ts heardOutcome), or one on the slide that it
 * paused there. Until then Main said nothing and logged nothing for the first, while LIVE showed the video and the
 * screen did not. Now the operator is told, the log has it, and LIVE says under its picture which screens could not
 * play it, for as long as that showing stays up. What the screens show is not changed.
 */

/** A showing still up that a screen could not play: its file, when it went up, and what LIVE says of it. */
export interface NotOnScreen {
  mediaId: string;
  startedAt: number;
  /** LIVE's lines under its picture for it (notOnScreenLine, notOnScreenYetLine). */
  lines: string[];
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
