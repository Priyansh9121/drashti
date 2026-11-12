import { describe, expect, it } from 'vitest';
import type { DeckEffect } from './deck';
import { deckMotionFrame, deckSplitShows, deckWipeClip } from './deck-motion';

/*
 * PowerPoint's own movie of the comparison deck, measured frame by frame (Session 57, 13 Nov 2026: the lead's run 1,
 * measured by h-c3probe; assister/s57-notes/posts/lead-pptx-compare.md, "Run 1, measured"; and run 2, measured by
 * h-p3run2's probe, assister/s57-notes/logs/lead/pptx-run2/). Each effect runs 700 ms
 * from its click on a 64 × 38 box at (94, 51) of a 320 × 180 slide. A sample is one frame of the movie: its time after
 * the click, and the box's centre, size and turn, and how much of it shows (its opacity times its area, as a share of
 * the box's own; the movie's whole box reads 0.995 of its colour, so each is divided by that), all measured from the
 * frame's pixels. Drashti's pose at the same moment, as it reads the effect from PowerPoint's own XML, must be within
 * half a pixel (its centre), a pixel (its size), a degree and 3 % of the box.
 */

const box = { x: 94, y: 51, width: 64, height: 38 };
const screen = { width: 320, height: 180 };

/** One effect on the box, the only one of its click. */
function effect(
  kind: DeckEffect['kind'],
  phase: DeckEffect['phase'],
  more: Partial<DeckEffect> = {},
): DeckEffect {
  return { shapeId: '2', step: 1, phase, kind, delayMs: 0, durationMs: 700, ...more };
}

/** One measured frame: ms after the click, the centre, the size, how much shows, and the turn (degrees). */
type Sample = [ms: number, cx: number, cy: number, w: number, h: number, shows: number, turn?: number];

/** Drashti's pose of the box at `ms`, measured the same way. */
function pose(one: DeckEffect, ms: number) {
  const frame = deckMotionFrame([one], 1, ms, box, screen);
  return {
    cx: box.x + box.width / 2 + frame.x,
    cy: box.y + box.height / 2 + frame.y,
    w: box.width * frame.scale,
    h: box.height * frame.scale,
    shows: frame.opacity * frame.scale ** 2,
    turn: frame.rotation,
  };
}

function expectLikePowerPoint(one: DeckEffect, samples: readonly Sample[]): void {
  for (const [ms, cx, cy, w, h, shows, turn = 0] of samples) {
    const drawn = pose(one, ms);
    const at = `${String(ms)} ms after the click`;
    expect(Math.hypot(drawn.cx - cx, drawn.cy - cy), `${at}: centre`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(drawn.w - w), `${at}: width`).toBeLessThanOrEqual(1);
    expect(Math.abs(drawn.h - h), `${at}: height`).toBeLessThanOrEqual(1);
    expect(Math.abs(drawn.shows - shows), `${at}: how much shows`).toBeLessThanOrEqual(0.03);
    expect(Math.abs(drawn.turn - turn), `${at}: turn`).toBeLessThanOrEqual(1);
  }
}

describe('effects Drashti draws as PowerPoint’s own movie shows them', () => {
  it('floats in and out: a straight move of 8 % of the slide with an even fade', () => {
    expectLikePowerPoint(effect('float', 'in', { direction: 'up', distance: 0.08 }), [
      [193.3, 126, 80.3, 64.06, 37.97, 0.2653],
      [358.3, 125.98, 77.03, 63.95, 38.09, 0.4985],
      [523.3, 126.01, 73.7, 63.96, 38.04, 0.7397],
    ]);
    expectLikePowerPoint(effect('float', 'out', { direction: 'down', distance: 0.08 }), [
      [195, 125.99, 74.01, 63.96, 37.94, 0.7236],
      [360, 126.01, 77.28, 63.97, 38.06, 0.4884],
      [525, 125.98, 80.98, 63.96, 37.98, 0.2462],
    ]);
  });

  it('grows and shrinks evenly about the shape’s centre', () => {
    expectLikePowerPoint(effect('grow-shrink', 'emphasis', { scale: 1.5 }), [
      [193.3, 126.16, 70, 72.99, 43.34, 1.3005],
      [358.3, 126.16, 70.16, 80.28, 47.67, 1.5739],
      [523.3, 126, 70.16, 87.98, 52.31, 1.8925],
    ]);
    expectLikePowerPoint(effect('grow-shrink', 'emphasis', { scale: 0.5 }), [
      [193.3, 126.16, 70, 55.01, 32.68, 0.7387],
      [358.3, 126.15, 70.17, 47.64, 28.35, 0.5548],
      [523.3, 126, 70.15, 39.98, 23.67, 0.3889],
    ]);
  });

  it('floats in and out and grows and shrinks with a smooth start and end along the same half-cosines (run 2)', () => {
    // A smooth start of 25 % and a smooth end of 50 % on the effect itself, as run 1's eased Fly had them.
    const eased = { accel: 0.25, decel: 0.5 };
    expectLikePowerPoint(effect('float', 'in', { direction: 'up', distance: 0.08, ...eased }), [
      [195, 126, 81.03, 63.85, 37.9, 0.2402],
      [360, 126.02, 75.65, 63.91, 37.96, 0.6261],
      [525, 125.99, 71.02, 63.97, 37.94, 0.9216],
    ]);
    expectLikePowerPoint(effect('float', 'out', { direction: 'down', distance: 0.08, ...eased }), [
      [193.3, 126.01, 73.68, 63.95, 37.99, 0.7578],
      [358.3, 125.99, 79.07, 63.95, 38.02, 0.3769],
      [523.3, 125.96, 83.28, 64.04, 37.71, 0.0724],
    ]);
    expectLikePowerPoint(effect('grow-shrink', 'emphasis', { scale: 1.5, ...eased }), [
      [193.3, 126.17, 70, 71.66, 42.67, 1.2573],
      [358.3, 126, 70.14, 83.98, 49.67, 1.7156],
      [523.3, 126.16, 70.16, 93.66, 55.66, 2.1437],
    ]);
    expectLikePowerPoint(effect('grow-shrink', 'emphasis', { scale: 0.5, ...eased }), [
      [195, 126.18, 70, 56.35, 33.36, 0.7729],
      [360, 126, 70.17, 43.99, 26.32, 0.4764],
      [525, 126.16, 70.16, 34.33, 20.32, 0.2864],
    ]);
  });

  it('turns Grow & Turn and Shrink & Turn a quarter turn as they scale and fade', () => {
    expectLikePowerPoint(effect('zoom', 'in', { fade: true, scale: 0, degrees: 90 }), [
      [193.3, 126.07, 70.11, 17.68, 10.56, 0.0211, 64.9],
      [358.3, 126.1, 70.11, 32.84, 19.49, 0.1357, 43.9],
      [523.3, 126.1, 70.08, 47.9, 28.46, 0.4171, 22.7],
    ]);
    expectLikePowerPoint(effect('zoom', 'out', { fade: true, scale: 0, degrees: 90 }), [
      [195, 126.09, 70.09, 46.25, 27.47, 0.3779, 24.9],
      [360, 126.08, 70.06, 31.19, 18.56, 0.1146, 46],
      [525, 126.08, 70.11, 16.06, 9.59, 0.0151, 67.2],
    ]);
  });

  it('grows Basic Zoom in from nothing where the shape stands', () => {
    expectLikePowerPoint(effect('zoom', 'in'), [
      [193.3, 126.16, 70, 17.68, 10.75, 0.0774],
      [358.3, 126.01, 70, 32.7, 19.37, 0.2593],
      [523.3, 126, 70.16, 47.98, 28.33, 0.5588],
    ]);
  });

  it('plays Basic Zoom’s other variants as their tracks say, each evenly from where it starts', () => {
    // As the comparison deck writes them (run 1): Out from 4 times the size, In Slightly from 2/3, In From Screen Center
    // from nothing at the slide's centre, Out From Screen Bottom from 4 times at the bottom edge (its centre half its
    // own height below the slide: the grown shape shows across the bottom from the start).
    expectLikePowerPoint(effect('zoom', 'in', { zoomAway: { w: '#ppt_w*4', h: '#ppt_h*4' } }), [
      [425, 126.02, 70.02, 139.32, 82.67, 4.7367],
      [491.7, 126, 70.01, 121.34, 71.98, 3.592],
      [556.7, 126, 70, 103.33, 61.35, 2.606],
    ]);
    const twoThirds = { w: '#ppt_w*0.6666666666666666', h: '#ppt_h*0.6666666666666666' };
    expectLikePowerPoint(effect('zoom', 'in', { zoomAway: twoThirds }), [
      [193.3, 126, 70.16, 48.69, 29.04, 0.5809],
      [391.7, 126, 70.15, 54.69, 32.36, 0.7276],
      [590, 126.03, 70.03, 60.67, 35.92, 0.8965],
    ]);
    expectLikePowerPoint(effect('zoom', 'in', { zoomAway: { w: '0', h: '0', x: '0.5', y: '0.5' } }), [
      [226.7, 149, 83.5, 20.72, 12.4, 0.1045],
      [425, 139.5, 77.84, 38.98, 23.03, 0.3688],
      [623.3, 129.83, 72.33, 57, 34.03, 0.797],
    ]);
    const bottom = { w: '#ppt_w*4', h: '#ppt_h*4', x: '0.5', y: '1+#ppt_h/2' };
    expectLikePowerPoint(effect('zoom', 'in', { zoomAway: bottom }), [
      [458.3, 137.84, 114.67, 130.33, 77.33, 4.1447],
      [590, 131.5, 90.33, 94.31, 55.98, 2.1709],
      [656.7, 128.32, 78.17, 75.98, 45.04, 1.407],
    ]);
  });

  it('leaves by Basic Zoom Out, In Slightly and In To Screen Center as their tracks say, each evenly (run 2)', () => {
    // Each its entrance played backwards, as PowerPoint writes them: Out to PowerPoint's own large size (8 times this
    // box; its first frames, while 3 % of the box is still a pixel of its size), In Slightly to 2/3, In To Screen
    // Center to nothing at the slide's centre.
    const large = '(6*min(max(#ppt_w*#ppt_h,.3),1)-7.4)/-.7*';
    expectLikePowerPoint(effect('zoom', 'out', { zoomAway: { w: `${large}#ppt_w`, h: `${large}#ppt_h` } }), [
      [61.7, 126.17, 70.17, 103.66, 61.67, 2.6291],
      [95, 126, 70, 124.68, 73.99, 3.794],
      [128.3, 126, 70, 146, 86.68, 5.204],
    ]);
    expectLikePowerPoint(effect('zoom', 'out', { zoomAway: { w: '2/3*#ppt_w', h: '2/3*#ppt_h' } }), [
      [195, 126.02, 70.15, 58.01, 34.35, 0.8191],
      [391.7, 126, 70.16, 51.98, 31.02, 0.6623],
      [590, 126.01, 69.99, 45.98, 27.38, 0.5176],
    ]);
    expectLikePowerPoint(effect('zoom', 'out', { zoomAway: { w: '0', h: '0', x: '0.5', y: '0.5' } }), [
      [193.3, 135.51, 75.66, 46.32, 27.36, 0.5206],
      [391.7, 145.17, 81.33, 28.32, 16.69, 0.194],
      [590, 154.68, 86.98, 10.07, 5.94, 0.0251],
    ]);
  });

  it('starts Basic Zoom Out as PowerPoint’s own formula says, by how much of the slide the shape covers', () => {
    const out = '(6*min(max(#ppt_w*#ppt_h,.3),1)-7.4)/-.7*';
    const zoom = effect('zoom', 'in', { zoomAway: { w: `${out}#ppt_w`, h: `${out}#ppt_h` } });
    // A shape under 0.3 of the slide from 8 times its size; one as big as the slide from twice its size.
    expect(deckMotionFrame([zoom], 1, 0, box, screen).scale).toBeCloseTo(8, 9);
    expect(deckMotionFrame([zoom], 1, 0, { x: 0, y: 0, ...screen }, screen).scale).toBeCloseTo(2, 9);
    expect(deckMotionFrame([zoom], 1, 350, box, screen).scale).toBeCloseTo(4.5, 9);
    // Out From Screen Bottom: from the slide's middle, just below its bottom edge (half its grown height below it).
    const bottom = { w: `${out}#ppt_w`, h: `${out}#ppt_h`, x: '0.5', y: `1+${out}#ppt_h/2` };
    const start = deckMotionFrame([effect('zoom', 'in', { zoomAway: bottom })], 1, 0, box, screen);
    expect(box.x + box.width / 2 + start.x).toBeCloseTo(160, 9);
    expect(box.y + box.height / 2 + start.y).toBeCloseTo(180 + (8 * box.height) / 2, 9);
  });

  it('speeds up and slows down along half-cosines for a smooth start and end', () => {
    // Fly In from the bottom with a smooth start of 25 % and a smooth end of 50 %: where the box's top edge is, from the
    // height that shows while it comes in across the slide's bottom edge (180 less it), then from its centre (less 19).
    // SMIL's straight ramps would put it up to 3.1 px lower in its last half and 1.9 px higher in its first quarter.
    const fly = effect('fly', 'in', { direction: 'up', accel: 0.25, decel: 0.5 });
    const top = (ms: number) => pose(fly, ms).cy - box.height / 2;
    for (const [ms, measured] of [
      [95, 180 - 5.7],
      [128.3, 180 - 12.67],
      [161.7, 180 - 21.67],
      [260, 148.33 - 19],
      [425, 100.33 - 19],
      [491.7, 85.33 - 19],
      [558.3, 75.33 - 19],
      [623.3, 70.99 - 19],
    ] as const)
      expect(Math.abs(top(ms) - measured), `${String(ms)} ms after the click`).toBeLessThanOrEqual(0.5);
  });
});

describe('Split as PowerPoint’s own movie shows it', () => {
  /** How much of the box shows, and where its moving edges are (each half-way between shown and not, in px). */
  function split(one: DeckEffect, ms: number): { shows: number; edges: number[] } {
    const frame = deckMotionFrame([one], 1, ms, box, screen);
    const across = one.splitAxis !== 'y';
    const from = across ? box.x : box.y;
    const size = across ? box.width : box.height;
    const steps = 3200;
    const profile = Array.from(
      { length: steps },
      (_, i) => frame.opacity * deckSplitShows(frame.wipe, -1 + (2 * (i + 0.5)) / steps),
    );
    const edges: number[] = [];
    for (let i = 1; i < steps; i++) {
      const a = (profile[i - 1] ?? 0) - 0.5;
      const b = (profile[i] ?? 0) - 0.5;
      if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) edges.push(from + ((i + a / (a - b)) * size) / steps);
    }
    return { shows: profile.reduce((sum, v) => sum + v, 0) / steps, edges };
  }

  /** Measured frames: ms after the click, how much of the box shows, and its moving edges along the split's axis. */
  function expectLikePowerPoint(one: DeckEffect, samples: readonly [number, number, number[]][]): void {
    for (const [ms, shows, edges] of samples) {
      const drawn = split(one, ms);
      const at = `${String(ms)} ms after the click`;
      expect(Math.abs(drawn.shows - shows), `${at}: how much shows`).toBeLessThanOrEqual(0.012);
      expect(drawn.edges, `${at}: its moving edges`).toHaveLength(edges.length);
      drawn.edges.forEach((edge, i) => {
        expect(Math.abs(edge - (edges[i] ?? Infinity)), `${at}: edge ${String(i + 1)}`).toBeLessThanOrEqual(
          0.6,
        );
      });
    }
  }

  it('comes in with a soft edge, its middle line from before the start to past the end', () => {
    // Vertical In: from the box's left and right edges to its middle.
    expectLikePowerPoint(effect('split', 'in', { splitAxis: 'x', inward: true }), [
      [160, 0.191, [100.17, 151.99]],
      [358.3, 0.5146, [110.58, 141.69]],
      [590, 0.8884, [122.48, 129.61]],
    ]);
    // Horizontal Out: from the middle to the box's top and bottom.
    expectLikePowerPoint(effect('split', 'in', { splitAxis: 'y' }), [
      [95, 0.0834, [68.52, 71.62]],
      [358.3, 0.5126, [60.34, 79.85]],
      [590, 0.8874, [53.2, 86.95]],
    ]);
  });

  it('leaves Split In closing from both edges to the middle, and Split Out opening from the middle', () => {
    // Horizontal In: hidden from the top and bottom in, the middle last.
    expectLikePowerPoint(effect('split', 'out', { splitAxis: 'y', inward: true }), [
      [95, 0.9126, [52.78, 87.43]],
      [358.3, 0.4844, [60.93, 79.29]],
      [590, 0.1085, [68.03, 72.18]],
    ]);
    // Vertical Out: hidden from the middle out, the left and right edges last.
    expectLikePowerPoint(effect('split', 'out', { splitAxis: 'x' }), [
      [95, 0.9126, [123.26, 128.86]],
      [358.3, 0.4834, [109.56, 142.59]],
      [590, 0.1095, [97.55, 154.59]],
    ]);
  });
});

describe('Shape as PowerPoint’s own movie shows it (run 2)', () => {
  /** A clip `polygon([evenodd, ]x% y%, …)` of the box: where each sample row crosses its edges, and which way. */
  function crossingsOf(clip: string): (y: number) => [number, number][] {
    const body = /^polygon\((.*)\)$/u.exec(clip)?.[1] ?? '';
    const points = body
      .replace(/^evenodd,\s*/u, '')
      .split(',')
      .map((pair) =>
        pair
          .trim()
          .split(/\s+/u)
          .map((v) => Number.parseFloat(v) / 100),
      )
      .map(([x = 0, y = 0]): [number, number] => [x * box.width, y * box.height]);
    return (y) => {
      const list: [number, number][] = [];
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi = 0, yi = 0] = points[i] ?? [];
        const [xj = 0, yj = 0] = points[j] ?? [];
        if (yi > y !== yj > y) list.push([((xj - xi) * (y - yi)) / (yj - yi) + xi, yj > yi ? 1 : -1]);
      }
      return list;
    };
  }

  /**
   * What Drashti draws of the box at `ms`: how much of it shows, and its width and height from how far it spreads
   * (√12 times its standard deviation along each axis, as the movie's frames were measured), 4 × 4 points a pixel.
   */
  function drawn(one: DeckEffect, ms: number): { shows: number; w: number; h: number } {
    const clip = deckWipeClip(deckMotionFrame([one], 1, ms, box, screen).wipe, box, box);
    const evenodd = clip.startsWith('polygon(evenodd');
    const crossings = crossingsOf(clip);
    let mass = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    for (let row = 0; row < box.height * 4; row++) {
      const y = (row + 0.5) / 4;
      const list = crossings(y);
      for (let column = 0; column < box.width * 4; column++) {
        const x = (column + 0.5) / 4;
        let odd = false;
        let winding = 0;
        for (const [at, way] of list)
          if (x < at) {
            odd = !odd;
            winding += way;
          }
        if (evenodd ? !odd : winding === 0) continue;
        mass++;
        sx += x;
        sy += y;
        sxx += x * x;
        syy += y * y;
      }
    }
    const spread = (s: number, ss: number) => Math.sqrt(12 * Math.max(0, ss / mass - (s / mass) ** 2));
    return { shows: mass / (16 * box.width * box.height), w: spread(sx, sxx), h: spread(sy, syy) };
  }

  /**
   * Measured frames: ms after the click, how much of the box shows, and its width and height. PowerPoint's edge is
   * soft (14 % of the way it travels) and Drashti's hard, half-way through it: so close, not the same.
   */
  function expectClose(one: DeckEffect, samples: readonly [number, number, number, number][]): void {
    for (const [ms, shows, w, h] of samples) {
      const ours = drawn(one, ms);
      const at = `${String(ms)} ms after the click`;
      expect(Math.abs(ours.shows - shows), `${at}: how much shows`).toBeLessThanOrEqual(0.015);
      expect(Math.abs(ours.w - w), `${at}: width`).toBeLessThanOrEqual(2);
      expect(Math.abs(ours.h - h), `${at}: height`).toBeLessThanOrEqual(2);
    }
  }

  const shape = (phase: 'in' | 'out', outline: NonNullable<DeckEffect['shape']>, inward: boolean) =>
    effect('shape', phase, { shape: outline, ...(inward ? { inward: true as const } : {}) });

  it('comes in as an ellipse, a box, a diamond or two bars, from the middle (Out) or the edges (In)', () => {
    expectClose(shape('in', 'circle', true), [
      [161.7, 0.0874, 95.02, 56.39],
      [360, 0.6281, 75.02, 44.53],
      [558.3, 0.9558, 65.36, 38.81],
    ]);
    expectClose(shape('in', 'circle', false), [
      [160, 0.0593, 16.51, 9.82],
      [358.3, 0.4141, 40.76, 24.22],
      [556.7, 0.9357, 61.07, 36.25],
    ]);
    expectClose(shape('in', 'box', true), [
      [161.7, 0.3477, 81.95, 48.57],
      [360, 0.7628, 71.1, 42.18],
      [556.7, 0.9719, 64.88, 38.49],
    ]);
    expectClose(shape('in', 'box', false), [
      [160, 0.0372, 13.43, 8.05],
      [358.3, 0.2633, 33.28, 19.75],
      [556.7, 0.6955, 53.66, 31.85],
    ]);
    expectClose(shape('in', 'diamond', true), [
      [161.7, 0.0784, 95.94, 56.89],
      [358.3, 0.5286, 77.31, 45.89],
      [556.7, 0.9437, 65.71, 39.01],
    ]);
    expectClose(shape('in', 'diamond', false), [
      [161.7, 0.0754, 18.95, 11.32],
      [360, 0.5216, 46.55, 27.67],
      [558.3, 0.9407, 61.27, 36.38],
    ]);
    expectClose(shape('in', 'plus', true), [
      [160, 0.0392, 99.43, 58.95],
      [358.3, 0.2663, 83.62, 49.63],
      [556.7, 0.7025, 69.65, 41.33],
    ]);
    expectClose(shape('in', 'plus', false), [
      [161.7, 0.3417, 48.44, 28.73],
      [360, 0.7598, 55.77, 33.09],
      [556.7, 0.9698, 62.52, 37.11],
    ]);
  });

  it('leaves with its edges travelling the same way, hiding what they pass: In closes to the middle, Out opens from it', () => {
    expectClose(shape('out', 'circle', true), [
      [160, 0.9106, 60.1, 35.69],
      [358.3, 0.3688, 38.52, 22.9],
      [556.7, 0.0432, 14.51, 8.6],
    ]);
    expectClose(shape('out', 'circle', false), [
      [161.7, 0.9397, 65.86, 39.09],
      [358.3, 0.5829, 76.34, 45.28],
      [556.7, 0.0623, 97.14, 57.6],
    ]);
    expectClose(shape('out', 'box', true), [
      [161.7, 0.6482, 51.74, 30.8],
      [360, 0.2342, 31.46, 18.7],
      [558.3, 0.0271, 11.79, 7.02],
    ]);
    expectClose(shape('out', 'box', false), [
      [160, 0.9618, 65.2, 38.69],
      [358.3, 0.7347, 71.9, 42.65],
      [556.7, 0.3005, 83, 49.24],
    ]);
    expectClose(shape('out', 'diamond', true), [
      [161.7, 0.9206, 60.45, 35.89],
      [360, 0.4683, 44.33, 26.32],
      [556.7, 0.0553, 16.64, 9.93],
    ]);
    expectClose(shape('out', 'diamond', false), [
      [160, 0.9236, 66.36, 39.38],
      [358.3, 0.4754, 78.79, 46.75],
      [556.7, 0.0573, 97.76, 57.95],
    ]);
    expectClose(shape('out', 'plus', true), [
      [161.7, 0.9598, 62.09, 36.84],
      [358.3, 0.7307, 55.06, 32.68],
      [556.7, 0.2945, 47.87, 28.43],
    ]);
    expectClose(shape('out', 'plus', false), [
      [161.7, 0.6553, 70.79, 42.02],
      [360, 0.2382, 85, 50.45],
      [558.3, 0.0281, 100.86, 59.76],
    ]);
  });
});
