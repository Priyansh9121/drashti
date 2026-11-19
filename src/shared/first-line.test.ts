import { describe, expect, it } from 'vitest';
import {
  cssFirstBaseline,
  deckFirstLineShift,
  type FontHeights,
  powerPointFirstBaseline,
  powerPointLastBelow,
} from './first-line';

/*
 * X20 (h-run6, Session 59): where PowerPoint puts a box's first line, from its own PDF of real-PowerPoint run 6 (19 Nov
 * 2026: four boxes a slide, 18, 28, 40 and 66 pt, two lines each, in Arial, Calibri, Times New Roman, Verdana and
 * Drashti's bundled Noto Sans and Noto Sans Gujarati, under single spacing, 80-200%, exactly 1.0, 1.2 and 1.5 times the
 * size and three of PowerPoint's own shrinks). Its baselines fall on a 0.24 pt grid; the 40 and 66 pt boxes are below.
 */

/** Each font's heights above and below its baseline, shares of its size (its hhea; OS/2's typo heights are the same
 * where the font says to use them). */
const FONTS: Record<string, FontHeights> = {
  Arial: { ascent: 0.9053, descent: 0.2119 },
  Calibri: { ascent: 0.9521, descent: 0.2686 },
  'Times New Roman': { ascent: 0.8911, descent: 0.2163 },
  Verdana: { ascent: 1.0054, descent: 0.21 },
  'Noto Sans': { ascent: 1.069, descent: 0.293 },
  'Noto Sans Gujarati': { ascent: 0.896, descent: 0.408 },
};
const fontOf = (name: string): FontHeights => {
  const font = FONTS[name];
  if (!font) throw new Error(name);
  return font;
};

/** A line: a share of a single line (1.2 times the size; spcPct, less any shrink's cut) or so many points (spcPts). */
type Line = { share: number } | { points: number };
const lineOf = (size: number, line: Line) => ('share' in line ? 1.2 * size * line.share : line.points);

/** PowerPoint's own PDF of run 6: each box's first baseline below its words' top (points), by font, the size it drew
 * the words at, and its line. */
const POWERPOINT_FIRST_BASELINES: readonly (readonly [
  font: string,
  size: number,
  line: Line,
  first: number,
])[] = [
  ['Arial', 40, { share: 1 }, 38.88],
  ['Arial', 66, { share: 1 }, 64.08],
  ['Arial', 40, { share: 0.8 }, 29.04],
  ['Arial', 66, { share: 0.8 }, 48],
  ['Arial', 40, { share: 0.9 }, 34.08],
  ['Arial', 66, { share: 0.9 }, 55.92],
  ['Arial', 40, { share: 1.2 }, 42.96],
  ['Arial', 66, { share: 1.2 }, 71.04],
  ['Arial', 40, { share: 1.5 }, 54],
  ['Arial', 66, { share: 1.5 }, 89.04],
  ['Arial', 40, { share: 2 }, 72],
  ['Arial', 66, { share: 2 }, 119.04],
  ['Arial', 40, { points: 40 }, 30.96],
  ['Arial', 66, { points: 66 }, 50.88],
  ['Arial', 40, { points: 48 }, 38.88],
  ['Arial', 66, { points: 79.2 }, 64.08],
  ['Arial', 40, { points: 60 }, 44.88],
  ['Arial', 66, { points: 99 }, 73.92],
  ['Arial', 25, { share: 0.8 }, 18],
  ['Arial', 41, { share: 0.8 }, 30],
  ['Arial', 31, { share: 0.9 }, 25.92],
  ['Arial', 51, { share: 0.9 }, 42.96],
  ['Arial', 36, { share: 1 }, 35.04],
  ['Arial', 59, { share: 1 }, 56.88],
  ['Calibri', 40, { share: 1 }, 36.96],
  ['Calibri', 66, { share: 1 }, 61.92],
  ['Calibri', 40, { share: 0.8 }, 29.04],
  ['Calibri', 66, { share: 0.8 }, 48],
  ['Calibri', 40, { share: 0.9 }, 32.88],
  ['Calibri', 66, { share: 0.9 }, 54],
  ['Calibri', 40, { share: 1.2 }, 42.96],
  ['Calibri', 66, { share: 1.2 }, 71.04],
  ['Calibri', 40, { share: 1.5 }, 54],
  ['Calibri', 66, { share: 1.5 }, 89.04],
  ['Calibri', 40, { share: 2 }, 72],
  ['Calibri', 66, { share: 2 }, 119.04],
  ['Calibri', 40, { points: 40 }, 30],
  ['Calibri', 66, { points: 66 }, 49.92],
  ['Calibri', 40, { points: 48 }, 36.96],
  ['Calibri', 66, { points: 79.2 }, 61.92],
  ['Calibri', 40, { points: 60 }, 44.88],
  ['Calibri', 66, { points: 99 }, 73.92],
  ['Calibri', 25, { share: 0.8 }, 18],
  ['Calibri', 41, { share: 0.8 }, 30],
  ['Calibri', 31, { share: 0.9 }, 24.96],
  ['Calibri', 51, { share: 0.9 }, 42],
  ['Calibri', 36, { share: 1 }, 34.08],
  ['Calibri', 59, { share: 1 }, 54.96],
  ['Times New Roman', 40, { share: 1 }, 38.88],
  ['Times New Roman', 66, { share: 1 }, 64.08],
  ['Times New Roman', 40, { share: 0.8 }, 29.04],
  ['Times New Roman', 66, { share: 0.8 }, 48],
  ['Times New Roman', 40, { share: 0.9 }, 34.08],
  ['Times New Roman', 66, { share: 0.9 }, 55.92],
  ['Times New Roman', 40, { share: 1.2 }, 42.96],
  ['Times New Roman', 66, { share: 1.2 }, 71.04],
  ['Times New Roman', 40, { share: 1.5 }, 54],
  ['Times New Roman', 66, { share: 1.5 }, 89.04],
  ['Times New Roman', 40, { share: 2 }, 72],
  ['Times New Roman', 66, { share: 2 }, 119.04],
  ['Times New Roman', 40, { points: 40 }, 30.96],
  ['Times New Roman', 66, { points: 66 }, 50.88],
  ['Times New Roman', 40, { points: 48 }, 38.88],
  ['Times New Roman', 66, { points: 79.2 }, 64.08],
  ['Times New Roman', 40, { points: 60 }, 44.88],
  ['Times New Roman', 66, { points: 99 }, 73.92],
  ['Times New Roman', 25, { share: 0.8 }, 18],
  ['Times New Roman', 41, { share: 0.8 }, 30],
  ['Times New Roman', 31, { share: 0.9 }, 25.92],
  ['Times New Roman', 51, { share: 0.9 }, 42.96],
  ['Times New Roman', 36, { share: 1 }, 35.04],
  ['Times New Roman', 59, { share: 1 }, 56.88],
  ['Verdana', 40, { share: 1 }, 40.08],
  ['Verdana', 66, { share: 1 }, 66],
  ['Verdana', 40, { share: 0.8 }, 30],
  ['Verdana', 66, { share: 0.8 }, 49.92],
  ['Verdana', 40, { share: 0.9 }, 35.04],
  ['Verdana', 66, { share: 0.9 }, 58.08],
  ['Verdana', 40, { share: 1.2 }, 42.96],
  ['Verdana', 66, { share: 1.2 }, 71.04],
  ['Verdana', 40, { share: 1.5 }, 54],
  ['Verdana', 66, { share: 1.5 }, 89.04],
  ['Verdana', 40, { share: 2 }, 72],
  ['Verdana', 66, { share: 2 }, 119.04],
  ['Verdana', 40, { points: 40 }, 31.92],
  ['Verdana', 66, { points: 66 }, 52.08],
  ['Verdana', 40, { points: 48 }, 40.08],
  ['Verdana', 66, { points: 79.2 }, 65.04],
  ['Verdana', 40, { points: 60 }, 44.88],
  ['Verdana', 66, { points: 99 }, 73.92],
  ['Verdana', 25, { share: 0.8 }, 18.96],
  ['Verdana', 41, { share: 0.8 }, 30.96],
  ['Verdana', 31, { share: 0.9 }, 26.88],
  ['Verdana', 51, { share: 0.9 }, 44.88],
  ['Verdana', 36, { share: 1 }, 36],
  ['Verdana', 59, { share: 1 }, 59.04],
  ['Noto Sans', 40, { share: 1 }, 37.92],
  ['Noto Sans', 66, { share: 1 }, 61.92],
  ['Noto Sans', 40, { share: 0.8 }, 29.04],
  ['Noto Sans', 66, { share: 0.8 }, 48],
  ['Noto Sans', 40, { share: 0.9 }, 32.88],
  ['Noto Sans', 66, { share: 0.9 }, 54],
  ['Noto Sans', 40, { share: 1.2 }, 42.96],
  ['Noto Sans', 66, { share: 1.2 }, 71.04],
  ['Noto Sans', 40, { share: 1.5 }, 54],
  ['Noto Sans', 66, { share: 1.5 }, 89.04],
  ['Noto Sans', 40, { share: 2 }, 72],
  ['Noto Sans', 66, { share: 2 }, 119.04],
  ['Noto Sans', 40, { points: 40 }, 30],
  ['Noto Sans', 66, { points: 66 }, 49.92],
  ['Noto Sans', 40, { points: 48 }, 37.92],
  ['Noto Sans', 66, { points: 79.2 }, 61.92],
  ['Noto Sans', 40, { points: 60 }, 44.88],
  ['Noto Sans', 66, { points: 99 }, 73.92],
  ['Noto Sans', 25, { share: 0.8 }, 18],
  ['Noto Sans', 41, { share: 0.8 }, 30],
  ['Noto Sans', 31, { share: 0.9 }, 24.96],
  ['Noto Sans', 51, { share: 0.9 }, 42],
  ['Noto Sans', 36, { share: 1 }, 34.08],
  ['Noto Sans', 59, { share: 1 }, 55.92],
  ['Noto Sans Gujarati', 40, { share: 1 }, 32.88],
  ['Noto Sans Gujarati', 66, { share: 1 }, 54],
  ['Noto Sans Gujarati', 40, { share: 0.8 }, 25.92],
  ['Noto Sans Gujarati', 66, { share: 0.8 }, 42.96],
  ['Noto Sans Gujarati', 40, { share: 0.9 }, 29.04],
  ['Noto Sans Gujarati', 66, { share: 0.9 }, 48],
  ['Noto Sans Gujarati', 40, { share: 1.2 }, 42.96],
  ['Noto Sans Gujarati', 66, { share: 1.2 }, 70.08],
  ['Noto Sans Gujarati', 40, { share: 1.5 }, 50.88],
  ['Noto Sans Gujarati', 66, { share: 1.5 }, 84],
  ['Noto Sans Gujarati', 40, { share: 2 }, 68.88],
  ['Noto Sans Gujarati', 66, { share: 2 }, 114],
  ['Noto Sans Gujarati', 40, { points: 40 }, 26.88],
  ['Noto Sans Gujarati', 66, { points: 66 }, 44.88],
  ['Noto Sans Gujarati', 40, { points: 48 }, 32.88],
  ['Noto Sans Gujarati', 66, { points: 79.2 }, 54],
  ['Noto Sans Gujarati', 40, { points: 60 }, 44.88],
  ['Noto Sans Gujarati', 66, { points: 99 }, 73.92],
  ['Noto Sans Gujarati', 25, { share: 0.8 }, 16.08],
  ['Noto Sans Gujarati', 41, { share: 0.8 }, 25.92],
  ['Noto Sans Gujarati', 31, { share: 0.9 }, 23.04],
  ['Noto Sans Gujarati', 51, { share: 0.9 }, 36.96],
  ['Noto Sans Gujarati', 36, { share: 1 }, 30],
  ['Noto Sans Gujarati', 59, { share: 1 }, 48.96],
];

describe('a deck box’s first line, where PowerPoint puts it (X20, real-PowerPoint run 6)', () => {
  it('puts the first baseline where PowerPoint does, within a point, in every font, size and spacing measured', () => {
    expect(POWERPOINT_FIRST_BASELINES.length).toBeGreaterThan(130);
    for (const [font, size, line, first] of POWERPOINT_FIRST_BASELINES) {
      const at = powerPointFirstBaseline(fontOf(font), size, lineOf(size, line));
      expect(Math.abs(at - first), `${font} ${String(size)} pt ${JSON.stringify(line)}`).toBeLessThanOrEqual(
        1,
      );
    }
  });

  it('ends the last line with the single line’s own part below the baseline, whatever the spacing', () => {
    // Arial anchored at the bottom: the last baseline above the words' bottom (box bottom less its 3.6 pt inset).
    for (const [size, last] of [
      [18, 4.32],
      [28, 6.24],
      [40, 9.12],
      [66, 15.36],
    ] as const)
      expect(Math.abs(powerPointLastBelow(fontOf('Arial'), size) - last), String(size)).toBeLessThanOrEqual(
        1,
      );
  });

  it('moves the words of a box anchored at the top, middle or bottom by where CSS puts them and PowerPoint does', () => {
    // Arial boxes 324 pt tall (words 316.8 pt high), two lines; PowerPoint's first baseline below the words' top.
    const height = 316.8;
    const cases = [
      ['top', 40, { share: 1.5 }, 54.0],
      ['middle', 18, { share: 1 }, 154.8],
      ['middle', 66, { share: 1 }, 143.28],
      ['middle', 40, { share: 1.5 }, 144.96],
      ['middle', 66, { share: 1.5 }, 135.84],
      ['middle', 66, { share: 0.8 }, 143.04],
      ['bottom', 18, { share: 1 }, 291.6],
      ['bottom', 66, { share: 1 }, 222.48],
      ['bottom', 40, { share: 1.5 }, 235.68],
      ['bottom', 66, { share: 1.5 }, 182.88],
      ['bottom', 66, { share: 0.8 }, 238.08],
    ] as const;
    const arial = fontOf('Arial');
    for (const [anchor, size, line, first] of cases) {
      const lineHeight = lineOf(size, line);
      const look = { font: arial, size, line: lineHeight };
      // Where CSS lays two lines of that height out in the box, anchored so.
      const block = 2 * lineHeight;
      const top = anchor === 'top' ? 0 : anchor === 'middle' ? (height - block) / 2 : height - block;
      const css = top + cssFirstBaseline(arial, size, lineHeight);
      const moved = css + deckFirstLineShift(anchor, look, look);
      expect(
        Math.abs(moved - first),
        `${anchor} ${String(size)} pt ${JSON.stringify(line)}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('draws CSS’s first baseline with half the leading above the font’s own heights', () => {
    // 40 pt Arial, lines 1.2 times the size: (48 - 44.69) / 2 + 36.21 = 37.87 pt.
    expect(cssFirstBaseline(fontOf('Arial'), 40, 48)).toBeCloseTo(37.868, 2);
  });
});
