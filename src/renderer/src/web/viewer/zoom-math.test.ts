import { describe, expect, it } from 'vitest';
import {
  clampView,
  fitScale,
  nudged,
  panned,
  pinched,
  pointAt,
  sameView,
  viewTransform,
  WHOLE,
  zoomedAt,
} from './zoom-math';

/*
 * A phone's own zoom (Session 54, D1): fitted whole at first, two fingers zooming about the point between them,
 * one finger moving what is under it, and never an empty edge where the picture is bigger than the screen. Sizes
 * are a slide (1920 × 1080) on a phone held upright (375 × 600).
 */

const SLIDE = { width: 1920, height: 1080 };
const PHONE = { width: 375, height: 600 };
const MAX = 4;

describe('a phone’s own zoom (Session 54, D1)', () => {
  it('fits the whole of it into the screen first, in the middle', () => {
    expect(fitScale(SLIDE, PHONE)).toBeCloseTo(375 / 1920);
    // At zoom 1 the slide is 375 wide and 211 high, in the middle of the screen.
    expect(viewTransform(WHOLE, SLIDE, PHONE)).toBe(
      `translate(0px, ${String(300 - 1080 * (375 / 1920) * 0.5)}px) scale(${String(375 / 1920)})`,
    );
    // Moved at zoom 1: back in the middle; zoomed past the most: the most.
    expect(clampView({ zoom: 1, cx: 0.9, cy: 0.1 }, SLIDE, PHONE, MAX)).toEqual(WHOLE);
    expect(clampView({ zoom: 9, cx: 0.5, cy: 0.5 }, SLIDE, PHONE, MAX).zoom).toBe(4);
    expect(clampView({ zoom: 0.2, cx: 0.5, cy: 0.5 }, SLIDE, PHONE, MAX).zoom).toBe(1);
  });

  it('zooms two fingers about the point between them, which stays between them', () => {
    // Spread from 100 to 300 pixels apart about a point left of the middle: three times as big there.
    const a0 = { x: 50, y: 300 };
    const b0 = { x: 150, y: 300 };
    const under = pointAt(WHOLE, SLIDE, PHONE, { x: 100, y: 300 });
    const v = pinched(WHOLE, a0, b0, { x: -50, y: 300 }, { x: 250, y: 300 }, SLIDE, PHONE, MAX);
    expect(v.zoom).toBeCloseTo(3);
    const now = pointAt(v, SLIDE, PHONE, { x: 100, y: 300 });
    expect(now.x).toBeCloseTo(under.x);
    // Closed again: whole. Moved while spread: what was under them goes with them.
    expect(
      pinched(
        v,
        { x: 0, y: 300 },
        { x: 300, y: 300 },
        { x: 100, y: 300 },
        { x: 200, y: 300 },
        SLIDE,
        PHONE,
        MAX,
      ),
    ).toEqual(WHOLE);
  });

  it('moves what is under one finger with it, never past the picture’s edges', () => {
    const zoomed = { zoom: 2, cx: 0.5, cy: 0.5 };
    const moved = panned(zoomed, { x: 200, y: 300 }, { x: 150, y: 300 }, SLIDE, PHONE, MAX);
    expect(moved.cx).toBeGreaterThan(0.5);
    expect(moved.cy).toBe(0.5);
    // Dragged far to the left: the right edge of the picture at the right edge of the screen, and no further.
    const far = panned(zoomed, { x: 300, y: 300 }, { x: -3000, y: 300 }, SLIDE, PHONE, MAX);
    expect(far.cx).toBeCloseTo(0.75);
    // At zoom 2 the slide is 422 pixels high on a 600-pixel screen: still in the middle up and down.
    expect(panned(zoomed, { x: 200, y: 300 }, { x: 200, y: 0 }, SLIDE, PHONE, MAX).cy).toBe(0.5);
  });

  it('zooms about a point (a double tap, the wheel, the buttons) and moves by a share of the screen (the keys)', () => {
    const v = zoomedAt(WHOLE, 2, { x: 300, y: 300 }, SLIDE, PHONE, MAX);
    expect(v.zoom).toBe(2);
    expect(v.cx).toBeGreaterThan(0.5);
    expect(zoomedAt(v, 0.25, { x: 10, y: 10 }, SLIDE, PHONE, MAX)).toEqual(WHOLE);
    const right = nudged({ zoom: 3, cx: 0.5, cy: 0.5 }, { x: 0.1, y: 0 }, SLIDE, PHONE, MAX);
    expect(right.cx).toBeGreaterThan(0.5);
    expect(sameView(right, { ...right, cx: right.cx + 1e-5 })).toBe(true);
    expect(sameView(right, WHOLE)).toBe(false);
  });
});
