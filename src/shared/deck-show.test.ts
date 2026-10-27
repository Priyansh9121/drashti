import { describe, expect, it } from 'vitest';
import type { DeckMedia, DeckSlide } from './deck';
import { deckPictureId, deckPictures, deckSlideAt, deckSounds, stepOf, stepTiming } from './deck-show';
import { playingNow, playingOf } from './engine/playing';
import { mediaToPreload } from './engine/preload';
import { type EngineState, initialEngineState, type SlideLayer } from './engine/state';
import type { RenderSlide } from './model';
import { mediaInState, mediaUpNow } from './node-media';

/*
 * A deck's slide shown as it was (Session 54, C2), as every screen, a node and the time bar read it: the step's clip
 * timed from the engine's `stepAt`, the deck's picture drawn as the step, what a node copies and an output loads
 * ahead, and its videos and sounds on the time bar. Made-up media ids only.
 */

const sound: DeckMedia = {
  kind: 'audio',
  mediaId: 'deck-sound',
  box: { x: 0, y: 0, w: 0.05, h: 0.05 },
  loop: true,
  volume: 0.8,
  start: { step: 1, offsetMs: 0 },
  hideWhenStopped: true,
};
const video: DeckMedia = {
  kind: 'video',
  mediaId: 'deck-video',
  box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
  posterId: 'deck-poster',
  loop: true,
  volume: 0.5,
  start: { clicked: true },
};

const deck: DeckSlide = {
  transition: { name: 'push', durationMs: 500, soundId: 'deck-chime' },
  steps: [
    { clipId: 'clip0', clipMs: 1500, transitionMs: 500, lastId: 'last0' },
    { clipId: 'clip1', clipMs: 800, lastId: 'last1', holdId: 'hold1', holdMs: 2000 },
    { clipId: 'clip2', clipMs: 600, lastId: 'last2' },
  ],
  media: [sound, video],
  stepTransitions: { 2: { transition: { kind: 'dissolve', durationMs: 400 }, mode: 'instead' } },
};

const slide: RenderSlide = {
  id: 'deck-slide',
  width: 1920,
  height: 1080,
  background: null,
  elements: [
    {
      id: 'pic',
      kind: 'image',
      frame: { x: 0, y: 0, width: 1920, height: 1080 },
      mediaId: 'last2',
      fit: 'fit',
    },
    {
      id: 'vid',
      kind: 'video',
      frame: { x: 192, y: 108, width: 960, height: 540 },
      mediaId: 'deck-video',
      fit: 'fit',
      loop: false,
    },
  ],
  deck,
};

const layer = (more: Partial<SlideLayer> = {}): SlideLayer => ({
  presentationId: 'p',
  slideIndex: 0,
  slide,
  shownAt: 10_000,
  notes: '',
  ...more,
});

function state(more: Partial<SlideLayer> = {}, next: EngineState['next'] = null): EngineState {
  const s = initialEngineState();
  return { ...s, next, layers: { ...s.layers, slide: layer(more) } };
}

describe('a deck’s slide as the screens draw it (Session 54, C2)', () => {
  it('times each step’s clip from the engine’s stepAt, less how far into it the step was shown from', () => {
    // Coming in by a jump: its clip started 500 ms in, past the deck's own transition.
    expect(stepTiming(layer({ step: 0, stepAt: 10_000, stepFromMs: 500 }))).toMatchObject({
      index: 0,
      clipAt: 9500,
      endsAt: 11_000,
      still: false,
      drashti: null,
    });
    // A click, then the step come back to by Back: still, at its last frame at once.
    expect(stepTiming(layer({ step: 1, stepAt: 12_000 }))).toMatchObject({ clipAt: 12_000, endsAt: 12_800 });
    expect(stepTiming(layer({ step: 1, stepAt: 13_000, stepFromMs: 800 }))).toMatchObject({ still: true });
    // Drashti's own transition for step 2, instead of its motion; never when the step is come back to.
    expect(stepTiming(layer({ step: 2, stepAt: 14_000 }))?.drashti).toEqual(deck.stepTransitions?.[2]);
    expect(stepTiming(layer({ step: 2, stepAt: 14_000, stepFromMs: 600 }))?.drashti).toBeNull();
    // A layer saved with no step is at its first; one past its last at its last.
    expect(stepOf(layer())).toBe(0);
    expect(stepOf(layer({ step: 7 }))).toBe(2);
    // Any other slide has no step to time.
    expect(stepTiming(layer({ slide: { ...slide, deck: undefined } }))).toBeNull();
  });

  it('draws the step in the deck’s picture’s place, and a still of any step for what comes next', () => {
    expect(deckPictureId(slide)).toBe('pic');
    expect(deckSlideAt(slide, 0).elements[0]).toMatchObject({ id: 'pic', mediaId: 'last0' });
    expect(deckSlideAt(slide, 1).elements[1]).toEqual(slide.elements[1]);
    expect(deckSlideAt({ ...slide, deck: undefined }, 1)).toEqual({ ...slide, deck: undefined });
  });

  it('gives a node every clip, last frame, hold, video and poster, and Main’s audio player its sounds', () => {
    expect(deckPictures(deck).sort()).toEqual(
      ['clip0', 'clip1', 'clip2', 'deck-poster', 'deck-video', 'hold1', 'last0', 'last1', 'last2'].sort(),
    );
    expect(deckSounds(deck).sort()).toEqual(['deck-chime', 'deck-sound']);
    const shown = mediaInState(state());
    expect(shown.now).toEqual(
      expect.arrayContaining(['clip1', 'hold1', 'last2', 'deck-poster', 'deck-video']),
    );
    expect([...mediaUpNow(state())]).toEqual(expect.arrayContaining(['deck-sound', 'deck-chime']));
  });

  it('loads the step Next shows ahead on every output: its clip, last frame and hold', () => {
    const next: EngineState['next'] = {
      kind: 'slide',
      presentationId: 'p',
      slideIndex: 0,
      slide,
      background: null,
      step: 1,
      itemId: null,
      notes: '',
    };
    expect(mediaToPreload(next)).toEqual(
      expect.arrayContaining([
        { mediaId: 'clip1', media: 'video' },
        { mediaId: 'last1', media: 'image' },
        { mediaId: 'hold1', media: 'video' },
      ]),
    );
    expect(mediaInState(state({}, next)).now).toContain('clip2');
  });

  it('puts its sounds on the time bar beside its videos, each going round as its deck says', () => {
    const s = state({
      step: 1,
      stepAt: 11_000,
      seeks: {
        'deck-sound': { at: 11_000, toMs: 0 },
        'deck-video': { at: 10_000, toMs: 0, paused: true, waiting: true },
      },
    });
    const refs = playingNow(s).map((p) => [p.ref, p.sound === true, p.clock.loop]);
    expect(refs).toEqual([
      [{ layer: 'slide', mediaId: 'deck-video' }, false, true],
      [{ layer: 'slide', mediaId: 'deck-sound' }, true, true],
    ]);
    expect(playingOf(s, { layer: 'slide', mediaId: 'deck-video' })?.paused).toBe(true);
    expect(playingOf(s, { layer: 'slide', mediaId: 'nothing' })).toBeNull();
  });
});
