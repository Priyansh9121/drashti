import { describe, expect, it } from 'vitest';
import { slideElementSchema } from '../../../shared/model-schema';
import type { SlideLook } from '../../../shared/slide-edit';
import { newShape, type ShapeChoice } from './ops';

const look: SlideLook = {
  langs: {},
  background: null,
  frame: { x: 80, y: 80, width: 800, height: 400 },
  style: {
    fontFamily: null,
    fontSize: 48,
    fontWeight: 400,
    color: '#ffffff',
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.4,
    shadow: false,
  },
};

describe('Insert and Arrange slide data', () => {
  for (const shape of ['arrow', 'star', 'heart', 'check'] as const) {
    it(`makes an editable ${shape}, keeping its identity when saved`, () => {
      const made = newShape(shape as ShapeChoice, look, { width: 1920, height: 1080 });
      expect(made.shape).toBe(shape);
      expect(slideElementSchema.parse(made)).toEqual(made);
    });
  }

  it('keeps a persistent group and both flips on a shape across the content boundary', () => {
    const made = {
      ...newShape('rectangle', look, { width: 1920, height: 1080 }),
      groupId: 'placeholder-group',
      flipX: true,
      flipY: true,
    };
    expect(slideElementSchema.parse(made)).toEqual(made);
  });

  it('keeps a slide picture’s own crop without changing its library picture', () => {
    const made = {
      id: 'placeholder-picture',
      kind: 'image',
      mediaId: 'placeholder-media',
      frame: { x: 0, y: 0, width: 400, height: 300 },
      fit: 'fill',
      crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
    };
    expect(slideElementSchema.parse(made)).toEqual(made);
  });
});
