import { describe, expect, it } from 'vitest';
import type { TextElement } from './model';
import { cutLineHeight, sourceFitScale, sourceLineCut, withoutSourceFit } from './source-fit';

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
});
