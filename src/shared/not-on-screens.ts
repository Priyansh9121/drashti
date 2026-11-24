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

/** A showing still up that a screen could not play: its file, when it went up, its name, and the screens in words. */
export interface NotOnScreen {
  mediaId: string;
  startedAt: number;
  name: string;
  /** The screens that said so, in words: "the screen “…”", or "the screens “…” and “…”". */
  where: string;
}

/** How many LIVE keeps, at most: the newest. */
export const NOT_ON_SCREENS_MAX = 20;

/** Whether that showing of a video (its file, when it went up) is still up: the background, on the slide or in the box. */
export function stillUp(state: EngineState | null | undefined, mediaId: string, startedAt: number): boolean {
  return playingNow(state).some(
    (p) =>
      p.ref.layer !== 'audio' && p.sound !== true && p.mediaId === mediaId && p.clock.startedAt === startedAt,
  );
}

/** Those of `list` still up in `state`, oldest first. */
export function notOnScreensNow(
  list: readonly NotOnScreen[],
  state: EngineState | null | undefined,
): NotOnScreen[] {
  return list.filter((e) => stillUp(state, e.mediaId, e.startedAt));
}

/** What LIVE says under its picture for one (in the words of the notice that named it). */
export const notOnScreenLine = (e: NotOnScreen): string =>
  `Not on ${e.where}: “${e.name}” could not play there.`;
