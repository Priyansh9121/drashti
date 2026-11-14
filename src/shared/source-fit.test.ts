import { describe, expect, it } from 'vitest';
import type { TextElement } from './model';
import { cutLineHeight, sourceFitScale, sourceLineCut, sourceRunScale, withoutSourceFit } from './source-fit';

/*
 * A deck's own shrink of a box's words (Session 58, PF-4b): PowerPoint's line spacing reduction taken off each line
 * spacing given as a share of a line, as PowerPoint draws it.
 */

const box = (sourceFit?: TextElement['style']['sourceFit']): TextElement => ({
  id: 'placeholder-shrunk',
  kind: 'text',
  frame: { x: 0, y: 0, width: 800, height: 200 },
  text: 'Placeholder words',
  lang: 'en',
  style: {
    fontFamily: null,
    fontSize: 40,
    fontWeight: 400,
    color: '#ffffff',
    align: 'left',
    verticalAlign: 'top',
    lineHeight: 1.2,
    shadow: false,
    shrinkToFit: true,
    ...(sourceFit ? { sourceFit } : {}),
  },
});

describe('a deck’s own shrink of a box’s words (Session 58, PF-4b)', () => {
  it('takes PowerPoint’s line spacing reduction off each line as a share of a single line', () => {
    expect(sourceLineCut(box({ fontScale: 0.85, lineSpacingReduction: 0.1 }).style)).toBeCloseTo(0.12, 10);
    expect(sourceLineCut(box({ fontScale: 0.85, lineSpacingReduction: 0.2 }).style)).toBeCloseTo(0.24, 10);
    // A shrink of the words alone, and a box without one: nothing off.
    expect(sourceLineCut(box({ fontScale: 0.85, lineSpacingReduction: 0 }).style)).toBe(0);
    expect(sourceLineCut(box().style)).toBe(0);
  });

  it('leaves a line its share less the reduction: 100% less 10% is 90%, 90% less 20% is 70%', () => {
    expect(cutLineHeight(1.2, 0.12)).toBe(1.08);
    expect(cutLineHeight(1.08, 0.24)).toBe(0.84);
    expect(cutLineHeight(1.35, 0)).toBe(1.35);
    // Never below the deck reader's least.
    expect(cutLineHeight(0.2, 0.24)).toBe(0.1);
  });

  it('a box’s line spacing set in Drashti replaces PowerPoint’s shrink: the numbers go', () => {
    const shrunk = box({ fontScale: 0.85, lineSpacingReduction: 0.1 });
    const set = withoutSourceFit(shrunk);
    expect(set.style).not.toHaveProperty('sourceFit');
    expect(set.style.lineHeight).toBe(1.2);
    expect(shrunk.style.sourceFit).toBeDefined();
    const plain = box();
    expect(withoutSourceFit(plain)).toBe(plain);
  });

  it('draws the words at PowerPoint’s own shrunk size: the size times its fontScale, to a whole point (run 4)', () => {
    // PowerPoint's own movie of shrunk boxes (h-pptx3's run 4, 14 Nov 2026), each line's words measured by their width:
    // 28 pt at 77.5% drawn 21.94 pt (22), 24 pt at 85% 20.01 (20, not 20.4), 32 pt at 70% 21.96 (22, not 22.4),
    // 40 pt at 62.5% 24.92 (25), 28 pt at 92.5% 26.0 (26, not 25.9).
    const at = (points: number, fontScale: number) =>
      sourceFitScale({
        ...box({ fontScale, lineSpacingReduction: 0.1 }),
        style: {
          ...box().style,
          fontSize: (points * 4) / 3,
          sourceFit: { fontScale, lineSpacingReduction: 0.1 },
        },
      });
    expect(at(28, 0.775)).toBeCloseTo(22 / 28, 10);
    expect(at(24, 0.85)).toBeCloseTo(20 / 24, 10);
    expect(at(32, 0.7)).toBeCloseTo(22 / 32, 10);
    expect(at(40, 0.625)).toBeCloseTo(25 / 40, 10);
    expect(at(28, 0.925)).toBeCloseTo(26 / 28, 10);
    // A box without PowerPoint's shrink has no such size.
    expect(sourceFitScale(box())).toBeUndefined();
  });

  it('takes the size of most of the box’s words where its runs differ', () => {
    const mixed: TextElement = {
      ...box({ fontScale: 0.85, lineSpacingReduction: 0.1 }),
      text: 'Placeholder heading words\nsmall',
      runs: [
        { text: 'Placeholder heading words\n', size: (24 * 4) / 3 },
        { text: 'small', size: (12 * 4) / 3 },
      ],
    };
    // 24 pt carries most of the words: 24 x 85% = 20.4, drawn 20.
    expect(sourceFitScale(mixed)).toBeCloseTo(20 / 24, 10);
  });

  it('rounds each run’s own size to a whole point, as PowerPoint does where a box’s words have two sizes (run 5)', () => {
    // PowerPoint's own PDF of shrunk boxes with two sizes (h-pptx3's run 5, 14 Nov 2026), each run's size as drawn:
    // 40 and 18 pt at 62.5% are 25 and 11 pt (not 11.25), 36 and 24 at 70% 25 and 17 (not 16.67), 32 and 20 at 77.5%
    // 25 and 16 (not 15.63). The box's fit is its main size's (sourceFitScale); each run is drawn this much off it.
    const two = (large: number, small: number, fontScale: number): TextElement => ({
      ...box({ fontScale, lineSpacingReduction: 0.2 }),
      text: 'Placeholder title words in line A\nPlaceholder smaller words B',
      style: {
        ...box().style,
        fontSize: (large * 4) / 3,
        sourceFit: { fontScale, lineSpacingReduction: 0.2 },
      },
      runs: [
        { text: 'Placeholder title words in line A\n', size: (large * 4) / 3 },
        { text: 'Placeholder smaller words B', size: (small * 4) / 3 },
      ],
    });
    const drawnPt = (el: TextElement, points: number) =>
      points * (sourceFitScale(el) ?? 1) * sourceRunScale(el, (points * 4) / 3);
    for (const [large, small, fontScale, bigPt, smallPt] of [
      [40, 18, 0.625, 25, 11],
      [36, 24, 0.7, 25, 17],
      [32, 20, 0.775, 25, 16],
    ] as const) {
      const el = two(large, small, fontScale);
      expect(drawnPt(el, large), `${String(large)} pt`).toBeCloseTo(bigPt, 10);
      expect(drawnPt(el, small), `${String(small)} pt`).toBeCloseTo(smallPt, 10);
      // The main size is the box's fit itself.
      expect(sourceRunScale(el, (large * 4) / 3)).toBe(1);
    }
    // A box without PowerPoint's shrink, or one Drashti fits itself, draws every run at the box's fit.
    expect(sourceRunScale(box(), 24)).toBe(1);
    const own = two(40, 18, 0.625);
    expect(sourceRunScale({ ...own, style: { ...own.style, shrinkToFit: false } }, 24)).toBe(1);
  });
});
