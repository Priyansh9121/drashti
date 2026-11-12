import { describe, expect, it } from 'vitest';
import { type DeckEffect, stepCount } from './deck';
import { deckMotionFrame, deckWipeClip } from './deck-motion';
import { deckFromJson, deckMediaIds, deckToJson, mapDeckMedia } from './deck-schema';
import { deckPictureId, deckPictures, deckSlideAt, nativeStepTiming, stepOf } from './deck-show';
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

describe('PowerPoint effects from the engine step clock', () => {
  const bounds = { x: 100, y: 100, width: 600, height: 400 };
  const at = (step: number, elapsedMs: number, effects: readonly DeckEffect[] = motion.effects) =>
    deckMotionFrame(effects, step, elapsedMs, bounds, slide);

  it('waits for the precise delay, finishes each effect, and settles prior groups on a quick Next', () => {
    expect(at(0, Infinity)).toMatchObject({ opacity: 0, moving: false, nextAt: null });
    expect(at(1, 74)).toMatchObject({ opacity: 0, moving: false, nextAt: 75 });
    expect(at(1, 75)).toMatchObject({ opacity: 0, moving: true });
    expect(at(1, 187.5).opacity).toBe(0.5);
    expect(at(1, 300)).toMatchObject({ opacity: 1, moving: false });
    expect(at(2, 0)).toMatchObject({ opacity: 1, moving: false, nextAt: 75 });
    expect(at(2, 187.5).opacity).toBe(0.5);
    expect(at(2, 300)).toMatchObject({ opacity: 0, moving: false });
  });

  it('applies an instantaneous effect at its timestamp, with the step clock independent of slide entry', () => {
    const appear: DeckEffect = { ...effect, kind: 'appear', delayMs: 0, durationMs: 0 };
    expect(at(1, -1, [appear])).toMatchObject({ opacity: 0, nextAt: 0, moving: false });
    expect(at(1, 0, [appear])).toMatchObject({ opacity: 1, nextAt: null, moving: false });
    expect(nativeStepTiming({ slide, shownAt: 1000, step: 1, stepAt: 1300 })).toMatchObject({
      index: 1,
      clipAt: 1300,
      endsAt: 1600,
      still: false,
    });
    expect(nativeStepTiming({ slide, shownAt: 1000, step: 1, stepAt: 1400, stepFromMs: 300 })).toMatchObject({
      index: 1,
      clipAt: 1100,
      endsAt: 1400,
      still: true,
    });
  });

  it('flies up from below the slide and zooms from the shape’s center', () => {
    const fly: DeckEffect = { ...effect, kind: 'fly', direction: 'up' };
    expect(at(1, 75, [fly])).toMatchObject({ opacity: 1, x: 0, y: 980, moving: true });
    expect(at(1, 187.5, [fly]).y).toBe(490);
    expect(at(1, 300, [fly])).toMatchObject({ x: 0, y: 0, moving: false });
    const zoom: DeckEffect = { ...effect, kind: 'zoom' };
    expect(at(1, 187.5, [zoom]).scale).toBe(0.5);
    expect(at(1, 300, [zoom]).scale).toBe(1);
  });

  it('wipes a group with one edge across its separately drawn shapes', () => {
    const wipe: DeckEffect = { ...effect, kind: 'wipe', direction: 'left' };
    const frame = at(1, 187.5, [wipe]);
    expect(deckWipeClip(frame.wipe, bounds, { ...bounds, width: 200 })).toBe('inset(0% 0% 0% 100%)');
    expect(deckWipeClip(frame.wipe, bounds, { ...bounds, x: 300, width: 200 })).toBe('inset(0% 0% 0% 50%)');
    expect(deckWipeClip(frame.wipe, bounds, { ...bounds, x: 500, width: 200 })).toBe('inset(0% 0% 0% 0%)');
    expect(at(1, 300, [wipe]).wipe).toBeNull();
  });

  it('keeps a spin’s final rotation across clicks while a pulse returns to its original size', () => {
    const spin: DeckEffect = { ...effect, phase: 'emphasis', kind: 'spin', degrees: 90 };
    const pulse: DeckEffect = { ...effect, phase: 'emphasis', kind: 'pulse' };
    expect(at(1, 187.5, [spin, pulse])).toMatchObject({ rotation: 45, scale: 1.12 });
    expect(at(2, 0, [spin, pulse])).toMatchObject({ rotation: 90, scale: 1, moving: false });
  });

  it('retains and remaps the original still needed by a following baked transition', () => {
    const native = { ...deck, sourceStillId: 'placeholder-last' };
    expect(deckMediaIds(native)).toEqual(['placeholder-last']);
    expect(deckPictures(native)).toEqual(['placeholder-last']);
    expect(mapDeckMedia(native, (id) => id + '-copy').sourceStillId).toBe('placeholder-last-copy');
  });
});
