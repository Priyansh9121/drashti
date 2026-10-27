/*
 * What a stage screen keeps under a deck's slide coming in (Session 54, C review). The hall's screens and LIVE keep the
 * slide before up until a new slide's coming-in clip can be drawn (SlideLayerView); a stage screen draws a deck's step
 * on its own, so it keeps the still that showed before (the slide before's step's last frame) under the new slide's
 * first step until its clip has a frame: never a moment of nothing between them.
 */

/** The still a stage's deck box shows, and the one that showed before the slide up came. */
export interface StageStill {
  /** The slide up, by its id and when it went up. */
  key: string;
  /** The still of the step it shows now. */
  still: string | null;
  /** The still that showed before it came: under its first step's clip. */
  before: string | null;
}

/** What the box keeps as the slide up is `key` showing `still`: a new slide keeps the still before it under it. */
export function stageStill(was: StageStill | null, key: string, still: string | null): StageStill {
  if (!was) return { key, still, before: null };
  if (was.key === key) return was.still === still ? was : { ...was, still };
  return { key, still, before: was.still };
}
