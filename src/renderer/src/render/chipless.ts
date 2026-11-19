/*
 * Whether this page draws the show without a graphics chip (Session 58, C2): Chromium composites in software (CI's
 * two-core Windows VMs, a PC whose graphics driver is blocked), as Main reads it for the warm-up
 * (main/outputs/warm-up-choice.ts) and tells each page that draws the show (an output's context, the stream page's).
 * Until a page is told, with a chip, as the warm-up assumes.
 *
 * Without one (X11), while it runs alone, a deck's own Push, Cover and Uncover move each slide they move as a layer of
 * its own in whole device pixels, Cover's and Uncover's shade inside it; its own Wipe draws PowerPoint's band as with a
 * chip (a mask on the slide's box, new each frame), the outgoing slide a still layer of its own meanwhile
 * (render/SlideLayerView.tsx): what held the frames best on CI's two-core Windows while streaming.
 */

let without = false;

/** Whether this page draws the show without a graphics chip, as it was last told. */
export const drawsWithoutChip = (): boolean => without;

/** What the page was told: true without a graphics chip; false with one (or not told). */
export function setDrawsWithoutChip(on: boolean): void {
  without = on;
}
