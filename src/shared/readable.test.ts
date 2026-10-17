import { describe, expect, it } from 'vitest';
import type { TextElement, TextStyle } from './model';
import { drawnPx, estimateFit, floorOf, readabilityCounts, smallestSize } from './readable';

/* Words the hall can read (Sessions 31–36, SLD-1): the floors at 1080 lines, and the import's estimate. */

const style = (fontSize: number, extra: Partial<TextStyle> = {}): TextStyle => ({
  fontFamily: null,
  fontSize,
  fontWeight: 500,
  color: '#ffffff',
  align: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.25,
  shadow: false,
  ...extra,
});

const box = (text: string, fontSize: number, extra: Partial<TextElement> = {}): TextElement => ({
  id: `box-${text.length}-${String(fontSize)}`,
  kind: 'text',
  frame: { x: 160, y: 100, width: 1600, height: 300 },
  text,
  lang: 'en',
  style: style(fontSize),
  ...extra,
});

const LONG = 'Placeholder words for a slide that says far too much for its box to hold. '.repeat(8);

describe('the size floors, at 1080 lines', () => {
  it('warn below 36 px drawn and note below 48, on a slide of any height', () => {
    expect(floorOf(drawnPx(box('Placeholder', 30), 1080))).toBe('warning');
    expect(floorOf(drawnPx(box('Placeholder', 40), 1080))).toBe('note');
    expect(floorOf(drawnPx(box('Placeholder', 60), 1080))).toBeNull();
    // A 720-line slide's 24 px is 36 px at 1080: at the floor, so a note, not a warning.
    expect(drawnPx(box('Placeholder', 24), 720)).toBeCloseTo(36, 5);
    expect(floorOf(drawnPx(box('Placeholder', 24), 720))).toBe('note');
    // Shrink-to-fit's fit counts: 72 px at half size is 36.
    expect(drawnPx(box('Placeholder', 72), 1080, 0.5)).toBe(36);
  });

  it('read the smallest words a box holds, not its own size', () => {
    const mixed = box('Big small', 72, {
      runs: [
        { text: 'Big ', size: 72 },
        { text: 'small', size: 28 },
        { text: ' ', size: 10 },
      ],
    });
    expect(smallestSize(mixed)).toBe(28);
  });
});

describe('the import’s estimate', () => {
  it('a box that holds its words fits; one that does not runs over, unless it shrinks', () => {
    expect(estimateFit(box('Placeholder line', 80))).toEqual({ fit: 1, over: false });
    expect(estimateFit(box(LONG, 80))).toEqual({ fit: 1, over: true });
    const shrinking = estimateFit(box(LONG, 80, { style: style(80, { shrinkToFit: true }) }));
    expect(shrinking.over).toBe(false);
    expect(shrinking.fit).toBeGreaterThan(0.1);
    expect(shrinking.fit).toBeLessThan(1);
    // Past the screens' own floor (a tenth), it runs over even shrunk.
    expect(estimateFit(box(LONG.repeat(40), 80, { style: style(80, { shrinkToFit: true }) })).over).toBe(
      true,
    );
  });

  it('counts the slides that run over or sit below the floor, each once', () => {
    const slides = [
      { elements: [box('Placeholder line', 80)] },
      { elements: [box(LONG, 80), box(LONG, 80)] },
      { elements: [box('Placeholder small', 30)] },
      // Shrunk to fit, but drawn below 36 px.
      { elements: [box(LONG, 72, { style: style(72, { shrinkToFit: true }) })] },
      { elements: [] },
    ];
    expect(readabilityCounts(slides, 1080)).toEqual({ over: 1, small: 2 });
  });
});
