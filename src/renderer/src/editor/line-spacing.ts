import { isIndic, type TextElement } from '../../../shared/model';
import { INDIC_LINE_HEIGHT_MIN } from '../../../shared/readable';
import { type BoxLine, boxLines } from '../../../shared/tracks';

/*
 * A text box's line spacing as the Words group shows it and the inspector warns of it (Session 58, PF-14): as its
 * lines are drawn (render/SlideView.tsx's paragraphLineStyle). A deck's paragraph can set its own, a fixed spacing in
 * slide pixels (lineHeightPx, PowerPoint's spacing in points) or a multiple of its words' size, over the box's; until
 * then Words showed the box's and the Gujarati and Hindi warning read only the box's. Each is said as a multiple of
 * its line's words' size, as the box's own is.
 */

/** Two places, as the spacing is set (a fixed spacing's multiple is rarely round). */
const twoPlaces = (n: number) => Math.round(n * 100) / 100;

/** The spacing a line's words are drawn at, as a multiple of their size. */
function drawnSpacing(el: TextElement, line: BoxLine): number {
  const first = line.runs[0];
  const paragraph = first?.paragraph;
  if (paragraph?.lineHeightPx !== undefined)
    return paragraph.lineHeightPx / (first?.size ?? el.style.fontSize);
  return paragraph?.lineHeight ?? el.style.lineHeight;
}

/** The spacing the Words group shows for a box: its first line of words', as drawn. */
export function shownLineSpacing(el: TextElement): number {
  const line = boxLines(el).find((l) => l.runs.length > 0);
  return twoPlaces(line ? drawnSpacing(el, line) : el.style.lineHeight);
}

/**
 * The closest spacing of a box's Gujarati or Hindi lines as drawn (every line of a Gujarati or Hindi box), when below
 * 1.3: their marks can touch the line above. Null when none is.
 */
export function crowdedIndicSpacing(el: TextElement): number | null {
  const lines = boxLines(el);
  const indic = isIndic(el.lang) ? lines : lines.filter((l) => isIndic(l.lang ?? el.lang));
  if (indic.length === 0) return null;
  const worded = indic.filter((l) => l.runs.length > 0);
  // A box with no words yet is set at the box's own spacing.
  const closest = Math.min(
    ...(worded.length > 0 ? worded.map((l) => drawnSpacing(el, l)) : [el.style.lineHeight]),
  );
  return closest < INDIC_LINE_HEIGHT_MIN - 0.0001 ? twoPlaces(closest) : null;
}
