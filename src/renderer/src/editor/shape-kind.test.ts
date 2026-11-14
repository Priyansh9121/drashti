import { describe, expect, it } from 'vitest';
import type { ShapeElement } from '../../../shared/model';
import { DEFAULT_DRAWING } from '../../../shared/shape-path';
import { withShapeKind } from './shape-kind';

/** An imported shape filled with a gradient (a deck's): Filled shows its first stop. */
const imported = (): ShapeElement => ({
  id: 'placeholder-gradient-shape',
  kind: 'shape',
  frame: { x: 100, y: 200, width: 400, height: 300 },
  fill: null,
  cornerRadius: 0,
  opacity: 1,
  gradient: {
    kind: 'linear',
    angle: 90,
    stops: [
      { offset: 0, color: '#224466' },
      { offset: 1, color: '#88aacc' },
    ],
  },
});

describe('a shape made another kind in the inspector (Session 58, ED-6)', () => {
  it('a drawing starts unfilled: an imported gradient goes with the fill, so it never paints the drawing', () => {
    const shape = imported();
    const drawing = withShapeKind(shape, 'path');
    expect(drawing).not.toHaveProperty('gradient');
    expect(drawing).toMatchObject({
      shape: 'path',
      fill: null,
      path: DEFAULT_DRAWING,
      outline: { color: '#ffffff', width: 3 },
    });
    expect(shape.gradient).toBeDefined();
  });

  it('a line paints no fill: an imported gradient goes too, and never comes back on a later kind', () => {
    const line = withShapeKind(imported(), 'line');
    expect(line).not.toHaveProperty('gradient');
    expect(line).toMatchObject({
      shape: 'line',
      fill: null,
      frame: { x: 100, y: 340, width: 400, height: 20 },
    });
    // A solid shape's line takes its colour, without its alpha.
    const solid = withShapeKind({ ...imported(), gradient: undefined, fill: '#336699cc' }, 'line');
    expect(solid.outline).toEqual({ color: '#336699', width: 6 });
    // Back to a box: the line's black, as before, not the gradient it had.
    const box = withShapeKind(line, 'rectangle');
    expect(box).not.toHaveProperty('gradient');
    expect(box).toMatchObject({ shape: 'rectangle', fill: '#000000' });
  });

  it('a box kind keeps the shape filled as it was, its gradient too', () => {
    const shape = imported();
    const ellipse = withShapeKind(shape, 'ellipse');
    expect(ellipse.gradient).toEqual(shape.gradient);
    expect(ellipse).toMatchObject({ shape: 'ellipse', fill: null });
    const solid = withShapeKind({ ...shape, gradient: undefined, fill: '#336699' }, 'ellipse');
    expect(solid).toMatchObject({ shape: 'ellipse', fill: '#336699' });
  });
});
