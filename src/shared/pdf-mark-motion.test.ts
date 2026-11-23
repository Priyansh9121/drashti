import { describe, expect, it } from 'vitest';
import { stepCount } from './deck';
import { deckSlideSchema } from './deck-schema';
import { settledDeckElements } from './deck-motion';
import { slideElementSchema } from './model-schema';
import { composeSlide } from './slide-design';
const mark = (id: string, clickOrder?: number) => {
  const element = slideElementSchema.parse({
    id,
    kind: 'shape',
    shape: 'rectangle',
    frame: { x: 10, y: 20, width: 80, height: 40 },
    fill: '#f4c542',
    cornerRadius: 0,
    opacity: 0.32,
    pdfMark: { tool: 'highlight', clickOrder },
  });
  if (element.kind !== 'shape') throw new Error('Generated mark must be a shape.');
  return element;
};

describe('PDF marks use the shared deck click timeline', () => {
  it('keeps a click mark from fading away on the slide clock before its click, retaining its saved timing', () => {
    const element = {
      ...mark('timed-mark', 1),
      motion: {
        in: { kind: 'fade' as const, delayMs: 0, durationMs: 600 },
        out: { kind: 'fade' as const, delayMs: 2000, durationMs: 600 },
      },
    };
    const slide = composeSlide(
      { id: 'page', width: 480, height: 320, background: null, elements: [element] },
      undefined,
      null,
    );
    expect(slide.elements[0]).not.toHaveProperty('motion');
    expect(element.motion).toEqual({
      in: { kind: 'fade', delayMs: 0, durationMs: 600 },
      out: { kind: 'fade', delayMs: 2000, durationMs: 600 },
    });
    const automatic = composeSlide(
      {
        id: 'page',
        width: 480,
        height: 320,
        background: null,
        elements: [{ ...element, pdfMark: { tool: 'highlight' as const } }],
      },
      undefined,
      null,
    );
    expect(automatic.deck).toBeUndefined();
    expect(automatic.elements[0]?.motion).toEqual(element.motion);
  });
  it('keeps mark identity and optional click order through storage validation', () => {
    expect(mark('generated-mark', 2)).toMatchObject({
      pdfMark: { tool: 'highlight', clickOrder: 2 },
    });
  });

  it('shows the page immediately and reveals one mark per Next on every settled screen', () => {
    const elements = [mark('second', 20), mark('page'), mark('first', 10)];
    const slide = composeSlide(
      { id: 'page', width: 480, height: 320, background: '#ffffff', elements },
      undefined,
      null,
    );
    expect(stepCount(slide.deck)).toBe(3);
    const motion = slide.deck?.motion;
    expect(deckSlideSchema.parse(slide.deck)).toEqual(slide.deck);
    if (!motion) throw new Error('PDF mark clicks did not reach the shared deck timeline.');
    expect(settledDeckElements(slide, motion, 0).map(({ id }) => id)).toEqual(['page']);
    expect(settledDeckElements(slide, motion, 1).map(({ id }) => id)).toEqual(['page', 'first']);
    expect(settledDeckElements(slide, motion, 2).map(({ id }) => id)).toEqual(['second', 'page', 'first']);
    expect(elements).toEqual([mark('second', 20), mark('page'), mark('first', 10)]);
  });

  it('does not leave an empty click when a marked object is removed or hidden', () => {
    const slide = composeSlide(
      {
        id: 'page',
        width: 480,
        height: 320,
        background: null,
        elements: [{ ...mark('hidden', 1), hidden: true }, mark('remaining', 7)],
      },
      undefined,
      null,
    );
    expect(stepCount(slide.deck)).toBe(2);
    expect(slide.deck?.motion?.effects).toMatchObject([{ step: 1 }]);
  });
});
