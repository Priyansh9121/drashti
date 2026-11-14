import type { TextElement, TextStyle } from './model';

/*
 * A deck's own shrink of a box's words, as PowerPoint saved it (`normAutofit`; style.sourceFit, kept by the deck
 * reader since Session 58's PF-4a), drawn from (PF-4b). PowerPoint shrinks a box's words that run past it in two ways
 * at once: it takes `lnSpcReduction` off every line spacing given as a share of a line (90% less 10% is 80%), and
 * draws the words at `fontScale` of their size, rounded to a whole point (its own movie of shrunk boxes, h-pptx3's
 * run 4, 14 Nov 2026: 24 pt at 85% is drawn 20 pt, 32 pt at 70% 22; it never fits a box again on opening). The
 * screens draw both as PowerPoint did (Q58-42): the words at PowerPoint's own size wherever they fit at it by
 * Drashti's own measure, else the largest fit below it at which they do (render/shrink-to-fit.ts), so they never run
 * past the box. A line spacing fixed in points is left as it is, as are boxes without the numbers, and a box whose
 * words or spacing are changed in Drashti drops the numbers and keeps Drashti's own fit (FT-5).
 */

/**
 * PowerPoint's single line spacing as the deck reader draws it: a 100% spacing is this multiple of the words' size
 * (main/import/deck/editable-pptx.ts's DEFAULT_LINE_HEIGHT), so taking 10% off a line is taking 0.12 off it.
 */
export const SOURCE_SINGLE_LINE = 1.2;

/** The least line spacing a cut leaves, as the deck reader's least multiple. */
const LEAST_LINE = 0.1;

/** Points a slide pixel: the deck reader's pixel is 9,525 EMU, a point 12,700. */
const POINTS_A_PIXEL = 0.75;

/** The size (slide pixels) of most of a box's words: the run with the most of them, or the box's own. */
function mainSize(el: TextElement): number {
  let best = el.style.fontSize;
  let most = -1;
  for (const run of el.runs ?? []) {
    const count = run.text.replace(/\s/gu, '').length;
    if (count > most) {
      most = count;
      best = run.size ?? el.style.fontSize;
    }
  }
  return best;
}

/**
 * PowerPoint's own fit of a box's words under its saved shrink, as a fit of their size: the size of most of its words
 * times fontScale, rounded to a whole point (and never above 1). Undefined for a box without PowerPoint's shrink.
 */
export function sourceFitScale(el: TextElement): number | undefined {
  const fit = el.style.sourceFit;
  if (!fit) return undefined;
  const points = mainSize(el) * POINTS_A_PIXEL;
  if (!(points > 0)) return fit.fontScale;
  const shrunk = Math.round(points * fit.fontScale);
  return shrunk > 0 ? Math.min(1, shrunk / points) : fit.fontScale;
}

/**
 * A run's own size under PowerPoint's shrink, as a share of the box's fit (sourceFitScale): PowerPoint rounds EACH run's
 * size to a whole point on its own (its PDF and movie of shrunk boxes with two sizes, h-pptx3's run 5, 14 Nov 2026: 40
 * and 18 pt at 62.5% are drawn 25 and 11 pt, 36 and 24 at 70% 25 and 17, 32 and 20 at 77.5% 25 and 16), so a run not of
 * the box's main size is drawn this much larger or smaller than the box's fit alone makes it (Q58-50). 1 for the main
 * size, a box without PowerPoint's numbers, or one Drashti does not fit.
 */
export function sourceRunScale(el: TextElement, size: number | undefined): number {
  const fit = el.style.sourceFit;
  if (!fit || el.style.shrinkToFit !== true) return 1;
  const box = sourceFitScale(el);
  const points = (size ?? el.style.fontSize) * POINTS_A_PIXEL;
  if (box === undefined || !(box > 0) || !(points > 0)) return 1;
  const shrunk = Math.round(points * fit.fontScale);
  return shrunk > 0 ? Math.min(1, shrunk / points) / box : 1;
}

/** How much the source's own shrink takes off a box's line spacing multiples (0 for none). */
export function sourceLineCut(style: Pick<TextStyle, 'sourceFit'>): number {
  const reduction = style.sourceFit?.lineSpacingReduction ?? 0;
  return reduction > 0 ? SOURCE_SINGLE_LINE * reduction : 0;
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
  if (!el.style.sourceFit) return el;
  const { sourceFit: _fit, ...style } = el.style;
  return { ...el, style };
}
