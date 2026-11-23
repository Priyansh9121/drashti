import { describe, expect, it } from 'vitest';
import { stepCount } from './deck';
import { settledDeckElements } from './deck-motion';
import { slideElementSchema } from './model-schema';
import { composeSlide } from './slide-design';
import { pdfMark } from '../renderer/src/editor/pdf-marks';

const points = [{ x: 10, y: 20 }, { x: 90, y: 60 }];
const mark = (id: string, clickOrder?: number) => {
  const shape = pdfMark('highlight', points, id);
  if (!shape) throw new Error('Generated mark is missing.');
  return slideElementSchema.parse({ ...shape, pdfMark: { tool: 'highlight', clickOrder } });
};

describe('PDF marks use the shared deck click timeline', () => {
  it('keeps mark identity and optional click order through storage validation', () => {
    expect(mark('generated-mark', 2)).toMatchObject({
      pdfMark: { tool: 'highlight', clickOrder: 2 },
    });
    expect(pdfMark('draw', points, 'generated-drawing')).toMatchObject({ pdfMark: { tool: 'draw' } });
  });

  it('shows the page immediately and reveals one mark per Next on every settled screen', () => {
    const elements = [mark('second', 20), mark('page'), mark('first', 10)];
    const slide = composeSlide({ id: 'page', width: 480, height: 320, background: '#ffffff', elements }, undefined, null);
    expect(stepCount(slide.deck)).toBe(3);
    const motion = slide.deck?.motion;
    if (!motion) throw new Error('PDF mark clicks did not reach the shared deck timeline.');
    expect(settledDeckElements(slide, motion, 0).map(({ id }) => id)).toEqual(['page']);
    expect(settledDeckElements(slide, motion, 1).map(({ id }) => id)).toEqual(['page', 'first']);
    expect(settledDeckElements(slide, motion, 2).map(({ id }) => id)).toEqual(['second', 'page', 'first']);
    expect(elements).toEqual([mark('second', 20), mark('page'), mark('first', 10)]);
  });

  it('does not leave an empty click when a marked object is removed or hidden', () => {
    const slide = composeSlide({ id: 'page', width: 480, height: 320, background: null,
      elements: [{ ...mark('hidden', 1), hidden: true }, mark('remaining', 7)] }, undefined, null);
    expect(stepCount(slide.deck)).toBe(2);
    expect(slide.deck?.motion?.effects).toMatchObject([{ step: 1 }]);
  });
});
