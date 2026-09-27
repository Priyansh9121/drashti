import { describe, expect, it } from 'vitest';
import { placeContent, placementTransform } from './scaling';

const hd = { width: 1920, height: 1080 };

describe('placeContent', () => {
  it('maps a canvas 1:1 onto a box of the same size in every mode', () => {
    for (const mode of ['fit', 'fill', 'stretch'] as const) {
      expect(placeContent(hd, hd, mode)).toEqual({ scaleX: 1, scaleY: 1, x: 0, y: 0 });
    }
  });

  it('scales uniformly to a bigger display of the same shape (4K)', () => {
    expect(placeContent(hd, { width: 3840, height: 2160 }, 'fit')).toEqual({
      scaleX: 2,
      scaleY: 2,
      x: 0,
      y: 0,
    });
  });

  it('letterboxes with fit', () => {
    // 16:9 content on a 4:3 box: bars top and bottom.
    const p = placeContent(hd, { width: 1024, height: 768 }, 'fit');
    expect(p.scaleX).toBeCloseTo(1024 / 1920);
    expect(p.x).toBe(0);
    expect(p.y).toBeCloseTo((768 - 1080 * (1024 / 1920)) / 2);
  });

  it('crops with fill', () => {
    const p = placeContent(hd, { width: 1024, height: 768 }, 'fill');
    expect(p.scaleY).toBeCloseTo(768 / 1080);
    expect(p.y).toBe(0);
    expect(p.x).toBeLessThan(0);
  });

  it('distorts with stretch', () => {
    expect(placeContent(hd, { width: 1536, height: 384 }, 'stretch')).toEqual({
      scaleX: 0.8,
      scaleY: 384 / 1080,
      x: 0,
      y: 0,
    });
  });

  it('handles an empty box or content', () => {
    expect(placeContent(hd, { width: 0, height: 100 }, 'fit')).toEqual({ scaleX: 0, scaleY: 0, x: 0, y: 0 });
    expect(placeContent({ width: 0, height: 0 }, hd, 'fill').scaleX).toBe(0);
  });

  it('builds the CSS transform', () => {
    expect(placementTransform({ scaleX: 0.5, scaleY: 0.25, x: 10, y: -2 })).toBe(
      'translate(10px, -2px) scale(0.5, 0.25)',
    );
  });
});
