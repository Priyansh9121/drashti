import { describe, expect, it } from 'vitest';
import { stepCount } from './deck';
import { deckFromJson, deckToJson } from './deck-schema';
import { deckPictureId, deckSlideAt, stepOf } from './deck-show';
import type { RenderSlide } from './model';

const effect = {
  shapeId: '7',
  step: 1,
  phase: 'in' as const,
  kind: 'fade' as const,
  delayMs: 75,
  durationMs: 225,
};

const motion = {
  effects: [effect, { ...effect, step: 2, phase: 'out' as const }],
  stepsMs: [0, 300, 300],
  approximate: false,
};

const deck = { steps: [], media: [], motion };
const card = { sourceShapeId: '7' };
const slide: RenderSlide = {
  id: 'placeholder-slide',
  width: 1920,
  height: 1080,
  background: null,
  elements: [
    {
      id: 'placeholder-card',
      ...card,
      kind: 'image',
      frame: { x: 100, y: 100, width: 600, height: 400 },
      mediaId: 'placeholder-image',
      fit: 'fit',
    },
  ],
  deck,
};

describe('a deck whose editable shapes play each click', () => {
  it('counts click groups with no baked clips and clamps the active step', () => {
    expect(stepCount(deck)).toBe(3);
    expect(stepOf({ slide, step: 50 })).toBe(2);
  });

  it('shows only shapes visible at the end of the selected click in a still preview', () => {
    expect(deckPictureId(slide)).toBeNull();
    expect(deckSlideAt(slide, 0).elements).toEqual([]);
    expect(deckSlideAt(slide, 1).elements).toEqual(slide.elements);
    expect(deckSlideAt(slide, 2).elements).toEqual([]);
  });

  it('keeps an existing baked slide and its stills even when motion for editing is available', () => {
    const baked = {
      ...slide,
      deck: { ...deck, steps: [{ clipId: 'placeholder-clip', clipMs: 500, lastId: 'placeholder-still' }] },
    };
    expect(stepCount(baked.deck)).toBe(1);
    expect(deckPictureId(baked)).toBe('placeholder-card');
    expect(deckSlideAt(baked, 0).elements[0]).toMatchObject({ mediaId: 'placeholder-still' });
  });

  it('round-trips native motion and rejects an invalid step reference', () => {
    expect(deckFromJson(deckToJson(deck))).toEqual(deck);
    const invalid = { ...deck, motion: { ...motion, effects: [{ ...effect, step: 7 }] } };
    expect(deckFromJson(deckToJson(invalid))).toBeNull();
  });
});
