import { describe, expect, it } from 'vitest';
import type { RenderSlide, SlideElement } from './model';
import { initialEngineState } from './engine/state';
import { hasPicture, lowerThirdOf, programPicture } from './program';
import { mediaInState, mediaUpNow } from './node-media';

const text: SlideElement = {
  id: 'placeholder-motion-text',
  kind: 'text',
  text: 'Placeholder moving words',
  lang: null,
  frame: { x: 100, y: 100, width: 800, height: 200 },
  style: {
    fontFamily: null,
    fontSize: 60,
    fontWeight: 400,
    color: '#ffffff',
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.2,
    shadow: false,
  },
};
const plain: RenderSlide = {
  id: 'placeholder-motion-slide',
  width: 1920,
  height: 1080,
  background: null,
  elements: [text],
};

describe('an animated slide in a lower-third or Camera layout', () => {
  it('keeps older plain words in their usual lower third', () => {
    expect(lowerThirdOf(plain, null).total).toBe(1);
    expect(hasPicture(plain)).toBe(false);
  });
  it('draws the whole animated slide so its element motion is never discarded by the stream or a screen', () => {
    const moving = {
      ...plain,
      elements: plain.elements.map((el) => ({
        ...el,
        motion: { in: { kind: 'fade' as const, delayMs: 0, durationMs: 600 } },
      })),
    };
    expect(lowerThirdOf(moving, null)).toEqual({ lines: [], total: 0 });
    expect(hasPicture(moving)).toBe(true);
    const state = initialEngineState();
    state.layers.slide = {
      presentationId: 'placeholder-presentation',
      slideIndex: 0,
      slide: moving,
      shownAt: 100,
      notes: '',
    };
    expect(programPicture(state, 'camera', null)).toEqual({
      kind: 'camera',
      lowerThird: [],
      full: 'slide',
      messages: false,
    });
  });
  it('includes a designed picture backdrop in node copies and the live files kept during deletion', () => {
    const state = initialEngineState();
    const picture = {
      ...plain,
      backdrop: { kind: 'picture' as const, mediaId: 'placeholder-backdrop', fit: 'fill' as const },
    };
    state.layers.slide = {
      presentationId: 'placeholder-presentation',
      slideIndex: 0,
      slide: picture,
      shownAt: 100,
      notes: '',
    };
    expect(mediaInState(state).now).toContain('placeholder-backdrop');
    expect(mediaUpNow(state)).toContain('placeholder-backdrop');
  });
});
