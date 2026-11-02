import { describe, expect, it } from 'vitest';
import { slideElementSchema } from '../../../shared/model-schema';
import { nativePathData } from '../../../shared/shape-path';
import { pdfMark } from './pdf-marks';

describe('native page marks from actual pointer samples', () => {
  it('retains a non-collinear middle point and normalized shape geometry through schema and resize', () => {
    const mark = pdfMark(
      'draw',
      [
        { x: 20, y: 20 },
        { x: 60, y: 100 },
        { x: 120, y: 30 },
      ],
      'generated-stroke',
    );
    expect(mark).toMatchObject({
      frame: { x: 20, y: 20, width: 100, height: 80 },
      shape: 'path',
      fill: null,
      outline: { color: '#1763c0', width: 3 },
      opacity: 1,
    });
    if (!mark?.path) throw new Error('Generated stroke did not contain a native path.');
    expect(mark.path.commands).toEqual([
      { op: 'M', x: 0, y: 0 },
      { op: 'L', x: 0.4, y: 1 },
      { op: 'L', x: 1, y: 0.125 },
    ]);
    expect(slideElementSchema.parse(mark)).toEqual(mark);
    expect(nativePathData(mark.path, 200, 160)).toBe('M0 0 L80 160 L200 20');
  });

  it('keeps horizontal and vertical strokes editable without infinite normalized points', () => {
    for (const points of [
      [
        { x: 10, y: 20 },
        { x: 90, y: 20 },
      ],
      [
        { x: 10, y: 20 },
        { x: 10, y: 90 },
      ],
    ]) {
      const mark = pdfMark('draw', points, 'generated-thin-stroke');
      expect(slideElementSchema.safeParse(mark).success).toBe(true);
      expect(mark?.frame.width).toBeGreaterThan(0);
      expect(mark?.frame.height).toBeGreaterThan(0);
    }
  });

  it('uses an editable translucent highlight and a distinct opaque visual cover', () => {
    const points = [
      { x: 90, y: 80 },
      { x: 10, y: 20 },
    ];
    const highlight = pdfMark('highlight', points, 'generated-highlight');
    const cover = pdfMark('cover', points, 'generated-cover');
    expect(highlight).toMatchObject({
      shape: 'path',
      frame: { x: 10, y: 20, width: 80, height: 60 },
      opacity: 0.32,
    });
    expect(cover).toMatchObject({
      shape: 'rectangle',
      frame: { x: 10, y: 20, width: 80, height: 60 },
      fill: '#000000',
      opacity: 1,
    });
    expect(slideElementSchema.safeParse(highlight).success).toBe(true);
    expect(slideElementSchema.safeParse(cover).success).toBe(true);
  });

  it('places region underline at the bottom and strike through the middle with native lines', () => {
    const points = [
      { x: 10, y: 20 },
      { x: 90, y: 60 },
    ];
    expect(pdfMark('underline', points, 'underline')?.path?.commands).toEqual([
      { op: 'M', x: 0, y: 1 },
      { op: 'L', x: 1, y: 1 },
    ]);
    expect(pdfMark('strike', points, 'strike')?.path?.commands).toEqual([
      { op: 'M', x: 0, y: 0.5 },
      { op: 'L', x: 1, y: 0.5 },
    ]);
  });

  it('creates no object for clicks, empty regions, invalid coordinates or an unbounded path', () => {
    expect(pdfMark('draw', [{ x: 1, y: 1 }], 'click')).toBeNull();
    expect(
      pdfMark(
        'draw',
        [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
        ],
        'stationary',
      ),
    ).toBeNull();
    expect(
      pdfMark(
        'highlight',
        [
          { x: 1, y: 1 },
          { x: 20, y: 1 },
        ],
        'flat-highlight',
      ),
    ).toBeNull();
    expect(
      pdfMark(
        'cover',
        [
          { x: 1, y: 1 },
          { x: 1, y: 20 },
        ],
        'flat-cover',
      ),
    ).toBeNull();
    expect(
      pdfMark(
        'draw',
        [
          { x: Number.NaN, y: 1 },
          { x: 20, y: 20 },
        ],
        'invalid',
      ),
    ).toBeNull();
    expect(
      pdfMark(
        'draw',
        Array.from({ length: 4097 }, (_, x) => ({ x, y: x % 2 })),
        'oversized',
      ),
    ).toBeNull();
  });
});
