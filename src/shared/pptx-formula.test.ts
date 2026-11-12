import { describe, expect, it } from 'vitest';
import { FORMULA_LENGTH, pptxFormula, type ShapePlace } from './pptx-formula';

/** The comparison deck's box: 64 × 38 at (94, 51) of a 320 × 180 slide. */
const box: ShapePlace = { x: 126 / 320, y: 70 / 180, w: 64 / 320, h: 38 / 180 };
const slide: ShapePlace = { x: 0.5, y: 0.5, w: 1, h: 1 };
const value = (text: string, place = box) => pptxFormula(text)?.(place);

describe('PowerPoint’s own formulas of a shape’s place and size', () => {
  it('works out Basic Zoom Out’s size by how much of the slide the shape covers', () => {
    const out = '(6*min(max(#ppt_w*#ppt_h,.3),1)-7.4)/-.7*#ppt_w';
    expect(value(out)).toBeCloseTo(8 * box.w, 12);
    expect(value(out, slide)).toBeCloseTo(2, 12);
    expect(value('1+(6*min(max(#ppt_w*#ppt_h,.3),1)-7.4)/-.7*#ppt_h/2')).toBeCloseTo(1 + 4 * box.h, 12);
    expect(value('2/3*#ppt_w')).toBeCloseTo((2 / 3) * box.w, 12);
    expect(value('#ppt_w*0.6666666666666666')).toBeCloseTo((2 / 3) * box.w, 12);
    expect(value('0.5')).toBe(0.5);
    expect(value('#ppt_x')).toBe(box.x);
    expect(value('#ppt_y-0.08')).toBeCloseTo(box.y - 0.08, 12);
  });

  it('reads sums, products, powers, signs and brackets the usual way round', () => {
    expect(value('1+2*3')).toBe(7);
    expect(value('(1+2)*3')).toBe(9);
    expect(value('8/4/2')).toBe(1);
    expect(value('7-2-1')).toBe(4);
    expect(value('2^3^2')).toBe(512);
    expect(value('-.7')).toBe(-0.7);
    expect(value('--1')).toBe(1);
    expect(value('1.5E2')).toBe(150);
    expect(value(' abs( -2 ) + sqrt(9) + max(1,4,2) + min(3,1) ')).toBe(10);
  });

  it('reads nothing else, so a deck that writes something else keeps PowerPoint’s video', () => {
    for (const text of [
      '',
      'sin(#ppt_x)',
      '#ppt_q',
      '#ppt_xx',
      '$',
      'pi',
      '1+',
      '(1',
      '1)',
      'min()',
      'abs(1,2)',
      'max(1,2,3,4,5,6,7,8,9)',
      '1,2',
      `${'1+'.repeat(FORMULA_LENGTH / 2)}1`,
      `${'('.repeat(40)}1${')'.repeat(40)}`,
    ])
      expect(pptxFormula(text), text).toBeNull();
  });

  it('reads each formula once', () => {
    expect(pptxFormula('2/3*#ppt_w')).toBe(pptxFormula('2/3*#ppt_w'));
  });
});
