/*
 * Whether this page draws the show without a graphics chip (Session 58, C2): Chromium composites in software (CI's
 * two-core Windows VMs, a PC whose graphics driver is blocked), as Main reads it for the warm-up
 * (main/outputs/warm-up-choice.ts) and tells each page that draws the show (an output's context, the stream page's).
 * Until a page is told, with a chip, as the warm-up assumes.
 *
 * A deck's own Wipe draws PowerPoint's band the way that holds the frames in each (transition-frame.ts): with a chip,
 * a mask on the slide moved every frame (drawn again each frame, which a chip does cheaply: CI's Mac); without one, a
 * mask that never changes on boxes the compositor moves (nothing drawn again: CI's two-core Windows while streaming).
 */

let without = false;

/** Whether this page draws the show without a graphics chip, as it was last told. */
export const drawsWithoutChip = (): boolean => without;

/** What the page was told: true without a graphics chip; false with one (or not told). */
export function setDrawsWithoutChip(on: boolean): void {
  without = on;
}
