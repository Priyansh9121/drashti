import { describe, expect, it } from 'vitest';
import { nativeDeckMotion } from '../../../shared/deck';
import {
  deckEffectsByTarget,
  deckMotionFrame,
  deckTargetBounds,
  deckWipeInnerMask,
  deckWipeMask,
  deckWipeMaskComposite,
} from '../../../shared/deck-motion';
import type { RenderSlide } from '../../../shared/model';
import { deckTargetMaskedTwice } from './deck-target-paint';
import { SHAPE_MS, withShapes } from './warm-up-deck';

/*
 * Shape's soft edge (Session 58, C1) draws kinds of mask nothing else on a show screen draws, each a new kind of
 * drawing for a GPU to make at a show's first (100-600 ms on CI's Mac, every screen waiting): a radial gradient (a
 * Circle); two half-planes through the box's middle laid on one another by `exclude` (the wedges that keep each of a Box's,
 * a Plus's or a Diamond's two ramps beside its own sides), under a ramp; and two masks one inside the other (those
 * three). The warm-up draws them all once, part-way, unseen. Placeholder slide only.
 */

const placeholder: RenderSlide = {
  id: 'placeholder-warm-up',
  width: 1920,
  height: 1080,
  background: null,
  elements: [
    {
      id: 'picture',
      kind: 'image',
      mediaId: 'placeholder-picture',
      frame: { x: 1240, y: 80, width: 600, height: 338 },
      fit: 'fill',
    },
    {
      id: 'shape',
      kind: 'shape',
      shape: 'rectangle',
      fill: '#5a2a48cc',
      cornerRadius: 24,
      opacity: 1,
      frame: { x: 80, y: 760, width: 760, height: 200 },
      outline: { color: '#f3c46b', width: 4 },
    },
    {
      id: 'words',
      kind: 'text',
      text: 'Placeholder words',
      lang: 'en',
      style: {
        fontFamily: null,
        fontSize: 80,
        fontWeight: 500,
        color: '#ffffff',
        align: 'center',
        verticalAlign: 'middle',
        lineHeight: 1.25,
        shadow: true,
      },
      frame: { x: 96, y: 96, width: 1728, height: 888 },
    },
  ],
};

/** How many stops a CSS gradient layer has. */
const stops = (layer: string) => layer.match(/rgb\(/gu)?.length ?? 0;

/** A mask's layers (commas between them, not inside a gradient). */
function layers(mask: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === '(') depth++;
    if (mask[i] === ')') depth--;
    if (mask[i] === ',' && depth === 0) {
      out.push(mask.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (mask.trim()) out.push(mask.slice(start).trim());
  return out;
}

describe('the warm-up’s Shapes', () => {
  it('draws a Circle, a Box, a Diamond and a Plus part-way: a radial mask, and the wedge and ramp twice over, one mask inside the other, the ramp of 6 stops and of 4', () => {
    const slide = withShapes(placeholder);
    const motion = nativeDeckMotion(slide.deck);
    expect(motion).toBeDefined();
    if (!motion) return;
    const byTarget = deckEffectsByTarget(motion.effects);
    const bounds = deckTargetBounds(slide.elements, byTarget);
    // The slide's picture, shape and words, and a placeholder shape of the warm-up's own (C1's review, MEDIUM-1).
    expect(
      slide.elements.flatMap((e) => (e.sourceShapeId && byTarget.has(e.sourceShapeId) ? [e.kind] : [])),
    ).toEqual(['image', 'shape', 'text', 'shape']);
    expect(slide.elements.slice(0, 3).map((e) => e.id)).toEqual(placeholder.elements.map((e) => e.id));
    expect(motion.effects.map((e) => [e.kind, e.shape])).toEqual([
      ['shape', 'circle'],
      ['shape', 'box'],
      ['shape', 'diamond'],
      ['shape', 'plus'],
    ]);
    // However long the slides before took to draw: two frames, or seconds on a GPU still making their pipelines.
    for (const gap of [33, 5_000, 30_000]) {
      const drawn = [...byTarget].map(([id, effects]) => {
        const box = bounds.get(id) ?? { x: 0, y: 0, width: 0, height: 0 };
        const frame = deckMotionFrame(effects, 0, SHAPE_MS + gap, box, slide);
        expect(frame.opacity, `${id} after ${String(gap)} ms`).toBe(1);
        expect(frame.moving, `${id} after ${String(gap)} ms`).toBe(true);
        return {
          twice: deckTargetMaskedTwice(effects),
          outer: layers(deckWipeMask(frame.wipe, box, box)),
          inner: layers(deckWipeInnerMask(frame.wipe, box, box)),
          composite: deckWipeMaskComposite(frame.wipe),
        };
      });
      const [circle, box, diamond, plus] = drawn;
      const at = `after ${String(gap)} ms`;
      // The Circle: one radial gradient of 4 stops (both soft edges inside the shape), on the target alone.
      expect(circle?.twice, at).toBe(false);
      expect(
        circle?.outer.map((l) => l.split('(')[0]),
        at,
      ).toEqual(['radial-gradient']);
      expect(circle?.outer.map(stops), at).toEqual([4]);
      expect(circle?.inner, at).toEqual([]);
      expect(circle?.composite, at).toBe('');
      // The Box: on the target and on the part within it, a straight ramp over two half-planes (a step each) by exclude,
      // its ramp of 6 stops (a GPU's tier of up to 8). The Diamond: the same, its ramps along the shape's diagonals. The
      // Plus near the end of its way: its ramp of 4 stops (the tier of up to 4).
      for (const [name, two, ramp] of [
        ['box', box, 6],
        ['diamond', diamond, 6],
        ['plus', plus, 4],
      ] as const) {
        expect(two?.twice, `${name} ${at}`).toBe(true);
        expect(two?.composite, `${name} ${at}`).toBe('add, exclude');
        for (const mask of [two?.outer ?? [], two?.inner ?? []]) {
          expect(
            mask.map((l) => l.split('(')[0]),
            `${name} ${at}`,
          ).toEqual(['linear-gradient', 'linear-gradient', 'linear-gradient']);
          expect(stops(mask[0] ?? ''), `${name} ${at}`).toBe(ramp);
          expect(mask.slice(1).map(stops), `${name} ${at}`).toEqual([2, 2]);
        }
      }
      // The Box's ramps run across and down; the Diamond's along its diagonals.
      expect(box?.outer[0], at).toMatch(/^linear-gradient\(90deg, /u);
      expect(box?.inner[0], at).toMatch(/^linear-gradient\(180deg, /u);
      for (const ramp of [diamond?.outer[0] ?? '', diamond?.inner[0] ?? ''])
        expect(ramp, at).not.toMatch(/^linear-gradient\((0|90|180|270)deg, /u);
    }
  });
});
