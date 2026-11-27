import type { EngineState } from './state';

/*
 * Black-out and the Wallpaper as Oops and Put it back leave them (alpha.24 bug hunt S2-2; QA24-OOPS-COVERS, the owner's
 * "Restore covers": as they were before the mistake). One rule for the show's engine (main/engine/one-at-a-time.ts,
 * coversBack) and the practice show (shared/practice.ts), so the practice works them as a show does.
 */

/** Black-out and the Wallpaper, each on or off. */
export interface Covers {
  blackout: boolean;
  wallpaper: boolean;
}

/** The covers of a state (the engine's, or the practice show's). */
export const coversOf = (state: Covers): Covers => ({
  blackout: state.blackout,
  wallpaper: state.wallpaper,
});

/** Whether these layers have anything seen on the audience's picture: a slide or a background. */
export function seenIn(layers: EngineState['layers']): boolean {
  return layers.slide !== null || layers.background !== null;
}

/**
 * The covers Oops and Put it back leave, from the covers just `before` and just `after` the change they take back, as
 * they are `now`, and whether what they put back has anything `seen` (a slide or a background). A cover that was on
 * before that change stays on while it still is (a message taken back under Black-out leaves it black), and comes back
 * on when that change took it off (a wrong row's click under Black-out: black again, the slide that was under it under
 * it again). A cover put on since stays on when nothing seen comes back (the oopsfix review's SHOULD-2: a hall cover
 * never comes off with nothing to see), and comes off when something does, so it is seen (Session 56); one the operator
 * took off since stays off. One cover at a time: with both, the one on before the change (Black-out when both were, as
 * an older save with both recovers it). What is put back under a cover is what was under it then, so nothing plays there.
 */
export function coversPutBack(before: Covers, after: Covers, now: Covers, seen: boolean): Covers {
  const on = (cover: keyof Covers) => (before[cover] ? !after[cover] || now[cover] : now[cover] && !seen);
  const blackout = on('blackout');
  const wallpaper = on('wallpaper');
  const both = blackout && wallpaper;
  return {
    blackout: blackout && !(both && !before.blackout),
    wallpaper: wallpaper && !(both && before.blackout),
  };
}
