import type { TextElement, TextStyle } from './model';

/*
 * A deck's own shrink of a box's words, as PowerPoint saved it (`normAutofit`; style.sourceFit, kept by the deck
 * reader since Session 58's PF-4a), drawn from (PF-4b). PowerPoint shrinks a box's words that run past it in two ways
 * at once: it takes `lnSpcReduction` off every line spacing given as a share of a line (90% less 10% is 80%), and
 * draws the words at `fontScale` of their size. The screens draw the line spacing as PowerPoint did, and Drashti's
 * own fit starts its search at PowerPoint's scale (render/shrink-to-fit.ts); its own measure still decides, so the
 * words never run past the box. A line spacing fixed in points is left as it is, as are boxes without the numbers.
 */

/**
 * PowerPoint's single line spacing as the deck reader draws it: a 100% spacing is this multiple of the words' size
 * (main/import/deck/editable-pptx.ts's DEFAULT_LINE_HEIGHT), so taking 10% off a line is taking 0.12 off it.
 */
export const SOURCE_SINGLE_LINE = 1.2;

/** The least line spacing a cut leaves, as the deck reader's least multiple. */
const LEAST_LINE = 0.1;

/** How much the source's own shrink takes off a box's line spacing multiples (0 for none). */
export function sourceLineCut(_style: Pick<TextStyle, 'sourceFit'>): number {
  // Red (PF-4b): the failing tests first.
  return 0;
}

/** A line spacing multiple with that cut taken off (to four places), never below the least. */
export function cutLineHeight(lineHeight: number, cut: number): number {
  if (cut <= 0) return lineHeight;
  return Math.max(LEAST_LINE, Math.round((lineHeight - cut) * 10_000) / 10_000);
}

/**
 * The box without the source's shrink, once its line spacing is set in Drashti: the spacing chosen replaces
 * PowerPoint's, as PowerPoint itself works its shrink out again when a box's spacing changes.
 */
export function withoutSourceFit(el: TextElement): TextElement {
  // Red (PF-4b): the failing tests first.
  return el;
}
