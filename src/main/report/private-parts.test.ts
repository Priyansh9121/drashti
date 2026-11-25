import { describe, expect, it } from 'vitest';
import type { CapturedPicture } from '../../shared/pdf-copy';
import { REPORT_PRIVATE_ATTR } from '../../shared/report-private';
import {
  blankPrivateParts,
  PRIVATE_PARTS_SCRIPT,
  type PrivateParts,
  readPrivateParts,
  takePrivately,
} from './private-parts';

/*
 * Report a Problem's picture of the operator window never shows the chat's words or names (alpha.23, QA23-CHAT-1
 * Safety): what the page marks with REPORT_PRIVATE_ATTR is blanked in the pixels before the report holds them.
 */

/** A picture of one colour: every pixel [10, 200, 30, 255]. */
const picture = (width: number, height: number): CapturedPicture => {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([10, 200, 30, 255], i);
  return { width, height, pixels, order: 'bgra' };
};

const at = (p: CapturedPicture, x: number, y: number) => [
  ...p.pixels.slice((y * p.width + x) * 4, (y * p.width + x) * 4 + 4),
];
const ORIGINAL = [10, 200, 30, 255];

/** How many pixels are no longer the original colour. */
const changed = (p: CapturedPicture) => {
  let n = 0;
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if (at(p, x, y)[1] !== 200) n++;
  return n;
};

describe('the parts of a window kept out of Report a Problem’s picture', () => {
  it('blanks each marked box, with a margin, and nothing else', () => {
    const p = picture(100, 80);
    const parts: PrivateParts = { width: 100, height: 80, rects: [[20, 10, 30, 20]] };
    const out = blankPrivateParts(p, [parts]);
    // Inside, and just outside (the margin), blanked; further out, as it was.
    expect(at(out, 20, 10)).not.toEqual(ORIGINAL);
    expect(at(out, 49, 29)).not.toEqual(ORIGINAL);
    expect(at(out, 18, 8)).not.toEqual(ORIGINAL);
    expect(at(out, 10, 10)).toEqual(ORIGINAL);
    expect(at(out, 60, 50)).toEqual(ORIGINAL);
    // Opaque, so nothing shows through.
    expect(at(out, 25, 15)[3]).toBe(255);
    // The picture given is left as it was (the caller's copy).
    expect(changed(p)).toBe(0);
  });

  it('maps the page’s boxes onto the picture’s pixels (a Retina window’s picture is twice the page)', () => {
    const p = picture(200, 160);
    const out = blankPrivateParts(p, [{ width: 100, height: 80, rects: [[20, 10, 30, 20]] }]);
    expect(at(out, 40, 20)).not.toEqual(ORIGINAL);
    expect(at(out, 99, 59)).not.toEqual(ORIGINAL);
    expect(at(out, 30, 20)).toEqual(ORIGINAL);
    expect(at(out, 110, 70)).toEqual(ORIGINAL);
  });

  it('blanks the boxes read before and after the picture was taken (the section moved meanwhile)', () => {
    const out = blankPrivateParts(picture(100, 80), [
      { width: 100, height: 80, rects: [[0, 0, 10, 10]] },
      { width: 100, height: 80, rects: [[60, 40, 10, 10]] },
    ]);
    expect(at(out, 5, 5)).not.toEqual(ORIGINAL);
    expect(at(out, 65, 45)).not.toEqual(ORIGINAL);
    expect(at(out, 35, 25)).toEqual(ORIGINAL);
  });

  it('keeps a box partly off the window within the picture, and ignores empty ones', () => {
    const out = blankPrivateParts(picture(50, 40), [
      {
        width: 50,
        height: 40,
        rects: [
          [-30, -30, 40, 40],
          [45, 35, 100, 100],
          [20, 20, 0, 0],
        ],
      },
    ]);
    expect(at(out, 0, 0)).not.toEqual(ORIGINAL);
    expect(at(out, 49, 39)).not.toEqual(ORIGINAL);
    expect(at(out, 20, 20)).toEqual(ORIGINAL);
  });

  it('reads only what the page script answers in its own form', () => {
    expect(readPrivateParts({ width: 100, height: 80, rects: [[1, 2, 3, 4]] })).toEqual({
      width: 100,
      height: 80,
      rects: [[1, 2, 3, 4]],
    });
    expect(readPrivateParts({ width: 100, height: 80, rects: [] })).toEqual({
      width: 100,
      height: 80,
      rects: [],
    });
    for (const bad of [
      null,
      'x',
      { width: 0, height: 80, rects: [] },
      { width: 100, height: Number.NaN, rects: [] },
      { width: 100, height: 80 },
      { width: 100, height: 80, rects: [[1, 2, 3]] },
      { width: 100, height: 80, rects: [[1, 2, 3, Number.POSITIVE_INFINITY]] },
      { width: 100, height: 80, rects: Array.from({ length: 5001 }, () => [0, 0, 1, 1]) },
    ])
      expect(readPrivateParts(bad), JSON.stringify(bad)).toBeNull();
  });

  it('the page script looks for the shared attribute and answers the viewport and boxes', () => {
    expect(PRIVATE_PARTS_SCRIPT).toContain(`[${REPORT_PRIVATE_ATTR}]`);
    expect(PRIVATE_PARTS_SCRIPT).toContain('getBoundingClientRect');
    expect(PRIVATE_PARTS_SCRIPT).toContain('innerWidth');
  });

  it('takes the picture between two reads of the marked parts, and gives no picture when either read fails', async () => {
    const steps: string[] = [];
    const parts = { width: 10, height: 10, rects: [[1, 1, 2, 2]] };
    const got = await takePrivately(
      () => {
        steps.push('read');
        return Promise.resolve(parts);
      },
      () => {
        steps.push('take');
        return Promise.resolve('the picture');
      },
    );
    expect(steps).toEqual(['read', 'take', 'read']);
    expect(got).toEqual({ taken: 'the picture', parts: [parts, parts] });

    let reads = 0;
    const failsAfter = await takePrivately(
      () => Promise.resolve(++reads === 1 ? parts : 'not parts'),
      () => Promise.resolve('the picture'),
    );
    expect(failsAfter).toBeNull();
    const throwsBefore = await takePrivately(
      () => Promise.reject(new Error('the page is gone')),
      () => Promise.resolve('the picture'),
    );
    expect(throwsBefore).toBeNull();
    const noPicture = await takePrivately(
      () => Promise.resolve(parts),
      () => Promise.resolve(null),
    );
    expect(noPicture).toBeNull();
  });
});
