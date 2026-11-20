import { describe, expect, it } from 'vitest';
import { shapedFrame } from '../../../shared/video-shape';
import { SHAPED_PLACE, shapedVideoStyle, shapeFor } from './video-shape';

/*
 * Sound and picture…'s Shape on a screen (alpha.20, x55, slice 6b): which videos are drawn in a shape of their own, and
 * the CSS box a background video is drawn in, worked out by the page's layout (container query units): for any size of
 * its place it is the box the shape's maths gives (shared/video-shape.ts shapedFrame).
 */

/** A length in the CSS the box is written in (cqw, cqh, min(), max(), calc()), in pixels for a place of w × h. */
function cssPx(css: string, w: number, h: number): number {
  const s = css.trim();
  const unit = /^(-?[\d.]+)cq([wh])$/.exec(s);
  if (unit) return (Number(unit[1]) * (unit[2] === 'w' ? w : h)) / 100;
  const pick = /^(min|max)\((.+), (.+)\)$/.exec(s);
  if (pick) {
    const a = cssPx(pick[2] ?? '', w, h);
    const b = cssPx(pick[3] ?? '', w, h);
    return pick[1] === 'min' ? Math.min(a, b) : Math.max(a, b);
  }
  const half = /^calc\(\((.+?) - (.+)\) \/ 2\)$/.exec(s);
  if (half) return (cssPx(half[1] ?? '', w, h) - cssPx(half[2] ?? '', w, h)) / 2;
  throw new Error(`not a length this box is written in: ${s}`);
}

const PLACES = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 1080 },
  { width: 1080, height: 1920 },
  { width: 640, height: 360 },
  { width: 1000, height: 1000 },
];

describe('a video drawn in a shape of its own', () => {
  it('takes the state’s shape while fitted or filling its place; none as its file says, nor stretched', () => {
    const shapes = { clip: '21:9' as const };
    expect(shapeFor(shapes, 'clip', 'fit')).toBeCloseTo(21 / 9, 12);
    expect(shapeFor(shapes, 'clip', 'fill')).toBeCloseTo(21 / 9, 12);
    expect(shapeFor(shapes, 'clip', 'stretch')).toBeNull();
    expect(shapeFor(shapes, 'other', 'fit')).toBeNull();
    expect(shapeFor(undefined, 'clip', 'fit')).toBeNull();
  });

  it('a background video’s box, by CSS alone, is the shape’s box in any place: fitted inside or filling it, centred, the picture stretched', () => {
    expect(SHAPED_PLACE).toEqual({ containerType: 'size', overflow: 'hidden' });
    for (const aspect of [16 / 9, 4 / 3, 1, 21 / 9])
      for (const fit of ['fit', 'fill'] as const) {
        const css = shapedVideoStyle(aspect, fit);
        expect(css).toMatchObject({ position: 'absolute', objectFit: 'fill' });
        for (const place of PLACES) {
          const want = shapedFrame(aspect, place, fit);
          const at = (v: unknown) => cssPx(String(v), place.width, place.height);
          const said = `${aspect.toFixed(3)} ${fit} in ${String(place.width)}x${String(place.height)}`;
          expect(at(css.left), said).toBeCloseTo(want.x, 1);
          expect(at(css.top), said).toBeCloseTo(want.y, 1);
          expect(at(css.width), said).toBeCloseTo(want.width, 1);
          expect(at(css.height), said).toBeCloseTo(want.height, 1);
        }
      }
  });
});
