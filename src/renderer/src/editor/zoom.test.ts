import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, scaleFor, zoomBy, zoomIn, zoomLabel, zoomOut, zoomScroll } from './zoom';

/*
 * The slide editor's zoom (Session 55, Part 17a): to fit the window (as it always opened), or a size of its own,
 * stepping in and out through the sizes a presentation program offers, or as far as a pinch on the trackpad goes;
 * zoomed in, the slide scrolls, and the point under the pointer stays under it.
 */

describe('zoom', () => {
  it('fits to begin with, and fit is the size that fits', () => {
    expect(scaleFor('fit', 0.27)).toBe(0.27);
    expect(scaleFor(0.5, 0.27)).toBe(0.5);
  });

  it('steps in and out from wherever it is, fit included, and stops at its ends', () => {
    expect(zoomIn('fit', 0.27)).toBe(0.33);
    expect(zoomIn(0.33, 0.27)).toBe(0.5);
    expect(zoomIn(0.4, 0.27)).toBe(0.5);
    expect(zoomOut('fit', 0.27)).toBe(0.25);
    expect(zoomOut(0.5, 0.27)).toBe(0.33);
    expect(zoomOut(MIN_ZOOM, 0.27)).toBe(MIN_ZOOM);
    expect(zoomIn(MAX_ZOOM, 0.27)).toBe(MAX_ZOOM);
  });

  it('a pinch zooms by its own amount, within the ends', () => {
    expect(zoomBy('fit', 0.4, 1.25)).toBeCloseTo(0.5, 6);
    expect(zoomBy(3.5, 0.4, 2)).toBe(MAX_ZOOM);
    expect(zoomBy(0.12, 0.4, 0.5)).toBe(MIN_ZOOM);
  });

  it('says its size as a share of the slide’s own', () => {
    expect(zoomLabel('fit', 0.2734)).toBe('27%');
    expect(zoomLabel(1.5, 0.27)).toBe('150%');
  });

  it('keeps the point under the pointer where it was', () => {
    // The pointer 300 px into the area, the area scrolled 100 px: the slide point under it is (300 + 100 - 50) / 0.5.
    const scroll = zoomScroll({ pointer: 300, scroll: 100, offset: 50, from: 0.5, to: 1 });
    // At the new size that point is 700 px into the slide, so it stays at 300 when scrolled 700 + 50 - 300.
    expect(scroll).toBe(450);
    // Never before the start: zoomed out, (100 - 32) / 1 = 68 px in is 34 px in, left of where the pointer is.
    expect(zoomScroll({ pointer: 100, scroll: 0, offset: 32, from: 1, to: 0.5 })).toBe(0);
  });
});
