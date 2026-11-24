import { afterEach, describe, expect, it } from 'vitest';
import type { DeckNativeTransition } from '../../../shared/deck-transition';
import type { SlideLayer } from '../../../shared/engine/state';
import {
  fadeAt,
  firstShowing,
  type Layers,
  nextShowing,
  type Paint,
  paintLayers,
  paintWaiting,
} from './SlideLayerView';
import { setDrawsWithoutChip } from './chipless';
import { deckTransitionFrame, deckWipeShows, wipeSlideClip, wipeSlideMask } from './transition-frame';

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
/** The incoming slide's place in the layer's box: the whole 1920 x 1080 screen, unless said. */
const FULL = { x: 0, y: 0, width: 1920, height: 1080 };
const deckPaint = (native: DeckNativeTransition, placeIn = FULL, placeOut = placeIn): Paint => ({
  kind: native.kind,
  native,
  movement: 'calm',
  move: null,
  width: 1920,
  height: 1080,
  scaleIn: 1,
  scaleOut: 1,
  placeIn,
  placeOut,
});
const layersOf = (coming: HTMLDivElement, going: HTMLDivElement): Layers => ({
  in: coming,
  out: going,
  black: null,
  wordsIn: null,
  wordsOut: null,
});

/** A slide's shade box (X11) as the JSX leaves it: around what the slide draws, no filter. */
const shadeBox = (): HTMLDivElement => ({ style: { filter: '' } }) as unknown as HTMLDivElement;

describe('a deck’s own Wipe drawn on a screen with a graphics chip: PowerPoint’s band as a mask on the slide’s box (Session 58)', () => {
  afterEach(() => {
    setDrawsWithoutChip(false);
  });

  it('the incoming slide’s box takes the band’s mask, a new one each frame; the outgoing slide stays as it is; none once over', () => {
    const bars = { x: 240, y: 0, width: 1440, height: 1080 };
    for (const placeIn of [FULL, bars])
      for (const direction of ['left', 'right', 'up', 'down'] as const) {
        const native: DeckNativeTransition = { kind: 'wipe', deckEffect: 'wipe', durationMs: 700, direction };
        const coming = box();
        const going = box();
        const els = { ...layersOf(coming, going), shadeIn: shadeBox(), shadeOut: shadeBox() };
        for (const p of [0, 0.3, 0.5, 0.9]) {
          paintLayers(els, deckPaint(native, placeIn), p);
          const band = deckTransitionFrame(native, p).in.band;
          if (!band) throw new Error('no band');
          const what = `${direction} at ${String(p)}`;
          expect(coming.style.maskImage, what).toBe(
            wipeSlideMask(band, placeIn, { width: 1920, height: 1080 }),
          );
          expect([coming.style.clipPath, coming.style.transform], what).toEqual(['', '']);
          expect([going.style.transform, going.style.maskImage], what).toEqual(['', '']);
          expect([els.shadeIn.style.filter, els.shadeOut.style.filter], what).toEqual(['', '']);
        }
        paintLayers(els, deckPaint(native, placeIn), 1);
        expect(coming.style.maskImage, `${direction} over`).toBe('');
      }
  });
});

describe('a deck’s own Push on a 4:3 slide fitted to a 16:9 screen (Session 58, Q58-16)', () => {
  it('a slide that fills the screen moves exactly as before (in % of the layer), as phase1 draws it', () => {
    for (const deckEffect of ['push', 'cover', 'uncover'] as const) {
      const native: DeckNativeTransition = { kind: 'slide', deckEffect, durationMs: 700, direction: 'left' };
      for (const p of [0.25, 0.5, 0.75]) {
        const coming = box();
        const going = box();
        paintLayers(layersOf(coming, going), deckPaint(native), p);
        const before = deckTransitionFrame(native, p);
        expect([coming.style.transform, going.style.transform], `${deckEffect} at ${String(p)}`).toEqual([
          before.in.transform,
          before.out.transform,
        ]);
      }
    }
  });

  it('under Drashti’s own transition set over the deck’s, the slides move as before, in % of the layer (review MEDIUM-1)', () => {
    const bars = { x: 240, y: 0, width: 1440, height: 1080 };
    for (const deckEffect of ['push', 'cover', 'uncover'] as const)
      for (const over of [
        { kind: 'dissolve' as const, durationMs: 700 },
        { kind: 'fade-black' as const, durationMs: 700 },
      ]) {
        const native: DeckNativeTransition = {
          kind: 'slide',
          deckEffect,
          durationMs: 700,
          direction: 'left',
          over,
        };
        for (const p of [0.1, 0.5, 0.97]) {
          const coming = box();
          const going = box();
          paintLayers(layersOf(coming, going), deckPaint(native, bars), p);
          const before = deckTransitionFrame(native, p);
          expect(
            [coming.style.transform, going.style.transform],
            `${deckEffect} over ${over.kind} at ${String(p)}`,
          ).toEqual([before.in.transform, before.out.transform]);
        }
      }
  });

  it('a slide within a pixel of filling the screen moves as before (review LOW-2): a 16:9 deck on a 1366 x 768 screen', () => {
    const near = { x: 0.33333, y: 0, width: 1365.33333, height: 768 };
    const native: DeckNativeTransition = {
      kind: 'slide',
      deckEffect: 'push',
      durationMs: 700,
      direction: 'left',
    };
    const coming = box();
    const going = box();
    paintLayers(layersOf(coming, going), { ...deckPaint(native, near), width: 1366, height: 768 }, 0.5);
    const before = deckTransitionFrame(native, 0.5);
    expect([coming.style.transform, going.style.transform]).toEqual([
      before.in.transform,
      before.out.transform,
    ]);
  });

  it('both slides move by the slide’s own width in px', () => {
    const bars = { x: 240, y: 0, width: 1440, height: 1080 };
    const native: DeckNativeTransition = {
      kind: 'slide',
      deckEffect: 'push',
      durationMs: 700,
      direction: 'left',
    };
    const coming = box();
    const going = box();
    paintLayers(layersOf(coming, going), deckPaint(native, bars), 0.5);
    // Half-way (eased in and out: half): the slide going half its width out, the one coming half its width in.
    expect(going.style.transform).toBe('translateX(-720px)');
    expect(coming.style.transform).toBe('translateX(720px)');
  });
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

describe('a deck’s own Wipe drawn on a screen without a graphics chip: the band’s mask on the slide’s box as with one, the outgoing slide a still layer of its own (X11)', () => {
  afterEach(() => {
    setDrawsWithoutChip(false);
  });
  /** The outgoing slide a layer of its own that does not move: so only the incoming slide is drawn again each frame. */
  const STILL = 'translate3d(0px, 0px, 0px)';
  const CANVAS = { width: 1920, height: 1080 };

  it('the incoming slide’s box takes the band’s mask, a new one each frame, as with a chip; the outgoing slide is a still layer of its own while it runs; nothing of either once over', () => {
    setDrawsWithoutChip(true);
    // A 16:9 slide filling the screen, and a 4:3 one fitted to it (bars either side).
    for (const placeIn of [FULL, { x: 240, y: 0, width: 1440, height: 1080 }])
      for (const direction of ['left', 'right', 'up', 'down'] as const) {
        const native: DeckNativeTransition = { kind: 'wipe', deckEffect: 'wipe', durationMs: 700, direction };
        const coming = box();
        const going = box();
        const els = { ...layersOf(coming, going), shadeIn: shadeBox(), shadeOut: shadeBox() };
        for (const p of [0, 0.3, 0.5, 0.9]) {
          paintLayers(els, deckPaint(native, placeIn), p);
          const band = deckTransitionFrame(native, p).in.band;
          if (!band) throw new Error('no band');
          const what = `${direction} at ${String(p)}`;
          expect(coming.style.maskImage, what).toBe(wipeSlideMask(band, placeIn, CANVAS));
          expect([coming.style.clipPath, coming.style.transform], what).toEqual([
            wipeSlideClip(band, placeIn, CANVAS),
            '',
          ]);
          expect([going.style.transform, going.style.maskImage, going.style.clipPath], what).toEqual([
            STILL,
            '',
            '',
          ]);
          expect([els.shadeIn.style.filter, els.shadeOut.style.filter], what).toEqual(['', '']);
        }
        paintLayers(els, deckPaint(native, placeIn), 1);
        expect([coming.style.maskImage, going.style.transform], `${direction} over`).toEqual(['', '']);
        // Not in a transition: nothing of it.
        paintLayers(els, { ...deckPaint(native), kind: null, native: undefined }, 0);
        expect([coming.style.maskImage, going.style.transform]).toEqual(['', '']);
      }
  });

  it('a page told part-way that it draws without a chip keeps the band’s mask on the slide’s box and makes the outgoing slide a still layer', () => {
    const native: DeckNativeTransition = {
      kind: 'wipe',
      deckEffect: 'wipe',
      durationMs: 700,
      direction: 'left',
    };
    const coming = box();
    const going = box();
    const els = layersOf(coming, going);
    paintLayers(els, deckPaint(native), 0.3);
    expect([coming.style.maskImage === '', going.style.transform]).toEqual([false, '']);
    setDrawsWithoutChip(true);
    paintLayers(els, deckPaint(native), 0.4);
    const band = deckTransitionFrame(native, 0.4).in.band;
    if (!band) throw new Error('no band');
    expect([coming.style.maskImage, going.style.transform]).toEqual([
      wipeSlideMask(band, FULL, CANVAS),
      STILL,
    ]);
  });

  it('under Drashti’s own transition set over the deck’s, the outgoing slide moves as that transition has it (no still layer)', () => {
    setDrawsWithoutChip(true);
    for (const kind of ['slide', 'dissolve'] as const) {
      const native: DeckNativeTransition = {
        kind: 'wipe',
        deckEffect: 'wipe',
        durationMs: 700,
        direction: 'left',
        over: { kind, durationMs: 700 },
      };
      const going = box();
      paintLayers(layersOf(box(), going), deckPaint(native), 0.5);
      expect(going.style.transform, kind).toBe(deckTransitionFrame(native, 0.5).out.transform);
    }
  });

  it('the incoming slide’s box is clipped where its band’s mask shows nothing (past the band’s far end), in whole px; nowhere once the band reaches across', () => {
    setDrawsWithoutChip(true);
    const bars = { x: 240, y: 0, width: 1440, height: 1080 };
    for (const placeIn of [FULL, bars])
      for (const direction of ['left', 'right', 'up', 'down'] as const) {
        const native: DeckNativeTransition = { kind: 'wipe', deckEffect: 'wipe', durationMs: 700, direction };
        const across = direction === 'left' || direction === 'right';
        // The edge of the layer the band comes from, and the slide's own length along the band.
        const length = across ? placeIn.width : placeIn.height;
        const start = across ? placeIn.x : placeIn.y;
        const screen = across ? 1920 : 1080;
        const fromEnd = direction === 'left' || direction === 'up';
        for (const p of [0, 0.2, 0.3, 0.45, 0.5, 0.7, 0.9]) {
          const coming = box();
          paintLayers(layersOf(coming, box()), deckPaint(native, placeIn), p);
          const what = `${String(placeIn.width)} wide, ${direction} at ${String(p)}`;
          const m = /^inset\((\d+)px (\d+)px (\d+)px (\d+)px\)$/u.exec(coming.style.clipPath);
          const cuts = m ? m.slice(1).map(Number) : [0, 0, 0, 0];
          if (!m) expect(coming.style.clipPath, what).toBe('');
          // Only the far side is cut: left for a Wipe from the right, right from the left, top from the bottom, bottom
          // from the top.
          const far = { left: 3, right: 1, up: 0, down: 2 }[direction];
          cuts.forEach((cut, i) => {
            if (i !== far) expect(cut, what).toBe(0);
          });
          const cut = cuts[far] ?? 0;
          // Where the cut ends, as a share of the slide from its own side: the band shows nothing from there on, and
          // no more than a pixel of nothing is left uncut.
          const edge = fromEnd ? cut : screen - cut;
          const at = (fromEnd ? start + length - edge : edge - start) / length;
          if (cut > 0) expect(deckWipeShows(native, p, at), what).toBe(0);
          const firstNothing = [...Array(2001).keys()]
            .map((i) => i / 1000 - 0.5)
            .find((a) => deckWipeShows(native, p, a) === 0);
          if (
            firstNothing !== undefined &&
            firstNothing < (fromEnd ? (start + length) / length : (screen - start) / length) - 2 / length
          )
            expect(at - firstNothing, what).toBeLessThanOrEqual(1 / length + 1e-9);
          else expect(cut, what).toBe(0);
        }
      }
  });

  it('no clip with a graphics chip or under Drashti’s own transition set over the deck’s', () => {
    const native: DeckNativeTransition = {
      kind: 'wipe',
      deckEffect: 'wipe',
      durationMs: 700,
      direction: 'left',
    };
    const coming = box();
    paintLayers(layersOf(coming, box()), deckPaint(native), 0.2);
    expect(coming.style.clipPath).toBe('');
    setDrawsWithoutChip(true);
    const over: DeckNativeTransition = { ...native, over: { kind: 'dissolve', durationMs: 700 } };
    paintLayers(layersOf(coming, box()), deckPaint(over), 0.2);
    expect(coming.style.clipPath).toBe(deckTransitionFrame(over, 0.2).in.clip ?? '');
  });

  it('Back during it: the slide that was coming in is drawn whole, no mask and no layer left on it (TX-1)', () => {
    setDrawsWithoutChip(true);
    const native: DeckNativeTransition = {
      kind: 'wipe',
      deckEffect: 'wipe',
      durationMs: 700,
      direction: 'up',
    };
    const coming = box();
    const going = box();
    paintLayers(layersOf(coming, going), deckPaint(native), 0.6);
    expect([coming.style.maskImage === '', going.style.transform]).toEqual([false, STILL]);
    paintWaiting({ in: box(), out: coming });
    expect([coming.style.maskImage, coming.style.transform]).toEqual(['', '']);
  });
});

describe('a deck’s own Push, Cover and Uncover drawn on a screen without a graphics chip: each moving slide a layer of its own, moved in whole device pixels (X11)', () => {
  afterEach(() => {
    setDrawsWithoutChip(false);
  });
  /** A 4:3 slide fitted to a 16:9 screen: bars either side. */
  const BARS = { x: 240, y: 0, width: 1440, height: 1080 };
  /** Device pixels a canvas pixel: CI's hall screen (1024 wide), the stream's page (1920), the operator's LIVE (342). */
  const SCALES = [1024 / 1920, 1, 342 / 1920];
  /** The model's move (phase1 draws it) in canvas px: px of the slide where it is placed, else % of the layer's box. */
  const modelPx = (transform: string, along: number): number => {
    const m = /^translate[XY]\((-?[\d.e+-]+)(px|%)\)$/u.exec(transform);
    if (!m) throw new Error(`not a move: ${transform}`);
    return m[2] === '%' ? (Number(m[1]) / 100) * along : Number(m[1]);
  };
  const LAYER = /^translate3d\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px, 0px\)$/u;
  const paint = (native: DeckNativeTransition, place: typeof FULL, k: number | undefined, p: number) => {
    const coming = box();
    const going = box();
    const shadeIn = shadeBox();
    const shadeOut = shadeBox();
    paintLayers(
      { ...layersOf(coming, going), shadeIn, shadeOut },
      { ...deckPaint(native, place), ...(k === undefined ? {} : { devicePerCanvas: k }) },
      p,
    );
    return { coming, going, shadeIn, shadeOut };
  };

  it('moves each moving slide by a 3D translation in whole device pixels, within half a device pixel of PowerPoint’s move, its shade inside it', () => {
    setDrawsWithoutChip(true);
    for (const k of SCALES)
      for (const deckEffect of ['push', 'cover', 'uncover'] as const)
        for (const direction of ['left', 'up'] as const)
          for (const place of [FULL, BARS]) {
            const native: DeckNativeTransition = { kind: 'slide', deckEffect, durationMs: 700, direction };
            const along = direction === 'left' ? 1920 : 1080;
            for (const p of [0.2, 0.5, 0.83]) {
              const { coming, going, shadeIn, shadeOut } = paint(native, place, k, p);
              const model = deckTransitionFrame(
                native,
                p,
                'calm',
                place === FULL ? undefined : { in: place, out: place },
              );
              const what = `${deckEffect} ${direction} ${String(place.width)} wide, ${k.toFixed(3)} a px, at ${String(p)}`;
              for (const [el, f, shade] of [
                [coming, model.in, shadeIn],
                [going, model.out, shadeOut],
              ] as const) {
                expect(el.style.filter, what).toBe('');
                expect(shade.style.filter, what).toBe(f.filter ?? '');
                if (f.transform === '') {
                  expect(el.style.transform, what).toBe('');
                  continue;
                }
                const m = LAYER.exec(el.style.transform);
                if (!m) throw new Error(`${what}: not a layer's move: ${el.style.transform}`);
                const [x, y] = [Number(m[1]), Number(m[2])];
                const moved = direction === 'left' ? x : y;
                expect(direction === 'left' ? y : x, what).toBe(0);
                expect(Math.abs(moved * k - Math.round(moved * k)), what).toBeLessThan(1e-6);
                expect(Math.abs(moved - modelPx(f.transform, along)), what).toBeLessThanOrEqual(
                  0.5 / k + 1e-9,
                );
              }
            }
          }
  });

  it('draws as before where the move has not begun or is over, with a graphics chip, under Drashti’s own transition set over the deck’s, and where the screen’s pixels are not known', () => {
    const native: DeckNativeTransition = {
      kind: 'slide',
      deckEffect: 'cover',
      durationMs: 700,
      direction: 'left',
    };
    const asBefore = (
      drawn: ReturnType<typeof paint>,
      model: ReturnType<typeof deckTransitionFrame>,
      what: string,
    ) => {
      expect([drawn.coming.style.transform, drawn.going.style.transform], what).toEqual([
        model.in.transform,
        model.out.transform,
      ]);
      expect([drawn.coming.style.filter, drawn.going.style.filter], what).toEqual([
        model.in.filter ?? '',
        model.out.filter ?? '',
      ]);
      expect([drawn.shadeIn.style.filter, drawn.shadeOut.style.filter], what).toEqual(['', '']);
    };
    setDrawsWithoutChip(true);
    for (const p of [0, 1])
      asBefore(paint(native, FULL, 1024 / 1920, p), deckTransitionFrame(native, p), `at ${String(p)}`);
    asBefore(
      paint(native, FULL, undefined, 0.5),
      deckTransitionFrame(native, 0.5),
      'the screen’s pixels not known',
    );
    const over: DeckNativeTransition = { ...native, over: { kind: 'dissolve', durationMs: 700 } };
    asBefore(paint(over, FULL, 1024 / 1920, 0.5), deckTransitionFrame(over, 0.5), 'under a dissolve');
    setDrawsWithoutChip(false);
    asBefore(paint(native, FULL, 1024 / 1920, 0.5), deckTransitionFrame(native, 0.5), 'with a chip');
  });

  it('Back part-way: the slide that was coming in is drawn whole, no layer’s move and no shade left on it or inside it (TX-1)', () => {
    setDrawsWithoutChip(true);
    for (const deckEffect of ['push', 'cover'] as const) {
      const native: DeckNativeTransition = { kind: 'slide', deckEffect, durationMs: 700, direction: 'left' };
      const { coming, shadeIn } = paint(native, FULL, 1024 / 1920, 0.4);
      expect(coming.style.transform, deckEffect).toMatch(LAYER);
      if (deckEffect === 'cover') expect(shadeIn.style.filter).toBe('brightness(0.986)');
      paintWaiting({ in: box(), out: coming, shadeOut: shadeIn });
      expect([coming.style.transform, coming.style.filter, shadeIn.style.filter], deckEffect).toEqual([
        '',
        '',
        '',
      ]);
    }
  });
});

describe('a deck’s own moving slide backed without a graphics chip when it is known opaque (X11, Q60-6)', () => {
  afterEach(() => {
    setDrawsWithoutChip(false);
  });
  /** A box as the JSX leaves it (inset 0), with what the backing writes. */
  const placedBox = (): HTMLDivElement =>
    ({
      style: {
        opacity: '',
        transform: '',
        clipPath: '',
        maskImage: '',
        filter: '',
        zIndex: '',
        backgroundColor: '',
      },
    }) as unknown as HTMLDivElement;
  const BARS = { x: 240, y: 0, width: 1440, height: 1080 };
  /** CI's hall screen: 1024 device pixels for the 1920 canvas pixels (the 4:3 slide's place lands on whole ones). */
  const HALL = 1024 / 1920;
  const paint = (
    native: DeckNativeTransition,
    place: typeof FULL,
    p: number,
    backing: { in?: string; out?: string },
    k: number | null = HALL,
  ) => {
    const coming = placedBox();
    const going = placedBox();
    const shadeIn = shadeBox();
    const shadeOut = shadeBox();
    const els = { ...layersOf(coming, going), shadeIn, shadeOut };
    const how: Paint = {
      ...deckPaint(native, place),
      ...(k === null ? {} : { devicePerCanvas: k }),
      ...(backing.in === undefined ? {} : { backingIn: backing.in }),
      ...(backing.out === undefined ? {} : { backingOut: backing.out }),
    };
    paintLayers(els, how, p);
    return { coming, going, shadeIn, shadeOut, els, how };
  };
  const geometry = (el: HTMLDivElement) => {
    const s = el.style as unknown as Record<string, string | undefined>;
    return [s['left'], s['top'], s['width'], s['height']];
  };
  const push = (deckEffect: 'push' | 'cover' | 'uncover'): DeckNativeTransition => ({
    kind: 'slide',
    deckEffect,
    durationMs: 700,
    direction: 'left',
  });

  it('a slide on a layer of its own is backed by its colour while it moves, in its place only; nothing once over', () => {
    setDrawsWithoutChip(true);
    const both = { in: '#102030', out: '#000000' };
    const mid = paint(push('push'), FULL, 0.5, both);
    expect([mid.coming.style.backgroundColor, mid.going.style.backgroundColor]).toEqual([
      '#102030',
      '#000000',
    ]);
    // A slide filling the screen: its box is its place already, left as it is.
    expect(geometry(mid.coming)).toEqual([undefined, undefined, undefined, undefined]);
    // Cover moves the incoming slide alone, Uncover the outgoing: only the moving one is a layer, and backed.
    const cover = paint(push('cover'), FULL, 0.5, both);
    expect([cover.coming.style.backgroundColor, cover.going.style.backgroundColor]).toEqual(['#102030', '']);
    const uncover = paint(push('uncover'), FULL, 0.5, both);
    expect([uncover.coming.style.backgroundColor, uncover.going.style.backgroundColor]).toEqual([
      '',
      '#000000',
    ]);
    // Over (and before it starts): nothing of it.
    paintLayers(mid.els, mid.how, 1);
    expect([mid.coming.style.backgroundColor, mid.going.style.backgroundColor]).toEqual(['', '']);
  });

  it('a 4:3 slide between bars: its layer is its own place, its drawing kept where it was, so the bars stay as they are', () => {
    setDrawsWithoutChip(true);
    const mid = paint(push('push'), BARS, 0.5, { in: '#102030', out: '#000000' });
    for (const [box, shade] of [
      [mid.coming, mid.shadeIn],
      [mid.going, mid.shadeOut],
    ] as const) {
      expect(geometry(box)).toEqual(['240px', '0px', '1440px', '1080px']);
      expect(geometry(shade)).toEqual(['-240px', '0px', '1920px', '1080px']);
    }
    // Over: the boxes fill the screen again, as the JSX has them (inset 0).
    paintLayers(mid.els, mid.how, 1);
    for (const el of [mid.coming, mid.going, mid.shadeIn, mid.shadeOut])
      expect(geometry(el)).toEqual(['0px', '0px', '', '']);
    expect([mid.coming.style.backgroundColor, mid.going.style.backgroundColor]).toEqual(['', '']);
  });

  it('the Wipe’s outgoing slide, a still layer of its own, is backed; the masked incoming slide never', () => {
    setDrawsWithoutChip(true);
    const wipe: DeckNativeTransition = {
      kind: 'wipe',
      deckEffect: 'wipe',
      durationMs: 700,
      direction: 'left',
    };
    for (const place of [FULL, BARS]) {
      const mid = paint(wipe, place, 0.4, { in: '#102030', out: '#000000' });
      expect([mid.coming.style.backgroundColor, mid.going.style.backgroundColor]).toEqual(['', '#000000']);
      expect(geometry(mid.going)).toEqual(
        place === FULL ? [undefined, undefined, undefined, undefined] : ['240px', '0px', '1440px', '1080px'],
      );
    }
  });

  it('never a slide not known opaque, with a graphics chip, under Drashti’s own transition, or off whole device pixels', () => {
    const both = { in: '#102030', out: '#000000' };
    // With a chip.
    let drawn = paint(push('push'), BARS, 0.5, both);
    expect([drawn.coming.style.backgroundColor, drawn.going.style.backgroundColor]).toEqual(['', '']);
    expect(geometry(drawn.coming)).toEqual([undefined, undefined, undefined, undefined]);
    setDrawsWithoutChip(true);
    // A see-through slide (no backing known): nothing, whatever moves.
    drawn = paint(push('push'), BARS, 0.5, {});
    expect([drawn.coming.style.backgroundColor, drawn.going.style.backgroundColor]).toEqual(['', '']);
    expect(geometry(drawn.coming)).toEqual([undefined, undefined, undefined, undefined]);
    // Under Drashti's own transition set over the deck's.
    const over: DeckNativeTransition = { ...push('push'), over: { kind: 'dissolve', durationMs: 700 } };
    drawn = paint(over, FULL, 0.5, both);
    expect([drawn.coming.style.backgroundColor, drawn.going.style.backgroundColor]).toEqual(['', '']);
    // A screen where the slide's place does not land on whole device pixels (1366 wide: 240 canvas px is 170.75), or
    // where they are not known: its edge could show the colour, so none.
    for (const k of [1366 / 1920, null]) {
      drawn = paint(push('push'), BARS, 0.5, both, k);
      expect([drawn.coming.style.backgroundColor, drawn.going.style.backgroundColor]).toEqual(['', '']);
      expect(geometry(drawn.going)).toEqual([undefined, undefined, undefined, undefined]);
    }
  });

  it('Back part-way: the slide that was coming in is drawn whole, no backing left on it and its box where it was', () => {
    setDrawsWithoutChip(true);
    const mid = paint(push('push'), BARS, 0.4, { in: '#102030', out: '#000000' });
    expect(mid.coming.style.backgroundColor).toBe('#102030');
    paintWaiting({ in: placedBox(), out: mid.coming, shadeOut: mid.shadeIn });
    expect(mid.coming.style.backgroundColor).toBe('');
    expect(geometry(mid.coming)).toEqual(['0px', '0px', '', '']);
    expect(geometry(mid.shadeIn)).toEqual(['0px', '0px', '', '']);
  });
});

describe('the stream’s page draws a slide only once its pictures can be drawn (Session 58, Q57-35)', () => {
  const wait = (by: number) => ({ kind: 'cut' as const, ms: 1, start: null, picturesBy: by });

  it('a slide cut in waits for its pictures, keeping what is on screen; the hall’s screens cut at once', () => {
    const a = layer('a', 1000);
    const shown = { on: a, off: null, fade: null };
    const b = layer('b', 2000);
    expect(nextShowing(shown, b, 2010, null, true)).toEqual({ on: b, off: a, fade: wait(5010) });
    expect(nextShowing(shown, b, 2010)).toEqual({ on: b, off: null, fade: null });
    // The first slide up waits on nothing shown; a cut with no length too.
    expect(nextShowing(none, b, 2010, null, true)).toEqual({ on: b, off: null, fade: wait(5010) });
    const noLength = layer('b', 2000, { kind: 'slide', durationMs: 0 });
    expect(nextShowing(shown, noLength, 2010, null, true).fade).toEqual(wait(5010));
    // Heard of long after it came (a dissolve over by then): it still waits for its pictures, from now.
    const late = layer('b', 2000, { kind: 'dissolve', durationMs: 800 });
    expect(nextShowing(shown, late, 9000, null, true)).toEqual({ on: late, off: a, fade: wait(12000) });
  });

  it('a transition waits for its pictures as before, and a cut cut in while another waits goes from what is on screen', () => {
    const a = layer('a', 1000);
    const b = layer('b', 2000, { kind: 'dissolve', durationMs: 800 });
    expect(nextShowing({ on: a, off: null, fade: null }, b, 2010, null, true)).toEqual({
      on: b,
      off: a,
      fade: { kind: 'dissolve', ms: 800, start: null },
    });
    const waiting = { on: layer('b', 2000), off: a, fade: wait(5010) };
    const c = layer('c', 2100);
    expect(nextShowing(waiting, c, 2110, null, true)).toEqual({ on: c, off: a, fade: wait(5110) });
    // The same slide with new content keeps waiting; taken off, it goes at once.
    const edited = { ...layer('b', 2000), notes: 'Placeholder note' };
    expect(nextShowing(waiting, edited, 2110, null, true)).toEqual({ ...waiting, on: edited });
    expect(nextShowing(waiting, null, 2110, null, true)).toEqual(none);
  });

  it('a page that comes along later draws the slide up only once its pictures can be drawn; a hall screen at once', () => {
    const a = layer('a', 1000);
    expect(firstShowing(a, 60_000, true)).toEqual({
      on: a,
      off: null,
      fade: { ...wait(63_000), initial: true },
    });
    expect(firstShowing(a, 60_000)).toEqual({ on: a, off: null, fade: null });
    expect(firstShowing(null, 60_000, true)).toEqual(none);
  });
});
