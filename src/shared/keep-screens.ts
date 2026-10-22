/*
 * Keep these screens? (Session 50): after any change that puts an output on a display, Drashti asks for 15 s, with
 * Keep and Go back, and goes back by itself to exactly the screens as they were when nothing is pressed.
 */

/** How long the question waits before going back by itself. */
export const KEEP_SCREENS_MS = 15_000;

/** A change waiting for Keep or Go back. */
export interface PendingScreens {
  /** When it goes back by itself (ms since the epoch, main-process clock). */
  deadline: number;
  /** The change put an output on the display the controls are on: that output asks too, large, in its middle. */
  coversControls: boolean;
}
