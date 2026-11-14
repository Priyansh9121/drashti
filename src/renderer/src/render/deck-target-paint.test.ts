import { expect, it } from 'vitest';
import type { DeckEffect } from '../../../shared/deck';
import { deckMotionFrame, deckShapeShows } from '../../../shared/deck-motion';
import type { Rect } from '../../../shared/model';
import { setDrawsWithoutChip } from './chipless';
import { deckTargetMaskedTwice, paintDeckTarget } from './deck-target-paint';

const bounds = { x: 100, y: 100, width: 600, height: 400 };
const slide = { width: 1920, height: 1080 };

function effect(kind: DeckEffect['kind'], more: Partial<DeckEffect> = {}): DeckEffect {
  return { shapeId: '2', step: 1, phase: 'in', kind, delayMs: 0, durationMs: 400, ...more };
}

function drawing() {
  const writes: string[] = [];
  const style = new Proxy(
    { transform: '', opacity: '', clipPath: '', maskImage: '', maskComposite: '', willChange: '' },
    {
      set(target, key, value: string) {
        writes.push(String(key));
        return Reflect.set(target, key, value);
      },
    },
  );
  return { writes, style };
}

it('draws a Split’s soft edges as a mask on the moving shape, never a clip, and takes it off when the Split ends', () => {
  const { style, writes } = drawing();
  const split = effect('split', { splitAxis: 'x' });
  const paint = (ms: number, part = bounds) =>
    paintDeckTarget(style, deckMotionFrame([split], 1, ms, bounds, slide), bounds, part);
  // Half-way: the middle shows, each soft edge 13.5 % of the half box wide (40.5 px), beyond it nothing.
  paint(200);
  expect(style).toMatchObject({
    clipPath: '',
    maskImage:
      'linear-gradient(to right, rgb(0 0 0 / 0) 0%, rgb(0 0 0 / 0) 21.625%, rgb(0 0 0 / 1) 28.375%, rgb(0 0 0 / 1) 71.625%, rgb(0 0 0 / 0) 78.375%, rgb(0 0 0 / 0) 100%)',
  });
  expect(writes).toEqual(['maskImage']);
  writes.length = 0;
  paint(200);
  expect(writes).toEqual([]);
  // One part of a group, its left half: the same edges, where they fall across the whole group.
  paint(200, { ...bounds, width: 300 });
  expect(style.maskImage).toBe(
    'linear-gradient(to right, rgb(0 0 0 / 0) 0%, rgb(0 0 0 / 0) 43.25%, rgb(0 0 0 / 1) 56.75%, rgb(0 0 0 / 1) 143.25%, rgb(0 0 0 / 0) 156.75%, rgb(0 0 0 / 0) 200%)',
  );
  paint(400);
  expect(style).toMatchObject({ clipPath: '', maskImage: '', opacity: '', transform: '' });
});

it('leaves a Wipe and the other reveals to their clip, with no mask', () => {
  const { style } = drawing();
  const wipe = effect('wipe', { direction: 'left' });
  paintDeckTarget(style, deckMotionFrame([wipe], 1, 200, bounds, slide), bounds, bounds);
  expect(style).toMatchObject({ clipPath: 'inset(0% 0% 0% 50%)', maskImage: '' });
});

/*
 * What a CSS mask lets through at a point of the element it is on (x, y in px from the element's own top left): the
 * kinds of gradient Drashti writes, read as a browser draws them (CSS Images 3 and 4: a linear gradient's line through
 * the box's centre, as long as the box's own extent along it; a radial gradient's ellipse; a repeating conic gradient
 * from twelve o'clock, clockwise), its stops straight between them (two at one place a step), the layers laid on one
 * another as `mask-composite` says (`add` unless it says `exclude`; the first on top, each over all below it). Only the
 * forms Drashti writes are read; anything else fails the test.
 */
function maskOf(
  mask: string,
  size: { width: number; height: number },
  composite = '',
): (x: number, y: number) => number {
  if (mask === '') return () => 1;
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
  const read = layers.map((layer) => layerOf(layer, size));
  const ops = composite === '' ? ['add'] : composite.split(',').map((op) => op.trim());
  for (const op of ops) expect(['add', 'exclude'], composite).toContain(op);
  return (x, y) =>
    read.reduceRight((below, top, i) => {
      const s = top(x, y);
      return ops[i % ops.length] === 'exclude' ? s * (1 - below) + below * (1 - s) : s + below * (1 - s);
    }, 0);
}

function stopsOf(list: string, unit: '%' | 'deg'): [number, number][] {
  const found = [...list.matchAll(/rgb\(0 0 0 \/ ([\d.]+)\) (-?[\d.]+)(%|deg)/gu)];
  expect(found.length, list).toBeGreaterThan(1);
  return found.map((m): [number, number] => {
    expect(m[3]).toBe(unit);
    return [Number(m[2]), Number(m[1])];
  });
}

function along(stops: readonly [number, number][], at: number): number {
  const first = stops[0];
  const last = stops.at(-1);
  if (!first || !last) throw new Error('no stops');
  if (at <= first[0]) return first[1];
  if (at >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const [p0, v0] = stops[i - 1] ?? first;
    const [p1, v1] = stops[i] ?? last;
    if (at < p1) return p1 === p0 ? v1 : v0 + ((v1 - v0) * (at - p0)) / (p1 - p0);
  }
  return last[1];
}

function layerOf(layer: string, size: { width: number; height: number }): (x: number, y: number) => number {
  let m = /^linear-gradient\((-?[\d.]+)deg, (.*)\)$/u.exec(layer);
  if (m) {
    const angle = (Number(m[1]) * Math.PI) / 180;
    const [ex, ey] = [Math.sin(angle), -Math.cos(angle)];
    const length = Math.abs(size.width * ex) + Math.abs(size.height * ey);
    const stops = stopsOf(m[2] ?? '', '%');
    return (x, y) =>
      along(stops, (((x - size.width / 2) * ex + (y - size.height / 2) * ey) / length + 0.5) * 100);
  }
  m = /^radial-gradient\(([\d.]+)px ([\d.]+)px at (-?[\d.]+)px (-?[\d.]+)px, (.*)\)$/u.exec(layer);
  if (m) {
    const [rx, ry, cx, cy] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    const stops = stopsOf(m[5] ?? '', '%');
    return (x, y) => along(stops, Math.hypot((x - cx) / rx, (y - cy) / ry) * 100);
  }
  m = /^repeating-conic-gradient\(from (-?[\d.]+)deg at (-?[\d.]+)px (-?[\d.]+)px, (.*)\)$/u.exec(layer);
  if (m) {
    const [from, cx, cy] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const stops = stopsOf(m[4] ?? '', 'deg');
    const first = stops[0]?.[0] ?? 0;
    const period = (stops.at(-1)?.[0] ?? 360) - first;
    return (x, y) => {
      const turn = (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI - from;
      return along(stops, (((turn % period) + period) % period) + first);
    };
  }
  throw new Error(`a mask layer this test cannot read: ${layer}`);
}

function twoStyles() {
  const outer = drawing();
  const inner = drawing();
  return { outer, inner };
}

it('draws Shape’s soft edge with masks that let through exactly what PowerPoint’s own movie shows, its corners square', () => {
  const shapes = ['circle', 'box', 'diamond', 'plus'] as const;
  // The whole target, and one part of a group (its right half, a little lower).
  const parts: Rect[] = [bounds, { x: 400, y: 150, width: 300, height: 350 }];
  for (const shape of shapes)
    for (const inward of [false, true])
      for (const phase of ['in', 'out'] as const)
        for (const ms of [40, 140, 200, 330]) {
          const one = effect('shape', { shape, phase, ...(inward ? { inward: true as const } : {}) });
          const frame = deckMotionFrame([one], 1, ms, bounds, slide);
          for (const part of parts) {
            const { outer, inner } = twoStyles();
            paintDeckTarget(outer.style, frame, bounds, part, inner.style);
            const name = `${phase} ${shape} ${inward ? 'In' : 'Out'} at ${String(ms)} ms, part ${JSON.stringify(part)}`;
            expect(outer.style.clipPath, name).toBe('');
            // Every 9 px across the part, each mask read once.
            const outerAt = maskOf(outer.style.maskImage, part, outer.style.maskComposite);
            const innerAt = maskOf(inner.style.maskImage, part, inner.style.maskComposite);
            // No conic gradient: Chromium smooths a conic's hard stop over a fraction of a degree, which drew a faint
            // line along the seam between the two ramps where nothing should show (CI's Mac, 14 Nov 2026).
            expect(`${outer.style.maskImage} ${inner.style.maskImage}`, name).not.toMatch(/conic/u);
            const off: string[] = [];
            for (let y = 0.5; y < part.height; y += 9)
              for (let x = 0.5; x < part.width; x += 9) {
                const u = (part.x + x - (bounds.x + bounds.width / 2)) / (bounds.width / 2);
                const v = (part.y + y - (bounds.y + bounds.height / 2)) / (bounds.height / 2);
                const drawn = outerAt(x, y) * innerAt(x, y);
                const wanted = deckShapeShows(frame.wipe, u, v);
                if (Math.abs(drawn - wanted) > 0.002)
                  off.push(`(${String(x)}, ${String(y)}): ${String(drawn)}, not ${String(wanted)}`);
              }
            expect(off.slice(0, 5), name).toEqual([]);
          }
        }
});

it('masks a Circle once, and a Box, a Plus or a Diamond twice (the target and the part within it), and takes both off when Shape ends', () => {
  expect(deckTargetMaskedTwice([effect('shape', { shape: 'circle' })])).toBe(false);
  expect(deckTargetMaskedTwice([effect('shape')])).toBe(false);
  expect(deckTargetMaskedTwice([effect('split'), effect('fade')])).toBe(false);
  for (const shape of ['box', 'plus', 'diamond'] as const)
    expect(deckTargetMaskedTwice([effect('fade'), effect('shape', { shape, phase: 'out' })])).toBe(true);
  const { outer, inner } = twoStyles();
  const box = effect('shape', { shape: 'box' });
  const paint = (ms: number) =>
    paintDeckTarget(outer.style, deckMotionFrame([box], 1, ms, bounds, slide), bounds, bounds, inner.style);
  paint(200);
  // Each a straight ramp over two half-planes through the box's middle, kept beside two sides by `exclude`.
  for (const style of [outer.style, inner.style]) {
    expect(style.maskImage).toMatch(/^linear-gradient\(.*\), linear-gradient\(.*\), linear-gradient\(/u);
    expect(style.maskComposite).toBe('add, exclude');
  }
  inner.writes.length = 0;
  paint(200);
  expect(inner.writes).toEqual([]);
  paint(400);
  expect(outer.style).toMatchObject({
    clipPath: '',
    maskImage: '',
    maskComposite: '',
    opacity: '',
    transform: '',
  });
  expect(inner.style).toMatchObject({ maskImage: '', maskComposite: '' });
  // A circle: one radial gradient on the target itself.
  const circle = effect('shape', { shape: 'circle' });
  paintDeckTarget(outer.style, deckMotionFrame([circle], 1, 200, bounds, slide), bounds, bounds, inner.style);
  expect(outer.style.maskImage).toMatch(/^radial-gradient\(/u);
  expect(outer.style.maskComposite).toBe('');
  expect(inner.style.maskImage).toBe('');
});

it('takes both of a Box’s masks off when Back paints the step before over it running, or the next click settles it (C1’s review, LOW-1)', () => {
  const box = effect('shape', { shape: 'box' });
  for (const [step, name, opacity] of [
    [0, 'Back to the step before it', '0'],
    [2, 'the next click before it ends', ''],
  ] as const) {
    const { outer, inner } = twoStyles();
    // Running: a mask on the target and one on the part within it.
    paintDeckTarget(outer.style, deckMotionFrame([box], 1, 200, bounds, slide), bounds, bounds, inner.style);
    expect(outer.style.maskImage, name).not.toBe('');
    expect(inner.style.maskImage, name).not.toBe('');
    // Then that step painted, 120 ms in: the Box before its click (hidden) or after it (whole), nothing masked.
    paintDeckTarget(
      outer.style,
      deckMotionFrame([box], step, 120, bounds, slide),
      bounds,
      bounds,
      inner.style,
    );
    expect(outer.style, name).toMatchObject({ clipPath: '', maskImage: '', maskComposite: '', opacity });
    expect(inner.style, name).toMatchObject({ maskImage: '', maskComposite: '' });
  }
});

/** Whether a point (x, y in px from the element's own top left) is inside a CSS polygon clip of a part `size` big. */
function insideClip(
  clip: string,
  size: { width: number; height: number },
): (x: number, y: number) => boolean {
  const m = /^polygon\((evenodd, )?(.*)\)$/u.exec(clip);
  expect(m, clip).not.toBeNull();
  const points = (m?.[2] ?? '').split(', ').map((pair): [number, number] => {
    const [x = '', y = ''] = pair.split(' ');
    expect(x.endsWith('%') && y.endsWith('%'), clip).toBe(true);
    return [(Number.parseFloat(x) / 100) * size.width, (Number.parseFloat(y) / 100) * size.height];
  });
  // Crossings of a ray to the right: odd inside (the even-odd rule; a simple polygon's nonzero one is the same).
  return (x, y) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i] ?? [0, 0];
      const [xj, yj] = points[j] ?? [0, 0];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

it('draws Shape’s hard edge where the page draws without a graphics chip: a clip where PowerPoint’s soft edge is half-way, no masks (C1’s review, HIGH-2)', () => {
  // Two masks of three gradients each on every moving Box, Plus and Diamond cost frames on a two-core Windows PC while
  // streaming, where Chromium composites in software (render/chipless.ts); a clip costs what Session 57's hard edge
  // did. The soft edge stays wherever a graphics chip draws.
  const parts: Rect[] = [bounds, { x: 400, y: 150, width: 300, height: 350 }];
  setDrawsWithoutChip(true);
  try {
    for (const shape of ['circle', 'box', 'diamond', 'plus'] as const)
      for (const inward of [false, true])
        for (const phase of ['in', 'out'] as const)
          for (const ms of [40, 140, 200, 330]) {
            const one = effect('shape', { shape, phase, ...(inward ? { inward: true as const } : {}) });
            const frame = deckMotionFrame([one], 1, ms, bounds, slide);
            for (const part of parts) {
              const { outer, inner } = twoStyles();
              paintDeckTarget(outer.style, frame, bounds, part, inner.style);
              const name = `${phase} ${shape} ${inward ? 'In' : 'Out'} at ${String(ms)} ms, part ${JSON.stringify(part)}`;
              expect(outer.style, name).toMatchObject({ maskImage: '', maskComposite: '' });
              expect(inner.style, name).toMatchObject({ maskImage: '', maskComposite: '' });
              // Inside the clip exactly where more than half shows (points near the half-way line left out).
              const inside = insideClip(outer.style.clipPath, part);
              const off: string[] = [];
              for (let y = 0.5; y < part.height; y += 9)
                for (let x = 0.5; x < part.width; x += 9) {
                  const u = (part.x + x - (bounds.x + bounds.width / 2)) / (bounds.width / 2);
                  const v = (part.y + y - (bounds.y + bounds.height / 2)) / (bounds.height / 2);
                  const shows = deckShapeShows(frame.wipe, u, v);
                  if (Math.abs(shows - 0.5) < 0.1) continue;
                  if (inside(x, y) !== shows > 0.5)
                    off.push(`(${String(x)}, ${String(y)}): shows ${String(shows)}`);
                }
              expect(off.slice(0, 5), name).toEqual([]);
            }
          }
    // At the end: whole, nothing clipped.
    const { outer, inner } = twoStyles();
    const box = effect('shape', { shape: 'box' });
    paintDeckTarget(outer.style, deckMotionFrame([box], 1, 200, bounds, slide), bounds, bounds, inner.style);
    paintDeckTarget(outer.style, deckMotionFrame([box], 1, 400, bounds, slide), bounds, bounds, inner.style);
    expect(outer.style).toMatchObject({ clipPath: '', maskImage: '', opacity: '' });
  } finally {
    setDrawsWithoutChip(false);
  }
  // With a chip (or not told): the soft edge, as before.
  const { outer, inner } = twoStyles();
  const box = effect('shape', { shape: 'box' });
  paintDeckTarget(outer.style, deckMotionFrame([box], 1, 200, bounds, slide), bounds, bounds, inner.style);
  expect(outer.style.clipPath).toBe('');
  expect(outer.style.maskImage).toMatch(/^linear-gradient\(/u);
  expect(inner.style.maskImage).toMatch(/^linear-gradient\(/u);
});

it('leaves a Split’s soft edges to their mask where the page draws without a graphics chip, the shape a layer of its own while masked (Q58-55)', () => {
  // Drawn in software, a mask on a box whose edge falls between pixels drew that edge's row at three quarters of what
  // it should be, any mask (CI's Windows: C22's diagnostic, a box 150.996 px high); on a layer of its own, exactly.
  setDrawsWithoutChip(true);
  try {
    const { style } = drawing();
    const split = effect('split', { splitAxis: 'x' });
    paintDeckTarget(style, deckMotionFrame([split], 1, 200, bounds, slide), bounds, bounds);
    expect(style.clipPath).toBe('');
    expect(style.maskImage).toMatch(/^linear-gradient\(to right, /u);
    expect(style.willChange).toBe('transform');
    paintDeckTarget(style, deckMotionFrame([split], 1, 400, bounds, slide), bounds, bounds);
    expect(style).toMatchObject({ maskImage: '', willChange: '' });
  } finally {
    setDrawsWithoutChip(false);
  }
  // With a chip: no layer of its own.
  const { style } = drawing();
  const split = effect('split', { splitAxis: 'x' });
  paintDeckTarget(style, deckMotionFrame([split], 1, 200, bounds, slide), bounds, bounds);
  expect(style.willChange).toBe('');
});
