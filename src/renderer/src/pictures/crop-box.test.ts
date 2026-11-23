import { describe, expect, it } from 'vitest';
import { cropReadout, keptCrop, shownCrop } from './crop-box';

/*
 * The crop's box shared by the Picture editor, the slide editor's Crop picture and Make a slide… (alpha.21): a slide's
 * crop is kept in its picture's own shares; the box works over the picture as the slide shows it (flipped too).
 */

describe('shownCrop and keptCrop', () => {
  it('shows no crop as the whole picture, and keeps the whole picture as no crop', () => {
    expect(shownCrop(undefined)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(keptCrop({ x: 0, y: 0, w: 1, h: 1 })).toBeUndefined();
    // Within a ten-thousandth of the whole: no crop.
    expect(keptCrop({ x: 0.00001, y: 0, w: 0.99999, h: 1 })).toBeUndefined();
  });

  it('keeps a crop as it is, unflipped', () => {
    const crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };
    expect(shownCrop(crop)).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 });
    expect(keptCrop({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 })).toEqual(crop);
  });

  it('mirrors a flipped picture’s crop: the side taken off on the screen is the side taken off in the box', () => {
    const crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };
    // Flipped across: the left tenth of the picture is on the right of what shows.
    expect(shownCrop(crop, true, false)).toEqual({ x: 0.4, y: 0.2, w: 0.5, h: 0.6 });
    const both = shownCrop(crop, true, true);
    expect(both.x).toBeCloseTo(0.4, 12);
    expect(both.y).toBeCloseTo(0.2, 12);
    for (const [fx, fy] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ] as const)
      expect(keptCrop(shownCrop(crop, fx, fy), fx, fy)).toEqual(crop);
  });

  it('keeps hundredths from the arrows as hundredths, to a ten-thousandth', () => {
    let x = 0;
    for (let i = 0; i < 30; i++) x += 0.01;
    let w = 1 - x;
    for (let i = 0; i < 20; i++) w -= 0.01;
    expect(keptCrop({ x, y: 0, w, h: 1 })).toEqual({ x: 0.3, y: 0, width: 0.5, height: 1 });
  });
});

describe('cropReadout', () => {
  it('says what is taken off each side, in whole percent', () => {
    expect(cropReadout({ x: 0, y: 0, w: 1, h: 1 })).toBe('Taken off: left 0%, top 0%, right 0%, bottom 0%');
    expect(cropReadout({ x: 0, y: 0, w: 0.4975, h: 1 })).toBe(
      'Taken off: left 0%, top 0%, right 50%, bottom 0%',
    );
    expect(cropReadout({ x: 0.25, y: 0.1, w: 0.5, h: 0.4 })).toBe(
      'Taken off: left 25%, top 10%, right 25%, bottom 50%',
    );
  });
});
