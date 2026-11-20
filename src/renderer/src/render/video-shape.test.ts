import { describe, expect, it } from 'vitest';
import { shapedFrame } from '../../../shared/video-shape';
import { SHAPED_PLACE, shapedClip, shapedVideoStyle, shapeFor } from './video-shape';

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

  it('a slide’s video in its shape’s box keeps what showed of it on the slide: the frame’s own clip where it was, and the frame’s edge when it fills it', () => {
    const frame = { width: 960, height: 540 };
    // 4:3 fitted in the 16:9 frame: 720 × 540 from 120 in; 21:9 filling it: 1260 × 540 from 150 out.
    const fitted = shapedFrame(4 / 3, frame, 'fit');
    const filling = shapedFrame(21 / 9, frame, 'fill');
    // No shape of its own: fitted, nothing to clip; filling, the frame's edge.
    expect(shapedClip(frame, fitted, undefined)).toBeUndefined();
    expect(shapedClip(frame, filling, undefined)).toBe('inset(0px 150px)');
    expect(shapedClip(frame, filling, { shape: 'rectangle' })).toBe('inset(0px 150px)');
    // An ellipse: the frame's, about the same middle.
    expect(shapedClip(frame, fitted, { shape: 'ellipse' })).toBe('ellipse(480px 270px at 50% 50%)');
    expect(shapedClip(frame, filling, { shape: 'ellipse' })).toBe('ellipse(480px 270px at 50% 50%)');
    // Rounded corners: the frame's own rectangle, past the box's sides where the video is fitted narrower.
    expect(shapedClip(frame, fitted, { shape: 'rectangle', cornerRadius: 24 })).toBe(
      'inset(0px -120px round 24px)',
    );
    expect(shapedClip(frame, filling, { shape: 'rectangle', cornerRadius: 24 })).toBe(
      'inset(0px 150px round 24px)',
    );
    // A symbol's outline: the frame's (a triangle: its top's middle, the bottom's corners), in the box's own pixels.
    expect(shapedClip(frame, fitted, { shape: 'triangle' })).toBe('path("M360 0 L840 540 L-120 540 Z")');
    expect(shapedClip(frame, filling, { shape: 'triangle' })).toBe('path("M630 0 L1110 540 L150 540 Z")');
  });
});
