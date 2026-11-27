import { describe, expect, it } from 'vitest';
import { nativeDeckMotion } from '../../../shared/deck';
import {
  deckEffectsByTarget,
  deckMotionFrame,
  deckTargetBounds,
  deckWipeInnerMask,
  deckWipeMask,
} from '../../../shared/deck-motion';
import { nativeStepTiming } from '../../../shared/deck-show';
import { isDeckNativeTransition } from '../../../shared/deck-transition';
import type { SlideLayer } from '../../../shared/engine/state';
import { MOVEMENTS } from '../../../shared/looks';
import { TRANSITION_KINDS } from '../../../shared/model';
import { OPENING_START_HOLD_MS } from '../../../shared/opening';
import { deckTransitionFrame, deckWipeShows, wipeSlideMask } from './transition-frame';
import {
  handOverWarmUp,
  paintedCoverPlace,
  type WarmScene,
  type WarmUpEnd,
  WARM_UP_LONGEST_MS,
  warmScenes,
} from './WarmUp';

/*
 * The GPU's warm-up (render/WarmUp.tsx; tests/e2e/warm-up.spec.ts looks at it drawn): before a screen with a graphics
 * chip first draws the show, it draws what a show draws, part-way, so the GPU makes each new kind of drawing (a
 * "pipeline") then and not at the show's first (100-600 ms each on CI's Mac, every screen waiting). A deck Drashti
 * plays itself draws two kinds nothing else does (13 Nov 2026, the review of h-p3tr's part B): its own Cover (and
 * Uncover), the slide it moves a shade darker, a filter; and a Split, a gradient mask the size of its shape, of 4, 5 or
 * 6 stops as it goes (a GPU draws a gradient of up to 4 stops, of up to 8 and of more each its own way); and since
 * Session 58 its own Wipe, PowerPoint's soft band: with a graphics chip (the only place the warm-up runs) a gradient
 * mask of 21 stops over the slide coming in. Since Session 58 a Shape draws three more (C1): a radial gradient (a
 * Circle), and a straight ramp over two half-planes laid on one another by `exclude`, on the shape and again on an
 * element within it (a Box, a Plus, a Diamond); the Cover's slide going draws them. Placeholder slides only.
 */

/** The engine's time as the warm-up's slides before go up (it draws everything part-way a few frames later). */
const BEFORE = 1_800_000_000_000;

const scene = (key: string): WarmScene => {
  const found = warmScenes().find((s) => s.key === key);
  if (!found) throw new Error(`no warm-up scene ${key}`);
  return found;
};

/** A scene's slide layer: what is up before (`during` false), or what comes in part-way. */
function slideOf(s: WarmScene, during: boolean, at: number): SlideLayer {
  const layer = s.state(during, at).layers.slide;
  if (!layer) throw new Error(`${s.key}: no slide`);
  return layer;
}

/** How many stops a CSS gradient has. */
const stops = (gradient: string) => gradient.match(/rgba?\(/gu)?.length ?? 0;

/** A scene's deck transition part-way (the warm-up's moment `at`), as every screen draws it. */
function deckFrameOf(key: string, at: number) {
  const coming = slideOf(scene(key), true, at);
  const t = coming.transition;
  if (!isDeckNativeTransition(t)) throw new Error(`${key}: no deck transition`);
  const p = (at - coming.shownAt) / t.durationMs;
  return { t, p, frame: deckTransitionFrame(t, p) };
}

describe('the warm-up', () => {
  it('still draws every kind of Drashti’s own in both Movements part-way, each again under the notched clip', () => {
    const keys = warmScenes().map((s) => s.key);
    for (const movement of MOVEMENTS)
      for (const kind of TRANSITION_KINDS.filter((k) => k !== 'cut')) {
        expect(keys).toContain(`${kind}/${movement}`);
        expect(keys).toContain(`${kind}/${movement}/clipped`);
      }
  });

  it('draws a deck’s own Wipe part-way: PowerPoint’s band, a mask over the slide coming in, the band itself on the screen (Session 58)', () => {
    for (const key of ['deck-wipe/calm', 'deck-wipe/calm/clipped']) {
      const { t, p, frame } = deckFrameOf(key, BEFORE + 33);
      expect(t.deckEffect, key).toBe('wipe');
      expect(p, key).toBeGreaterThan(0.3);
      expect(p, key).toBeLessThan(0.7);
      expect(frame.in.clip ?? '', key).toBe('');
      expect(frame.in.mask ?? '', key).toBe('');
      const band = frame.in.band;
      expect(band, key).toEqual({ direction: 'left', at: 2 * p - 1 });
      if (!band) continue;
      // The warm-up runs only where the page draws with a graphics chip: there the band is a mask on the slide's box,
      // a gradient of 21 stops (a GPU's tier of more than 8), drawn again each frame.
      const mask = wipeSlideMask(
        band,
        { x: 0, y: 0, width: 1920, height: 1080 },
        { width: 1920, height: 1080 },
      );
      expect(mask, key).toMatch(/^linear-gradient\(to left, /u);
      expect(stops(mask), key).toBe(21);
      // Part of the slide coming in shows through the band, part not: the band is on the screen.
      expect(deckWipeShows(t, p, 0), key).toBeGreaterThan(0.5);
      expect(deckWipeShows(t, p, 0.5), key).toBeGreaterThan(0);
      expect(deckWipeShows(t, p, 0.5), key).toBeLessThan(1);
      expect(deckWipeShows(t, p, 0.95), key).toBe(0);
      // The slide going stays as it is, under it.
      expect(frame.out, key).toEqual({ opacity: 1, transform: '' });
    }
    // Again under the same notched clip as Drashti's own.
    expect(scene('deck-wipe/calm/clipped').clip).toBe(scene('wipe/calm/clipped').clip);
  });

  it('draws a deck’s own Wipe again half a pixel off the grid, so its mask is drawn as an anti-aliased rect too (review-c2 MEDIUM-2)', () => {
    // CI's Mac, traced: the first deck Wipe on air made 'AnalyticRRectRenderStep + LinearGradientBuffer' (the 21-stop
    // mask over a slide whose edges fall between pixels); the grid-aligned scene draws only the pixel-aligned kind.
    const offGrid = scene('deck-wipe/calm/off-grid');
    expect(offGrid.offset).toBe('translate(0.5px, 0.5px)');
    expect(offGrid.clip).toBeUndefined();
    const at = BEFORE + 33;
    expect(offGrid.state(true, at)).toEqual(scene('deck-wipe/calm').state(true, at));
    expect(offGrid.state(false, at)).toEqual(scene('deck-wipe/calm').state(false, at));
    // Once: no clipped twin of it.
    expect(warmScenes().some((s) => s.key === 'deck-wipe/calm/off-grid/clipped')).toBe(false);
  });

  it('draws the wide Cover’s shaded full-slide picture off the grid, so its first use can reuse the antialiased pipeline (X12 wide)', () => {
    // Earlier Mac traces: the outer brightness(0) flattened the shaded RGBA pass. On air the first 16:9 Cover
    // made PerEdgeAAQuadRenderStep + MatrixColorFilter SrcOver AnalyticClip, holding one frame for 150–450 ms.
    // The overlay must leave this full-slide picture, and the Cover's own shade, drawn as on air.
    const key = 'deck-cover-wide/calm/off-grid';
    const wide = scene(key);
    expect(wide.offset).toBe('translate(0.5px, 0.5px)');
    expect(wide.clip).toBeUndefined();
    const at = BEFORE + 33;
    const { t, p, frame } = deckFrameOf(key, at);
    expect(t.deckEffect).toBe('cover');
    expect(p).toBeGreaterThan(0.3);
    expect(p).toBeLessThan(0.7);
    expect(frame.in.filter).toBe('brightness(0.986)');
    expect(frame.in.transform).toMatch(/^translate[XY]\(/u);
    for (const during of [false, true]) {
      const slide = slideOf(wide, during, at).slide;
      expect([slide.width, slide.height]).toEqual([1920, 1080]);
      // The measured deck's picture and native words compose one RGBA surface; a lone JPEG can draw as YUV.
      expect(nativeDeckMotion(slide.deck)).toEqual({ effects: [], stepsMs: [0], approximate: false });
      expect(slide.elements).toEqual([
        expect.objectContaining({
          kind: 'image',
          sourceShapeId: '2',
          fit: 'fill',
          frame: { x: 0, y: 0, width: 1920, height: 1080 },
        }),
        expect.objectContaining({
          kind: 'text',
          sourceShapeId: '3',
          frame: { x: 160, y: 120, width: 1600, height: 200 },
        }),
        expect.objectContaining({
          kind: 'text',
          sourceShapeId: '4',
          frame: { x: 160, y: 360, width: 1600, height: 140 },
        }),
      ]);
      expect(
        slide.elements.map((el) => (el.kind === 'text' ? [el.style.fontSize, el.style.shrinkToFit] : null)),
      ).toEqual([null, [80, true], [56, true]]);
    }
    // The same composition under the notched clip primes the multisampled render passes too.
    const clipped = scene(`${key}/clipped`);
    expect(clipped.clip).toBe(scene('deck-cover/calm/clipped').clip);
    expect(clipped.offset).toBe(wide.offset);
    for (const during of [false, true]) expect(clipped.state(during, at)).toEqual(wide.state(during, at));
  });

  it('draws a 4:3 deck’s Cover between bars, half a pixel off the grid (C24, X12)', () => {
    // CI's Mac, traced (c24 profiled run on 7e12c229): the scene on the grid makes the shade's pipelines as
    // 'CoverBoundsRenderStep[NonAAFill] + ...+MatrixColorFilter'; the first 16:9 Cover on air, its slide between pixels,
    // made 'PerEdgeAAQuadRenderStep + ...+MatrixColorFilter SrcOver AnalyticClip' (three render passes), and the first
    // 4:3 Cover between bars the same without the clip (drawn under its bars' clip) and the clip's own solid rect: one
    // frame of 218-335 ms on that VM each, every plain run.
    const at = BEFORE + 33;
    const four = scene('deck-cover-four-three/calm/off-grid');
    expect(four.offset).toBe('translate(0.5px, 0.5px)');
    expect(four.clip).toBeUndefined();
    const { t, p, frame } = deckFrameOf('deck-cover-four-three/calm/off-grid', at);
    expect(t.deckEffect).toBe('cover');
    expect(p).toBeGreaterThan(0.3);
    expect(p).toBeLessThan(0.7);
    expect(frame.in.filter).toMatch(/^brightness\(0\.\d+\)$/u);
    for (const during of [true, false]) {
      const s = slideOf(four, during, at).slide;
      expect([s.width, s.height], String(during)).toEqual([1440, 1080]);
      for (const e of s.elements) expect(e.frame.x + e.frame.width, e.id).toBeLessThanOrEqual(1440);
    }
    // Once: no clipped twin of it.
    expect(warmScenes().some((s) => s.key === 'deck-cover-four-three/calm/off-grid/clipped')).toBe(false);
  });

  it('draws a deck’s own Cover part-way: the slide coming in moved and a shade darker, a filter over the whole slide', () => {
    for (const key of ['deck-cover/calm', 'deck-cover/calm/clipped']) {
      const { t, p, frame } = deckFrameOf(key, BEFORE + 33);
      expect(t.deckEffect, key).toBe('cover');
      expect(p, key).toBeGreaterThan(0.3);
      expect(p, key).toBeLessThan(0.7);
      expect(frame.in.filter, key).toMatch(/^brightness\(0\.\d+\)$/u);
      expect(frame.in.transform, key).toMatch(/^translate[XY]\(/u);
      expect(frame.in.mask ?? '', key).toBe('');
    }
    expect(scene('deck-cover/calm/clipped').clip).toBe(scene('wipe/calm/clipped').clip);
  });

  it('the Wipe’s slide going is a deck’s Drashti plays itself, its picture, shape and words each part-way through a Split: masks of 4, 5 and 6 stops', () => {
    for (const key of ['deck-wipe/calm']) {
      // What is up before: the screen keeps it up, its shapes moving on, as the next comes in.
      const going = slideOf(scene(key), false, BEFORE);
      const motion = nativeDeckMotion(going.slide.deck);
      const timing = nativeStepTiming(going);
      expect(motion, key).toBeDefined();
      expect(timing, key).not.toBeNull();
      if (!motion || !timing) continue;
      const byTarget = deckEffectsByTarget(motion.effects);
      const bounds = deckTargetBounds(going.slide.elements, byTarget);
      expect(
        going.slide.elements.flatMap((e) =>
          e.sourceShapeId && byTarget.has(e.sourceShapeId) ? [e.kind] : [],
        ),
        key,
      ).toEqual(['image', 'shape', 'text']);
      // However long the slides before took to draw: two frames, or seconds on a GPU still making their pipelines.
      for (const gap of [33, 5_000, 30_000]) {
        const masks = [...byTarget].map(([id, effects]) => {
          const box = bounds.get(id) ?? { x: 0, y: 0, width: 0, height: 0 };
          const frame = deckMotionFrame(
            effects,
            timing.index,
            BEFORE + gap - timing.clipAt,
            box,
            going.slide,
          );
          expect(frame.opacity, `${key} ${id} after ${String(gap)} ms`).toBe(1);
          return deckWipeMask(frame.wipe, box, box);
        });
        expect(
          masks.every((m) => m.startsWith('linear-gradient(')),
          `${key} after ${String(gap)} ms`,
        ).toBe(true);
        expect(
          masks.map(stops).sort((a, b) => a - b),
          `${key} after ${String(gap)} ms`,
        ).toEqual([4, 5, 6]);
      }
    }
  });

  it('the Cover’s slide going is a deck’s Drashti plays itself, its picture, shape and words and a placeholder each part-way through a Shape: a Circle’s radial mask, a Box’s, a Diamond’s and a Plus’s ramp over two half-planes, twice', () => {
    const going = slideOf(scene('deck-cover/calm'), false, BEFORE);
    const motion = nativeDeckMotion(going.slide.deck);
    const timing = nativeStepTiming(going);
    expect(motion).toBeDefined();
    expect(timing).not.toBeNull();
    if (!motion || !timing) return;
    const byTarget = deckEffectsByTarget(motion.effects);
    const bounds = deckTargetBounds(going.slide.elements, byTarget);
    expect(motion.effects.map((e) => [e.kind, e.shape])).toEqual([
      ['shape', 'circle'],
      ['shape', 'box'],
      ['shape', 'diamond'],
      ['shape', 'plus'],
    ]);
    const kinds = (mask: string) => mask.match(/[a-z-]+-gradient\(/gu) ?? [];
    for (const gap of [33, 5_000, 30_000]) {
      const drawn = [...byTarget].map(([id, effects]) => {
        const box = bounds.get(id) ?? { x: 0, y: 0, width: 0, height: 0 };
        const frame = deckMotionFrame(effects, timing.index, BEFORE + gap - timing.clipAt, box, going.slide);
        expect(frame.opacity, `${id} after ${String(gap)} ms`).toBe(1);
        return [kinds(deckWipeMask(frame.wipe, box, box)), kinds(deckWipeInnerMask(frame.wipe, box, box))];
      });
      const twice = ['linear-gradient(', 'linear-gradient(', 'linear-gradient('];
      expect(drawn, `after ${String(gap)} ms`).toEqual([
        [['radial-gradient('], []],
        [twice, twice],
        [twice, twice],
        [twice, twice],
      ]);
    }
  });

  it('draws every kind of mask a deck’s Split or Shape draws on air, on the shape and within it: each layer’s gradient and its tier of stops (C1’s review, MEDIUM-1)', () => {
    // A GPU makes one pipeline per kind of drawing at its first use (100-600 ms on CI's Mac, every screen waiting): a
    // gradient's type and its stops' tier (up to 4, up to 8, more), a layer each. Every kind a deck's Split or Shape
    // draws on air (each outline, In and Out, coming in and leaving, all the way through), on the moving shape and on
    // the element within it, must be one the warm-up draws: its deck scenes' slides going, as they are at its moment.
    const kindsOf = (mask: string, where: string): string | null => {
      if (mask === '') return null;
      const layers: string[] = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < mask.length; i++) {
        if (mask[i] === '(') depth++;
        if (mask[i] === ')') depth--;
        if (mask[i] === ',' && depth === 0) {
          layers.push(mask.slice(start, i).trim());
          start = i + 1;
        }
      }
      layers.push(mask.slice(start).trim());
      const kinds = layers.map((layer) => {
        const n = stops(layer);
        return `${/^([a-z-]+)\(/u.exec(layer)?.[1] ?? '?'}[${n <= 4 ? '<=4' : n <= 8 ? '<=8' : '>8'}]`;
      });
      return `${where}: ${kinds.join(' + ')}`;
    };
    const box = { x: 100, y: 60, width: 640, height: 380 };
    const onAir = new Map<string, string>();
    const note = (kind: string | null, first: string) => {
      if (kind !== null && !onAir.has(kind)) onAir.set(kind, first);
    };
    for (let i = 1; i < 200; i++) {
      const progress = i / 200;
      for (const inward of [false, true])
        for (const leaving of [false, true]) {
          const way = `${inward ? 'In' : 'Out'} ${leaving ? 'leaving' : 'coming in'} at ${String(progress)}`;
          for (const shape of ['circle', 'box', 'diamond', 'plus'] as const) {
            const wipe = { shape, inward, leaving, progress };
            note(kindsOf(deckWipeMask(wipe, box, box), 'on the shape'), `${shape} ${way}`);
            note(kindsOf(deckWipeInnerMask(wipe, box, box), 'within it'), `${shape} ${way}`);
          }
          for (const axis of ['x', 'y'] as const)
            note(
              kindsOf(deckWipeMask({ axis, inward, leaving, progress }, box, box), 'on the shape'),
              `split ${axis} ${way}`,
            );
        }
    }
    // Not nothing: the Circle's radial mask, Split's and Shape's straight ones, and the masks within a Box.
    expect([...onAir.keys()]).toEqual(
      expect.arrayContaining([
        'on the shape: radial-gradient[<=4]',
        'on the shape: linear-gradient[<=8]',
        'on the shape: linear-gradient[<=4]',
        'within it: linear-gradient[<=8] + linear-gradient[<=4] + linear-gradient[<=4]',
      ]),
    );
    // What the warm-up draws, however long the slides before took to draw (two frames, or seconds on a GPU still
    // making their pipelines): every scene's slide going that is a deck's Drashti plays itself.
    for (const gap of [33, 5_000, 30_000]) {
      const warmed = new Set<string>();
      for (const s of warmScenes()) {
        const going = s.state(false, BEFORE).layers.slide;
        const motion = going ? nativeDeckMotion(going.slide.deck) : undefined;
        const timing = going ? nativeStepTiming(going) : null;
        if (!going || !motion || !timing) continue;
        const byTarget = deckEffectsByTarget(motion.effects);
        const bounds = deckTargetBounds(going.slide.elements, byTarget);
        for (const [id, effects] of byTarget) {
          const target = bounds.get(id) ?? { x: 0, y: 0, width: 0, height: 0 };
          const frame = deckMotionFrame(
            effects,
            timing.index,
            BEFORE + gap - timing.clipAt,
            target,
            going.slide,
          );
          for (const kind of [
            kindsOf(deckWipeMask(frame.wipe, target, target), 'on the shape'),
            kindsOf(deckWipeInnerMask(frame.wipe, target, target), 'within it'),
          ])
            if (kind !== null) warmed.add(kind);
        }
      }
      expect(
        [...onAir].filter(([kind]) => !warmed.has(kind)).map(([kind, first]) => `${kind} (first: ${first})`),
        `after ${String(gap)} ms`,
      ).toEqual([]);
    }
  });
});

describe('the warm-up and the opening (Session 59)', () => {
  it('the opening waits for the window’s warm-up as long as it can last, its cap then its last step, so its two seconds never share the GPU with it', () => {
    // The window's limit (Session 58, C4: Q57-32) outlasted the cap alone; the last step after it (X24, fault 2) came
    // later. On CI's Mac the warm-up reached its cap, and the opening moved for 17 frames while that step still ran
    // (opening-timing.spec.ts:243, Session 59's final quick check).
    expect(OPENING_START_HOLD_MS).toBeGreaterThan(WARM_UP_LONGEST_MS);
  });
});

/** A compositor's retirement acknowledged by hand, so parent readiness can be checked before and after it. */
function watchHandOver(how: WarmUpEnd, drewFrame: boolean) {
  const events: string[] = [];
  let finishRetiring = () => {
    events.push('no retirement requested');
  };
  handOverWarmUp({
    how,
    drewFrame,
    retire: (ready) => {
      events.push('empty');
      finishRetiring = () => {
        events.push('retired');
        ready();
      };
    },
    ready: () => {
      events.push('parent-ready');
    },
  });
  return {
    events,
    finishRetiring: () => {
      finishRetiring();
    },
  };
}

describe('retiring warm-up pictures before the parent draws', () => {
  it('a normally drawn warm-up cannot publish parent-ready while its drawing is still held by the compositor', () => {
    const hand = watchHandOver('drawn', true);
    expect(hand.events, 'first remove the warm-up drawing, keeping the show covered').toEqual(['empty']);
    hand.finishRetiring();
    expect(hand.events).toEqual(['empty', 'retired', 'parent-ready']);
  });

  it('keeps the same retirement barrier for caps, cuts and drawing errors', () => {
    for (const how of ['cap', 'cut', 'error'] as const) {
      const hand = watchHandOver(how, true);
      expect(hand.events, how).toEqual(['empty']);
      hand.finishRetiring();
      expect(hand.events, how).toEqual(['empty', 'retired', 'parent-ready']);
    }
  });

  it('a page unseen or with no drawing to release remains ready immediately', () => {
    expect(watchHandOver('unseen', true).events).toEqual(['parent-ready']);
    for (const how of ['drawn', 'cap', 'cut', 'error', 'unseen'] as const)
      expect(watchHandOver(how, false).events, how).toEqual(['parent-ready']);
  });
});

describe('the LIVE picture’s painted wide Cover copy (a24-coverpipe)', () => {
  // On air the LIVE picture's Cover is painted with the window's own drawing under the box's rounded clip alone; where
  // its shaded surface falls on the device's pixels and on that clip picks how the GPU draws it (CI's Mac, alpha.24's
  // joined run 2: with Depth's 4 px gaps the first wide Cover made a multisampled, clipped shading pipeline).
  it('takes four places in turn: part-way in and all the way in, each on whole device pixels and half a device pixel over', () => {
    const from = 'translateX(78.2457%)';
    expect([0, 1, 2, 3].map((turn) => paintedCoverPlace(turn, from, 0.25))).toEqual([
      from,
      `${from} translateX(0.25px)`,
      'none',
      'translateX(0.25px)',
    ]);
    // Round again: each place is drawn more than once while the warm-up lasts.
    expect(paintedCoverPlace(4, from, 0.25)).toBe(from);
    expect(paintedCoverPlace(7, from, 0.25)).toBe('translateX(0.25px)');
  });

  it('a slide coming in with no move of its own is all the way in already', () => {
    expect(paintedCoverPlace(0, 'none', 0.5)).toBe('none');
    expect(paintedCoverPlace(1, '', 0.5)).toBe('translateX(0.5px)');
  });
});
