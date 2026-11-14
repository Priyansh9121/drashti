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
import { deckTransitionFrame, deckWipeShows, wipeSlideMask } from './transition-frame';
import { type WarmScene, warmScenes } from './WarmUp';

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

  it('draws a deck’s own Cover again half a pixel off the grid, and a 4:3 deck’s Cover between bars off the grid too (C24)', () => {
    // CI's Mac, traced (c24 profiled run on 7e12c229): the scene on the grid makes the shade's pipelines as
    // 'CoverBoundsRenderStep[NonAAFill] + ...+MatrixColorFilter'; the first 16:9 Cover on air, its slide between pixels,
    // made 'PerEdgeAAQuadRenderStep + ...+MatrixColorFilter SrcOver AnalyticClip' (three render passes), and the first
    // 4:3 Cover between bars the same without the clip (drawn under its bars' clip) and the clip's own solid rect: one
    // frame of 218-335 ms on that VM each, every plain run.
    const offGrid = scene('deck-cover/calm/off-grid');
    expect(offGrid.offset).toBe('translate(0.5px, 0.5px)');
    expect(offGrid.clip).toBeUndefined();
    const at = BEFORE + 33;
    expect(offGrid.state(true, at)).toEqual(scene('deck-cover/calm').state(true, at));
    expect(offGrid.state(false, at)).toEqual(scene('deck-cover/calm').state(false, at));
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
    // Once each: no clipped twins of them.
    for (const key of ['deck-cover/calm/off-grid/clipped', 'deck-cover-four-three/calm/off-grid/clipped'])
      expect(warmScenes().some((s) => s.key === key)).toBe(false);
  });

  it('draws the native 16:9 Cover in its own first pass, with the same full-slide picture on both slides', () => {
    const at = BEFORE + 33;
    const wide = scene('deck-cover-full-picture');
    const during = slideOf(wide, true, at);
    const before = slideOf(wide, false, at);
    const { t, p, frame } = deckFrameOf(wide.key, at);
    expect(wide).toMatchObject({ pass: 'cover' });
    expect(wide.offset).toBeUndefined();
    expect(wide.clip).toBeUndefined();
    expect(t).toMatchObject({ deckEffect: 'cover', direction: 'left', durationMs: 700 });
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
    expect(frame.in.filter).toMatch(/^brightness\(0\.\d+\)$/u);
    expect(before.slide.id).not.toBe(during.slide.id);
    for (const layer of [before, during]) {
      expect(layer.slide).toMatchObject({ width: 1920, height: 1080 });
      expect(nativeDeckMotion(layer.slide.deck)).toBeDefined();
      expect(layer.slide.elements[0]).toMatchObject({
        kind: 'image',
        fit: 'fill',
        frame: { x: 0, y: 0, width: 1920, height: 1080 },
      });
    }
    expect(before.slide.elements[0]).toEqual(during.slide.elements[0]);
    expect(warmScenes().filter((s) => s.pass === 'cover').map((s) => s.key)).toEqual([wide.key]);
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
