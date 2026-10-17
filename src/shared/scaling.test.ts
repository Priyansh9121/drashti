import { describe, expect, it } from 'vitest';
import { bottomBand, cropLines, placeContent, shownPart, placementTransform } from './scaling';

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

describe('what a screen cuts off, and where its bands fall (Sessions 31–36, SLD-2)', () => {
  const fourThree = { width: 1024, height: 768 };
  const wide = { width: 1920, height: 1080 };

  it('a 4:3 slide on a 16:9 Fill group is cut at 96 and 672, and nowhere with Fit or Stretch', () => {
    expect(shownPart(fourThree, wide, 'fill')).toEqual({ x: 0, y: 96, width: 1024, height: 576 });
    expect(cropLines(fourThree, wide, 'fill')).toEqual({ across: [96, 672], down: [] });
    expect(cropLines(fourThree, wide, 'fit')).toEqual({ across: [], down: [] });
    expect(cropLines(fourThree, wide, 'stretch')).toEqual({ across: [], down: [] });
    // A 16:9 slide on a 4:3 Fill group loses its sides.
    const sides = cropLines(wide, fourThree, 'fill');
    expect({ across: sides.across, down: sides.down.map((n) => Math.round(n * 1000) / 1000) }).toEqual({
      across: [],
      down: [240, 1680],
    });
    expect(cropLines(wide, wide, 'fill')).toEqual({ across: [], down: [] });
  });

  it('the ticker’s band (7.5%) on a 1080 slide filling its screen starts at 999', () => {
    expect(bottomBand(wide, wide, 'fit', 0.075)).toEqual({ top: 999, bottom: 1080 });
    // Letterboxed (a 16:9 slide on a 4:3 screen, Fit): the band sits in the bar below the slide.
    expect(bottomBand(wide, fourThree, 'fit', 0.075)).toBeNull();
    // Cropped (a 4:3 slide filling a 16:9 screen): the band is just above the cut.
    const band = bottomBand(fourThree, wide, 'fill', 0.075);
    expect(band?.top).toBeCloseTo(672 - 576 * 0.075, 6);
    expect(band?.bottom).toBeCloseTo(672, 6);
  });
});
