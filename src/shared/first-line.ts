/*
 * X20 (h-run6, Session 59): where PowerPoint puts a box's first line, and its last, as its own PDF of real-PowerPoint
 * run 6 shows it (19 Nov 2026: four boxes a slide, 18, 28, 40 and 66 pt, two lines each, in Arial, Calibri, Times New
 * Roman, Verdana and Drashti's bundled Noto Sans, Noto Sans Gujarati and Noto Sans Devanagari; single spacing, 80-200%,
 * exactly 1.0, 1.2 and 1.5 times the size and PowerPoint's own shrinks; boxes anchored at the top, the middle and the
 * bottom). 361 of its 364 top boxes within a point of this rule, the other three 1.1-1.9 pt (a line set exactly to a
 * single line's height at 18 and 28 pt, where PowerPoint's own grid of 0.24 pt rounds them); every box at 40 and 66 pt
 * within 0.52 pt.
 *
 * PowerPoint's single line is 1.2 times the words' size (C17), split above and below the baseline as the font's own
 * heights are (its hhea ascent and descent, the same as OS/2's typo heights where the font says to use them): above,
 * 1.2 x ascent / (ascent + descent) of the size. Under another line spacing (a share of that line, or points):
 * - a line no taller than single keeps its part below the baseline and loses the rest above it, yet never puts the
 *   baseline higher than three quarters of the line (less any shortfall of the font's part above below 0.9 of the size);
 * - a taller line puts the baseline at three quarters of the line (less that shortfall), but no lower than a font with
 *   a short part above (Noto Sans Gujarati's 0.82) would sit with all the line's extra above it, up to 0.3 of the size.
 * The last line keeps the single line's part below the baseline, whatever the spacing, so a box anchored at the bottom
 * ends its words there, and one anchored at the middle centres them between that and its first line's top.
 * CSS lays each line out with half its leading above the font's own heights; a deck box's words are moved by the
 * difference (render/SlideView.tsx, editor/TextBoxEditor.tsx), so nothing else moves: the lines' gaps (C17), the words'
 * sizes and the box's fit stay as they are.
 */

/** A font's own heights above and below its baseline, as shares of its size. */
export interface FontHeights {
  ascent: number;
  descent: number;
}

/** A line of a box: its words' font and size, and its height (the same units, px or points). */
export interface LineLook {
  font: FontHeights;
  size: number;
  line: number;
}

/** PowerPoint's single line (1.2 times the size) above and below the baseline, as shares of the size. */
function singleShares(font: FontHeights): { above: number; below: number } {
  const total = font.ascent + font.descent;
  const above = total > 0 ? (1.2 * font.ascent) / total : 0.96;
  return { above, below: 1.2 - above };
}

/** PowerPoint's first baseline below a box's words' top, for words `size` high on a line `line` high. */
export function powerPointFirstBaseline(font: FontHeights, size: number, line: number): number {
  const { above, below } = singleShares(font);
  const short = Math.max(0, 0.9 - above);
  const reach = short > 0 ? 0.3 : 0;
  return Math.max(0.75 * line - short * size, Math.min(line - below * size, (above + reach) * size));
}

/** PowerPoint's last line's part below its baseline: the single line's, whatever the line spacing. */
export function powerPointLastBelow(font: FontHeights, size: number): number {
  return singleShares(font).below * size;
}

/** Where CSS puts a line's baseline below the line's top: half its leading above the font's own heights. */
export function cssFirstBaseline(font: FontHeights, size: number, line: number): number {
  return line / 2 + ((font.ascent - font.descent) * size) / 2;
}

/**
 * How far a deck box's words move down from where CSS lays them out (px, or whatever units the lines are given in; up
 * when negative), so that its first line sits where PowerPoint puts it: anchored at the top, its first line; at the
 * bottom, its last line; at the middle, halfway between the two (PowerPoint centres from its first line's top to its last
 * line's part below the baseline).
 */
export function deckFirstLineShift(
  anchor: 'top' | 'middle' | 'bottom',
  first: LineLook,
  last: LineLook,
): number {
  const top =
    powerPointFirstBaseline(first.font, first.size, first.line) -
    cssFirstBaseline(first.font, first.size, first.line);
  if (anchor === 'top') return top;
  const bottom =
    last.line - powerPointLastBelow(last.font, last.size) - cssFirstBaseline(last.font, last.size, last.line);
  return anchor === 'bottom' ? bottom : (top + bottom) / 2;
}
