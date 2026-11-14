import { describe, expect, it } from 'vitest';
import type { TextElement } from './model';
import { cutLineHeight, sourceLineCut, withoutSourceFit } from './source-fit';

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
});
