import { describe, expect, it } from 'vitest';
import type { EngineState } from './engine/state';
import { initialEngineState } from './engine/state';
import type { RenderSlide } from './model';
import { hasPicture, lowerThirdOf, programPicture } from './program';
import { DRASHTI_TIMER_LOOK, timerAloneSlide, timerLayoutElements } from './timer-slides';

/*
 * A slide with a Timer wherever slides are lower thirds (Session 50): the stream's Camera layout and a Look
 * that draws slides as a lower third. Its time is no line of words, so the slide is drawn whole, as a picture
 * slide is, with its words: never "Starting in" without the time. Placeholder words only.
 */

const withWords = (): RenderSlide => {
  let n = 0;
  return {
    id: 'w',
    width: 1920,
    height: 1080,
    background: null,
    elements: timerLayoutElements(
      'words',
      't1',
      DRASHTI_TIMER_LOOK,
      { width: 1920, height: 1080 },
      () => `e${String(++n)}`,
    ),
  };
};

const up = (slide: RenderSlide): EngineState => {
  const s = initialEngineState();
  return {
    ...s,
    layers: { ...s.layers, slide: { presentationId: 'p', slideIndex: 0, slide, shownAt: 1, notes: '' } },
  };
};

describe('a slide with a Timer where slides are lower thirds', () => {
  it('is something to look at besides words, with no lines of its own for a lower third', () => {
    expect(hasPicture(timerAloneSlide('t1', DRASHTI_TIMER_LOOK))).toBe(true);
    expect(hasPicture(withWords())).toBe(true);
    expect(lowerThirdOf(withWords(), null)).toEqual({ lines: [], total: 0 });
  });

  it('is drawn whole on the stream’s Camera layout, instead of the camera, as a picture slide is', () => {
    for (const slide of [timerAloneSlide('t1', DRASHTI_TIMER_LOOK), withWords()])
      expect(programPicture(up(slide), 'camera', null)).toMatchObject({
        kind: 'camera',
        lowerThird: [],
        full: 'slide',
      });
  });
});
