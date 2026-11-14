import { describe, expect, it } from 'vitest';
import type { DeckNativeTransition } from '../../../shared/deck-transition';
import type { SlideLayer } from '../../../shared/engine/state';
import {
  type BandBoxes,
  fadeAt,
  type Layers,
  nextShowing,
  type Paint,
  paintLayers,
  paintWaiting,
} from './SlideLayerView';
import { deckTransitionFrame, wipeBandStyles } from './transition-frame';

const layer = (id: string, shownAt: number, transition?: SlideLayer['transition']): SlideLayer => ({
  presentationId: 'p',
  slideIndex: 0,
  slide: { id, width: 1920, height: 1080, background: null, elements: [] },
  shownAt,
  notes: '',
  ...(transition ? { transition } : {}),
});
const none = { on: null, off: null, fade: null };

describe('the slide layer on a screen', () => {
  it('cuts, or dissolves from the slide that was up while there is time left', () => {
    const a = layer('a', 1000);
    const shown = nextShowing(none, a, 1000);
    expect(shown).toEqual({ on: a, off: null, fade: null });
    const b = layer('b', 2000, { kind: 'dissolve', durationMs: 800 });
    expect(nextShowing(shown, b, 2010)).toEqual({
      on: b,
      off: a,
      fade: { kind: 'dissolve', ms: 800, start: null },
    });
    // A screen that hears of it after the dissolve has finished just shows it.
    expect(nextShowing(shown, b, 2900)).toEqual({ on: b, off: null, fade: null });
  });

  it('does not fade again for the same slide with new content, and clears at once', () => {
    const b = layer('b', 2000, { kind: 'dissolve', durationMs: 800 });
    const fading = {
      on: b,
      off: layer('a', 1000),
      fade: { kind: 'dissolve' as const, ms: 800, start: 2000 },
    };
    const edited = { ...b, notes: 'Placeholder note' };
    expect(nextShowing(fading, edited, 2100)).toEqual({ ...fading, on: edited });
    expect(nextShowing(fading, null, 2100)).toEqual(none);
  });

  it('a slide still waiting for its pictures never becomes the one going away: what is on screen does (Session 23)', () => {
    const a = layer('a', 1000);
    const b = layer('b', 2000, { kind: 'dissolve', durationMs: 800 });
    const c = layer('c', 2100, { kind: 'dissolve', durationMs: 800 });
    // b waits for its pictures: a is still the slide on screen.
    const waiting = nextShowing({ on: a, off: null, fade: null }, b, 2010);
    expect(waiting).toEqual({ on: b, off: a, fade: { kind: 'dissolve', ms: 800, start: null } });
    // c comes before b has begun to fade in: it dissolves from a, never from b (which was never seen).
    expect(nextShowing(waiting, c, 2110)).toEqual({
      on: c,
      off: a,
      fade: { kind: 'dissolve', ms: 800, start: null },
    });
    // Once b had begun, b is what goes.
    const begun = { ...waiting, fade: { kind: 'dissolve' as const, ms: 800, start: 2000 } };
    expect(nextShowing(begun, c, 2110)).toEqual({
      on: c,
      off: b,
      fade: { kind: 'dissolve', ms: 800, start: null },
    });
  });

  it('runs every transition that takes time, each by its kind; a cut, or one of no length, just shows (Session 26d)', () => {
    const a = layer('a', 1000);
    const shown = nextShowing(none, a, 1000);
    for (const kind of ['fade-black', 'slide', 'zoom'] as const) {
      const b = layer('b', 2000, { kind, durationMs: 1000 });
      expect(nextShowing(shown, b, 2010)).toEqual({ on: b, off: a, fade: { kind, ms: 1000, start: null } });
    }
    expect(nextShowing(shown, layer('b', 2000, { kind: 'slide', durationMs: 0 }), 2010).fade).toBeNull();
    expect(nextShowing(shown, layer('b', 2000, { kind: 'cut', durationMs: 0 }), 2010).fade).toBeNull();
  });

  it('works out how far a dissolve is from the clock', () => {
    expect(fadeAt({ ms: 1000, start: 5000 }, 4000)).toBe(0);
    expect(fadeAt({ ms: 1000, start: 5000 }, 5250)).toBe(0.25);
    expect(fadeAt({ ms: 1000, start: 5000 }, 9000)).toBe(1);
  });
});

describe('a timer shown alone on a screen (Session 50)', () => {
  const timer = (shownAt: number): SlideLayer => ({
    ...layer('timer:t1', shownAt, { kind: 'push', durationMs: 600 }),
    presentationId: 'timer:t1',
    timer: { timerId: 't1', name: 'Placeholder countdown' },
  });

  it('goes off with its transition’s length, fading from when it was taken off', () => {
    const t = timer(1000);
    const up = { on: t, off: null, fade: null };
    expect(nextShowing(up, null, 5010, { layer: t, at: 5000 })).toEqual({
      on: null,
      off: t,
      fade: { kind: 'dissolve', ms: 600, start: 5000 },
    });
    // A screen that hears of it once the fade is over, or never saw it: nothing to fade.
    expect(nextShowing(up, null, 5600, { layer: t, at: 5000 })).toEqual(none);
    expect(nextShowing(none, null, 5010, { layer: t, at: 5000 })).toEqual(none);
  });

  it('any other slide taken off, or Clear all (nothing leaving), goes at once', () => {
    const a = layer('a', 1000, { kind: 'dissolve', durationMs: 600 });
    expect(nextShowing({ on: a, off: null, fade: null }, null, 5010, { layer: a, at: 5000 })).toEqual(none);
    const t = timer(1000);
    expect(nextShowing({ on: t, off: null, fade: null }, null, 5010, null)).toEqual(none);
    // Another timer than the one on this screen: not this one's out.
    const other = { ...timer(2000), slide: { ...t.slide, id: 'timer:t2' } };
    expect(nextShowing({ on: t, off: null, fade: null }, null, 5010, { layer: other, at: 5000 })).toEqual(
      none,
    );
  });
});

describe('a deck’s slide coming in by a cut (Session 54, C2)', () => {
  it('keeps the slide before up until its clip can be drawn, then cuts; any other slide cuts at once', () => {
    const a = layer('a', 1000);
    const shown = nextShowing(none, a, 1000);
    const deck: SlideLayer = {
      ...layer('d', 2000),
      slide: {
        ...layer('d', 2000).slide,
        deck: { steps: [{ clipId: 'c0', clipMs: 1000, lastId: 'l0' }], media: [] },
      },
      step: 0,
      stepAt: 2000,
    };
    expect(nextShowing(shown, deck, 2010)).toEqual({
      on: deck,
      off: a,
      fade: { kind: 'cut', ms: 1, start: null },
    });
    // The first slide up, or one heard of long after it came: just shown.
    expect(nextShowing(none, deck, 2010)).toEqual({ on: deck, off: null, fade: null });
    expect(nextShowing(shown, deck, 9000)).toEqual({ on: deck, off: null, fade: null });
    // Its next step is the same slide: nothing waits, nothing fades.
    const stepped = nextShowing(
      { on: deck, off: null, fade: null },
      { ...deck, step: 1, stepAt: 3000 },
      3000,
    );
    expect(stepped.fade).toBeNull();
  });
});

/** A slide's box on a screen, as the paint writes it (no page in a unit test: its inline style only). */
const box = (): HTMLDivElement =>
  ({
    style: { opacity: '', transform: '', clipPath: '', maskImage: '', filter: '', zIndex: '' },
  }) as unknown as HTMLDivElement;
const deckPaint = (native: DeckNativeTransition): Paint => ({
  kind: native.kind,
  native,
  movement: 'calm',
  move: null,
  width: 1920,
  height: 1080,
  scaleIn: 1,
  scaleOut: 1,
});
const layersOf = (coming: HTMLDivElement, going: HTMLDivElement): Layers => ({
  in: coming,
  out: going,
  black: null,
  wordsIn: null,
  wordsOut: null,
});

describe('Back during a deck’s own transition (TX-1, review-p3tr LOW-1)', () => {
  it('the slide that was coming in stays up whole, as it is at rest, while the slide gone back to waits for its clip', () => {
    for (const deckEffect of ['push', 'cover', 'uncover', 'wipe', 'zoom'] as const)
      for (const direction of ['left', 'up'] as const) {
        const native: DeckNativeTransition = {
          kind: deckEffect === 'wipe' ? 'wipe' : deckEffect === 'zoom' ? 'zoom-dissolve' : 'slide',
          deckEffect,
          durationMs: 700,
          direction,
        };
        const coming = box();
        const going = box();
        paintLayers(layersOf(coming, going), deckPaint(native), 0.4);
        // Back part-way: the slide that was coming in is now the one up, the slide gone back to (a deck's, by a cut)
        // unseen until its clip can be drawn.
        const back = box();
        paintWaiting({ in: back, out: coming });
        expect(coming.style, `${deckEffect} ${direction}`).toEqual({
          opacity: '',
          transform: '',
          clipPath: '',
          maskImage: '',
          filter: '',
          zIndex: '',
        });
        expect(back.style.opacity, `${deckEffect} ${direction}`).toBe('0');
      }
  });
});

/** A slide's two band boxes (Session 58, C2) as the JSX leaves them: filling the slide's box, nothing else. */
const bandBoxes = (): BandBoxes => ({
  holder: {
    style: { inset: '0', width: '', height: '', maskImage: '', transform: '', willChange: '', overflow: '' },
  } as unknown as HTMLDivElement,
  slide: {
    style: { inset: '0', width: '', height: '', maskImage: '', transform: '', willChange: '', overflow: '' },
  } as unknown as HTMLDivElement,
});
const AT_REST = {
  inset: '0',
  width: '',
  height: '',
  maskImage: '',
  transform: '',
  willChange: '',
  overflow: '',
};

describe('a deck’s own Wipe drawn on a screen: PowerPoint’s band (Session 58, C2)', () => {
  it('the incoming slide’s band boxes are the band while it runs (no clip or mask on the slide), at rest once over; the outgoing slide’s never move', () => {
    for (const direction of ['left', 'right', 'up', 'down'] as const) {
      const native: DeckNativeTransition = { kind: 'wipe', deckEffect: 'wipe', durationMs: 700, direction };
      const coming = box();
      const going = box();
      const bandIn = bandBoxes();
      const bandOut = bandBoxes();
      const els = { ...layersOf(coming, going), bandIn, bandOut };
      for (const p of [0, 0.3, 0.5, 0.9]) {
        paintLayers(els, deckPaint(native), p);
        const band = deckTransitionFrame(native, p).in.band;
        if (!band) throw new Error('no band');
        const want = wipeBandStyles(band, 1920, 1080, 1);
        expect(bandIn.holder?.style, `${direction} at ${String(p)}`).toEqual({
          ...want.holder,
          willChange: 'transform',
          overflow: 'hidden',
        });
        expect(bandIn.slide?.style, `${direction} at ${String(p)}`).toEqual({
          ...AT_REST,
          ...want.slide,
          willChange: 'transform',
        });
        expect([coming.style.clipPath, coming.style.maskImage, coming.style.transform]).toEqual(['', '', '']);
        expect(bandOut.holder?.style).toEqual(AT_REST);
        expect(bandOut.slide?.style).toEqual(AT_REST);
      }
      paintLayers(els, deckPaint(native), 1);
      expect(bandIn.holder?.style, `${direction} over`).toEqual(AT_REST);
      expect(bandIn.slide?.style, `${direction} over`).toEqual(AT_REST);
      // Not in a transition: at rest too.
      paintLayers(els, { ...deckPaint(native), kind: null, native: undefined }, 0);
      expect(bandIn.holder?.style).toEqual(AT_REST);
    }
  });

  it('Back during it: the slide that was coming in is drawn whole, its band boxes at rest (TX-1)', () => {
    const native: DeckNativeTransition = {
      kind: 'wipe',
      deckEffect: 'wipe',
      durationMs: 700,
      direction: 'up',
    };
    const coming = box();
    const bandIn = bandBoxes();
    paintLayers({ ...layersOf(coming, box()), bandIn, bandOut: bandBoxes() }, deckPaint(native), 0.6);
    expect(bandIn.holder?.style.maskImage).not.toBe('');
    paintWaiting({ in: box(), out: coming, bandIn: bandBoxes(), bandOut: bandIn });
    expect(bandIn.holder?.style).toEqual(AT_REST);
    expect(bandIn.slide?.style).toEqual(AT_REST);
  });
});
