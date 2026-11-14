import { isIndic, type TextElement } from '../../../shared/model';
import { INDIC_LINE_HEIGHT_MIN } from '../../../shared/readable';
import { boxLines } from '../../../shared/tracks';

/*
 * A text box's line spacing as the Words group shows it and the inspector warns of it (Session 58, PF-14). Red: the
 * box's own spacing only, as before.
 */

/** The spacing the Words group shows for a box. */
export function shownLineSpacing(el: TextElement): number {
  return el.style.lineHeight;
}

/** The closest spacing of a box's Gujarati or Hindi lines, when below 1.3 (their marks can touch the line above). */
export function crowdedIndicSpacing(el: TextElement): number | null {
  const indic = isIndic(el.lang) || boxLines(el).some((l) => isIndic(l.lang ?? el.lang));
  return indic && el.style.lineHeight < INDIC_LINE_HEIGHT_MIN - 0.0001 ? el.style.lineHeight : null;
}
