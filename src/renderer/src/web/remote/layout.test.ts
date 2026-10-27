import { describe, expect, it } from 'vitest';
import { LANDSCAPE, layoutFor, SHORT, WIDE } from './layout';

/*
 * How the remote is laid out at a size (Session 18; Session 54, D5 review): a phone's tabs, a tablet upright's
 * playlist or library beside the show, a tablet held sideways' live column beside its panel; and a phone held
 * sideways, too short for either, as a phone. The media queries are answered here for a window of each size.
 */

/** The page's media queries, answered for a window `width` × `height` CSS pixels. */
const at = (width: number, height: number) => (query: string) => {
  if (query === WIDE) return width >= 768;
  if (query === LANDSCAPE) return width >= 1000 && width > height;
  if (query === SHORT) return height <= 500;
  throw new Error(`a query the test does not know: ${query}`);
};

describe('the remote’s layout at each size', () => {
  it('lays a phone out in tabs, upright or held sideways', () => {
    expect(layoutFor(at(375, 812))).toBe('phone');
    expect(layoutFor(at(390, 844))).toBe('phone');
    // Held sideways, an iPhone or a Pixel is as wide as a small tablet, but far too short for its columns.
    expect(layoutFor(at(844, 390))).toBe('phone');
    expect(layoutFor(at(932, 430))).toBe('phone');
    expect(layoutFor(at(915, 412))).toBe('phone');
  });

  it('puts a tablet upright’s playlist or library beside the show, and a tablet held sideways in columns', () => {
    expect(layoutFor(at(768, 1024))).toBe('wide');
    expect(layoutFor(at(810, 1080))).toBe('wide');
    expect(layoutFor(at(1024, 1366))).toBe('wide');
    expect(layoutFor(at(1024, 768))).toBe('landscape');
    expect(layoutFor(at(1080, 810))).toBe('landscape');
    expect(layoutFor(at(1366, 1024))).toBe('landscape');
  });
});
