import { describe, expect, it } from 'vitest';
import {
  autoLevels,
  cssFilter,
  fillZoom,
  framed,
  isPlain,
  liveZoomAt,
  lookOf,
  moveRoom,
  PLAIN,
  sharpenKernel,
  sharpenStep,
  ZOOM_GLIDE_MS,
} from './picture-look';

/* A picture's look (Session 26e): kept settings, framing, Auto's levels, the screens' filters, the live zoom. */

describe('a picture’s look', () => {
  it('is kept only when it changes something, and only as it should be', () => {
    expect(isPlain(PLAIN)).toBe(true);
    expect(isPlain(null)).toBe(true);
    expect(lookOf(null)).toBeNull();
    expect(lookOf(JSON.stringify(PLAIN))).toBeNull();
    expect(lookOf('{"zoom": 9}')).toBeNull();
    expect(lookOf('not json')).toBeNull();
    const look = { ...PLAIN, zoom: 2, x: 0.25, brightness: 0.1, sharpness: 0.5 };
    expect(lookOf(JSON.stringify(look))).toEqual(look);
  });

  it('keeps its zoom between 100 and 400 %, and its picture covering what it covered', () => {
    expect(moveRoom(1)).toBe(0);
    expect(moveRoom(3)).toBe(1);
    expect(framed({ ...PLAIN, zoom: 9, x: 5, y: -5 })).toMatchObject({ zoom: 4, x: 1.5, y: -1.5 });
    expect(framed({ ...PLAIN, zoom: 0.5, x: 0.3 })).toMatchObject({ zoom: 1, x: 0 });
    expect(framed({ ...PLAIN, zoom: 2, x: 0.3 })).toMatchObject({ zoom: 2, x: 0.3 });
  });

  it('fills a frame of another shape: a 4:3 picture in a 16:9 frame at 133 %', () => {
    expect(fillZoom({ width: 1440, height: 1080 }, { width: 1920, height: 1080 })).toBeCloseTo(4 / 3);
    expect(fillZoom({ width: 1920, height: 1080 }, { width: 1920, height: 1080 })).toBe(1);
    expect(fillZoom({ width: 1080, height: 1920 }, { width: 1920, height: 1080 })).toBe(3.1604938271604937);
  });

  it('Auto stretches a picture’s levels from its own darkest and brightest', () => {
    // A dull picture: everything between 0.25 and 0.75.
    const dull = Array<number>(256).fill(0);
    for (let i = 64; i <= 191; i++) dull[i] = 10;
    const { brightness, contrast } = autoLevels(dull);
    // brightness then contrast: v' = (v·B − ½)·C + ½ maps 0.25 to black and 0.75 to white.
    const map = (v: number) => (v * (1 + brightness) - 0.5) * (1 + contrast) + 0.5;
    expect(brightness).toBeCloseTo(0, 1);
    expect(contrast).toBe(0.5);
    expect(map(0.5)).toBeCloseTo(0.5, 1);
    expect(map(0.25)).toBeLessThan(0.25);
    // A dark picture is brightened.
    const dark = Array<number>(256).fill(0);
    for (let i = 0; i <= 100; i++) dark[i] = 10;
    expect(autoLevels(dark).brightness).toBeGreaterThan(0.4);
    // A picture already using every level is left nearly as it is (its darkest and brightest 1 % aside).
    const full = autoLevels(Array<number>(256).fill(1));
    expect(Math.abs(full.brightness)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(full.contrast)).toBeLessThanOrEqual(0.02);
    expect(autoLevels(Array<number>(256).fill(0))).toEqual({ brightness: 0, contrast: 0 });
  });

  it('draws with the screens’ own filters, its sharpening in steps of 5 %', () => {
    expect(cssFilter(null)).toBe('');
    expect(cssFilter(PLAIN)).toBe('');
    expect(cssFilter({ ...PLAIN, brightness: 0.2, contrast: -0.1, colour: 0.5 })).toBe(
      'brightness(1.2) contrast(0.9) saturate(1.5)',
    );
    expect(sharpenStep(0.33)).toBe(35);
    expect(sharpenStep(0)).toBe(0);
    expect(sharpenKernel(50)).toEqual([0, -0.5, 0, -0.5, 3, -0.5, 0, -0.5, 0]);
    // A kernel that keeps a flat picture as it is.
    expect(sharpenKernel(80).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('a live zoom glides from where it was to where it goes, by the engine’s clock, then holds', () => {
    const z = {
      mediaId: 'm',
      showing: 'slide:1',
      zoom: 2,
      x: 0.5,
      y: 0,
      from: { zoom: 1, x: 0, y: 0 },
      at: 1000,
    };
    expect(liveZoomAt(z, 1000)).toEqual({ zoom: 1, x: 0, y: 0 });
    const half = liveZoomAt(z, 1000 + ZOOM_GLIDE_MS / 2);
    expect(half.zoom).toBeGreaterThan(1.5);
    expect(half.zoom).toBeLessThan(2);
    expect(liveZoomAt(z, 1000 + ZOOM_GLIDE_MS)).toEqual({ zoom: 2, x: 0.5, y: 0 });
    expect(liveZoomAt(z, 99_999)).toEqual({ zoom: 2, x: 0.5, y: 0 });
  });
});
