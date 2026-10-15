import { describe, expect, it } from 'vitest';
import {
  autoLevels,
  copyBox,
  copySize,
  copyStep,
  cssFilter,
  drawnCanvas,
  fillZoom,
  framed,
  isPlain,
  liveZoomAt,
  lookOf,
  moveRoom,
  PLAIN,
  sharpenKernel,
  sharpenPixels,
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

  it('sharpens a picture’s own pixels with the kernel the screens’ filter had: edges duplicated, alpha kept', () => {
    // Four pixels across, one down: grey 96, 96, 160, 160, the last half see-through.
    const rgba = (...greys: [number, number][]) =>
      new Uint8ClampedArray(greys.flatMap(([v, a]) => [v, v, v, a]));
    const src = rgba([96, 255], [96, 255], [160, 255], [160, 128]);
    const out = sharpenPixels(src, 4, 1, 50);
    // At 50 %: centre 3, each side −0.5 (above and below are the pixel itself, duplicated at the edge).
    // 3·96 − 0.5·(96 + 96 + 96 + 96) = 96; 3·96 − 0.5·(96 + 160 + 96 + 96) = 64; 3·160 − 0.5·(96 + 160·3) = 192.
    expect([...out]).toEqual([...rgba([96, 255], [64, 255], [192, 255], [160, 128])]);
    // The source is left as it was, and nothing is sharpened at 0 %.
    expect([...src]).toEqual([...rgba([96, 255], [96, 255], [160, 255], [160, 128])]);
    expect([...sharpenPixels(src, 4, 1, 0)]).toEqual([...src]);
    // Past black and white it stops there.
    const hard = sharpenPixels(rgba([0, 255], [255, 255]), 2, 1, 100);
    expect([hard[0], hard[4]]).toEqual([0, 255]);
    // Down a column as across a row.
    const down = sharpenPixels(rgba([96, 255], [160, 255]), 1, 2, 50);
    expect([down[0], down[4]]).toEqual([64, 192]);
  });

  it('draws the sharpened copy only once one at its sharpness is ready, else the picture unsharpened', () => {
    // No look, no sharpening, or no copy yet: the picture itself (unsharpened meanwhile).
    expect(copyStep(null)).toBe(0);
    expect(copyStep({ ...PLAIN, brightness: 0.2 })).toBe(0);
    expect(copyStep({ ...PLAIN, sharpness: 0.5 })).toBe(0);
    // The copy of an older sharpness (the new one being made): not that one either.
    expect(copyStep({ ...PLAIN, sharpness: 0.5, copy: 80 })).toBe(0);
    expect(copyStep({ ...PLAIN, sharpness: 0.5, copy: 50 })).toBe(50);
    // The copy's step never comes from a kept look.
    expect(lookOf(JSON.stringify({ ...PLAIN, sharpness: 0.5, copy: 50 }))).toEqual({
      ...PLAIN,
      sharpness: 0.5,
    });
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

describe('a sharpened copy’s size (Session 26g)', () => {
  it('is the screen’s canvas as drawn: fitted, filled or stretched into its window', () => {
    const canvas = { width: 1920, height: 1080 };
    expect(drawnCanvas(canvas, { width: 3840, height: 2160 }, 'fit')).toEqual({ width: 3840, height: 2160 });
    expect(drawnCanvas(canvas, { width: 1920, height: 1200 }, 'fit')).toEqual({ width: 1920, height: 1080 });
    expect(drawnCanvas(canvas, { width: 1920, height: 1200 }, 'fill')).toEqual({ width: 2133, height: 1200 });
    expect(drawnCanvas(canvas, { width: 1024, height: 768 }, 'stretch')).toEqual({
      width: 1024,
      height: 768,
    });
  });

  it('is the picture fitted whole into the screen’s picture at its zoom, never bigger than it is', () => {
    const screen = { width: 1920, height: 1080 };
    expect(copyBox(screen, 1)).toEqual(screen);
    expect(copyBox(screen, 2)).toEqual({ width: 3840, height: 2160 });
    expect(copyBox(screen, 9)).toEqual({ width: 7680, height: 4320 });
    expect(copyBox(null, 2)).toBeNull();
    // A 4000 x 3000 photo on a 1920 x 1080 screen: 1440 x 1080; zoomed 200 %, 2880 x 2160.
    expect(copySize({ width: 4000, height: 3000 }, copyBox(screen, 1))).toEqual({
      width: 1440,
      height: 1080,
    });
    expect(copySize({ width: 4000, height: 3000 }, copyBox(screen, 2))).toEqual({
      width: 2880,
      height: 2160,
    });
    // A small picture keeps its own size; with no screen, its own size.
    expect(copySize({ width: 800, height: 600 }, copyBox(screen, 1))).toEqual({ width: 800, height: 600 });
    expect(copySize({ width: 4000, height: 3000 }, null)).toEqual({ width: 4000, height: 3000 });
  });
});
