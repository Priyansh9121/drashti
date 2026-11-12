import { describe, expect, it } from 'vitest';
import { nativeDeckMotion } from '../../../shared/deck';
import {
  deckEffectsByTarget,
  deckMotionFrame,
  deckTargetBounds,
  deckWipeMask,
} from '../../../shared/deck-motion';
import { nativeStepTiming } from '../../../shared/deck-show';
import { isDeckNativeTransition } from '../../../shared/deck-transition';
import type { SlideLayer } from '../../../shared/engine/state';
import { MOVEMENTS } from '../../../shared/looks';
import { TRANSITION_KINDS } from '../../../shared/model';
import { deckTransitionFrame } from './transition-frame';
import { type WarmScene, warmScenes } from './WarmUp';

/*
 * The GPU's warm-up (render/WarmUp.tsx; tests/e2e/warm-up.spec.ts looks at it drawn): before a screen with a graphics
 * chip first draws the show, it draws what a show draws, part-way, so the GPU makes each new kind of drawing (a
 * "pipeline") then and not at the show's first (100-600 ms each on CI's Mac, every screen waiting). A deck Drashti
 * plays itself draws two kinds nothing else does (13 Nov 2026, the review of h-p3tr's part B): its own Cover (and
 * Uncover), the slide it moves a shade darker, a filter; and a Split, a gradient mask the size of its shape, of 4, 5 or
 * 6 stops as it goes (a GPU draws a gradient of up to 4 stops, of up to 8 and of more each its own way). Its own Wipe
 * is drawn again with a hard-edged clip (Q57-28: PowerPoint's soft band, a mask over the whole slide coming in, dropped
 * frames on Windows while streaming); the warm-up still draws it part-way. Placeholder slides only.
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

  it('draws a deck’s own Wipe part-way: a hard-edged clip over the whole slide coming in, no mask (Q57-28)', () => {
    for (const key of ['deck-wipe/calm', 'deck-wipe/calm/clipped']) {
      const { t, p, frame } = deckFrameOf(key, BEFORE + 33);
      expect(t.deckEffect, key).toBe('wipe');
      expect(p, key).toBeGreaterThan(0.3);
      expect(p, key).toBeLessThan(0.7);
      expect(frame.in.mask ?? '', key).toBe('');
      expect(frame.in.clip ?? '', key).toMatch(/^inset\(0 0 0 [\d.]+%\)$/u);
      // The slide going stays as it is, under it.
      expect(frame.out, key).toEqual({ opacity: 1, transform: '' });
    }
    // Again under the same notched clip as Drashti's own.
    expect(scene('deck-wipe/calm/clipped').clip).toBe(scene('wipe/calm/clipped').clip);
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

  it('the slide going is a deck’s Drashti plays itself, its picture, shape and words each part-way through a Split: masks of 4, 5 and 6 stops', () => {
    for (const key of ['deck-wipe/calm', 'deck-cover/calm']) {
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
});
