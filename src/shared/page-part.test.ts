import { describe, expect, it } from 'vitest';
import { madeSlideName, pagePartSchema, partDrawing } from './page-part';

/*
 * Make a slide… (alpha.21): a part of a PDF page drawn from the page itself, as large as fits in the hall's picture
 * size, its own shape kept. Placeholder names only.
 */

describe('partDrawing', () => {
  it('draws the whole page as large as fits, its shape kept', () => {
    expect(
      partDrawing({ x: 0, y: 0, w: 1, h: 1 }, { width: 480, height: 320 }, { width: 1920, height: 1080 }),
    ).toEqual({ scale: 3.375, width: 1620, height: 1080, dx: 0, dy: 0 });
  });

  it('draws a part at the hall’s size, not as a part of the page’s picture: sharper the smaller it is', () => {
    // A quarter across and half down of a 480 x 320 page: 120 x 160 points, fitted into 1920 x 1080.
    const d = partDrawing(
      { x: 0, y: 0, w: 0.25, h: 0.5 },
      { width: 480, height: 320 },
      { width: 1920, height: 1080 },
    );
    expect(d).toEqual({ scale: 6.75, width: 810, height: 1080, dx: 0, dy: 0 });
    // The page moves left and up by where the part starts, at that scale.
    const later = partDrawing(
      { x: 0.5, y: 0.25, w: 0.25, h: 0.5 },
      { width: 480, height: 320 },
      { width: 1920, height: 1080 },
    );
    expect(later).toEqual({
      scale: 6.75,
      width: 810,
      height: 1080,
      dx: 0.5 * 480 * 6.75,
      dy: 0.25 * 320 * 6.75,
    });
  });

  it('fits a wide part by its width, and a portrait page into a tall room', () => {
    expect(
      partDrawing({ x: 0, y: 0.1, w: 1, h: 0.1 }, { width: 595, height: 842 }, { width: 1920, height: 1080 }),
    ).toMatchObject({ width: 1920, height: Math.round(84.2 * (1920 / 595)) });
    expect(
      partDrawing({ x: 0, y: 0, w: 1, h: 1 }, { width: 595, height: 842 }, { width: 1080, height: 1920 }),
    ).toMatchObject({ width: 1080, height: Math.round(842 * (1080 / 595)) });
  });

  it('keeps sums of hundredths from going a pixel over', () => {
    let w = 1;
    for (let i = 0; i < 75; i++) w -= 0.01;
    let h = 1;
    for (let i = 0; i < 50; i++) h -= 0.01;
    expect(
      partDrawing({ x: 0, y: 0, w, h }, { width: 480, height: 320 }, { width: 1920, height: 1080 }),
    ).toMatchObject({ width: 810, height: 1080 });
  });

  it('is never less than a pixel each way', () => {
    const d = partDrawing(
      { x: 0, y: 0, w: 0.05, h: 0.05 },
      { width: 100_000, height: 1 },
      { width: 1920, height: 1080 },
    );
    expect(d.width).toBeGreaterThanOrEqual(1);
    expect(d.height).toBeGreaterThanOrEqual(1);
  });
});

describe('pagePartSchema', () => {
  it('takes a part on the page, sums of hundredths too', () => {
    expect(pagePartSchema.safeParse({ x: 0, y: 0, w: 1, h: 1 }).success).toBe(true);
    expect(pagePartSchema.safeParse({ x: 0.5, y: 0.25, w: 0.5, h: 0.75 }).success).toBe(true);
    expect(pagePartSchema.safeParse({ x: 0.7000000000000001, y: 0, w: 0.3, h: 1 }).success).toBe(true);
  });

  it('refuses a part off the page, too small, or not numbers', () => {
    for (const part of [
      { x: 0.6, y: 0, w: 0.5, h: 1 },
      { x: 0, y: 0.9, w: 1, h: 0.2 },
      { x: -0.1, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0, w: 0.01, h: 0.5 },
      { x: 0, y: 0, w: Number.NaN, h: 0.5 },
      { x: '0', y: 0, w: 1, h: 1 },
      null,
    ])
      expect(pagePartSchema.safeParse(part).success, JSON.stringify(part)).toBe(false);
  });
});

describe('madeSlideName', () => {
  it('names the page, and a part of it', () => {
    expect(madeSlideName('Placeholder PDF tools', 1, true)).toBe('Placeholder PDF tools, page 1');
    expect(madeSlideName('Placeholder PDF tools', 3, false)).toBe('Placeholder PDF tools, page 3 (part)');
  });

  it('keeps a long name within a presentation’s 200 characters, cut on a letter', () => {
    const name = madeSlideName('ક'.repeat(400), 12, false);
    expect(name.length).toBeLessThanOrEqual(200);
    expect(name.endsWith(', page 12 (part)')).toBe(true);
  });
});
