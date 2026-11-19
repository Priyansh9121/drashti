import { describe, expect, it } from 'vitest';
import type { FontHeights } from '../../../shared/first-line';
import type { TextElement, TextRun } from '../../../shared/model';
import { deckWordsShift } from './first-line-shift';

/*
 * X20 (h-run6, Session 59): how far a deck box's words move so that its first line sits where PowerPoint puts it
 * (shared/first-line.ts, from real-PowerPoint run 6): worked out from the box's own lines as the screens lay them out.
 */
const ARIAL: FontHeights = { ascent: 0.9053, descent: 0.2119 };
const heights = (family: string): FontHeights | null => (family.includes('Arial') ? ARIAL : null);
/** 40 pt in Drashti's slide pixels (4/3 a point). */
const SIZE = (40 * 4) / 3;

function box(paragraph: TextRun['paragraph'], more: Partial<TextElement> = {}, lines = 2): TextElement {
  const runs: TextRun[] = Array.from({ length: lines }, (_, i) => ({
    text: i < lines - 1 ? `Line ${String(i + 1)}\n` : `Line ${String(i + 1)}`,
    size: SIZE,
    ...(paragraph ? { paragraph } : {}),
  }));
  return {
    id: 'placeholder',
    kind: 'text',
    frame: { x: 0, y: 0, width: 600, height: 400 },
    text: runs.map((r) => r.text).join(''),
    runs,
    sourceShapeId: '7',
    style: {
      fontFamily: 'Arial',
      fontSize: SIZE,
      fontWeight: 400,
      color: '#000000',
      align: 'left',
      verticalAlign: 'top',
      lineHeight: 1.2,
      shadow: false,
    },
    ...more,
  } as TextElement;
}

describe('a deck box’s words moved to PowerPoint’s first line (X20)', () => {
  it('moves 150% lines down by what CSS’s half leading leaves out', () => {
    // PowerPoint: 54 pt below the words' top (72 px); CSS: 48 + 0.6934 x 53.33 / 2 = 66.49 px.
    expect(deckWordsShift(box({ align: 'left', lineHeight: 1.8 }), heights)).toBeCloseTo(72 - 66.49, 1);
  });

  it('moves single-spaced lines a little, and lines set exactly in points by their own height', () => {
    // Single: PowerPoint 1.2 x 0.9053 / 1.1172 of the size (51.86 px); CSS 32 + 18.49 = 50.49 px.
    expect(deckWordsShift(box({ align: 'left', lineHeight: 1.2 }), heights)).toBeCloseTo(51.86 - 50.49, 1);
    // Exactly 36 pt (48 px): PowerPoint loses the cut above the baseline, though never above three quarters of the
    // line (here 36 px, just below the single line's part below: 48 - 12.14).
    const exact = deckWordsShift(box({ align: 'left', lineHeightPx: 48 }), heights) ?? Number.NaN;
    expect(exact).toBeCloseTo(Math.max(0.75 * 48, 48 - 0.2276 * SIZE) - (24 + 18.49), 1);
  });

  it('moves a box anchored at the bottom by its last line, and one at the middle halfway', () => {
    const top = deckWordsShift(box({ align: 'left', lineHeight: 1.8 }), heights) ?? Number.NaN;
    const bottom =
      deckWordsShift(
        box(
          { align: 'left', lineHeight: 1.8 },
          { style: { ...box(undefined).style, verticalAlign: 'bottom' } },
        ),
        heights,
      ) ?? Number.NaN;
    // At the bottom PowerPoint ends the last line with the single line's part below (0.2276 of the size): 96 - 12.14.
    expect(bottom).toBeCloseTo(96 - 0.2276 * SIZE - 66.49, 1);
    const middle =
      deckWordsShift(
        box(
          { align: 'left', lineHeight: 1.8 },
          { style: { ...box(undefined).style, verticalAlign: 'middle' } },
        ),
        heights,
      ) ?? Number.NaN;
    expect(middle).toBeCloseTo((top + bottom) / 2, 3);
  });

  it('leaves a box made in Drashti, one without a deck’s paragraphs and one set vertically as they are', () => {
    const { sourceShapeId: _id, ...own } = box({ align: 'left', lineHeight: 1.8 });
    expect(deckWordsShift(own as TextElement, heights)).toBeUndefined();
    expect(deckWordsShift(box(undefined), heights)).toBeUndefined();
    const vertical = box(
      { align: 'left', lineHeight: 1.8 },
      { style: { ...box(undefined).style, writingMode: 'vertical-rl' } },
    );
    expect(deckWordsShift(vertical, heights)).toBeUndefined();
    // A font this page cannot measure: drawn as it always was.
    expect(
      deckWordsShift(
        box(
          { align: 'left', lineHeight: 1.8 },
          { style: { ...box(undefined).style, fontFamily: 'Placeholder' } },
        ),
        () => null,
      ),
    ).toBeUndefined();
  });
});
