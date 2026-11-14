import type { ShapeElement, ShapeKind } from '../../../shared/model';
import { DEFAULT_DRAWING } from '../../../shared/shape-path';

/*
 * A shape made another kind in the inspector's Kind (Inspector.tsx's ShapeSection). A drawing starts unfilled with an
 * outline, a line is an outline across the shape's middle, and a box kind keeps the shape's fill (a line's black).
 * A drawing and a line leave an imported gradient behind with the fill (Session 58, ED-6), as Fill's "not filled"
 * does (ops.ts's setShapeFill): kept, it painted the new drawing, and a line carried it unseen into a later box kind.
 */

/** The shape as this kind. */
export function withShapeKind(el: ShapeElement, next: ShapeKind): ShapeElement {
  const kind = el.shape ?? 'rectangle';
  const outline = el.outline ?? null;
  if (next === 'path' || next === 'line') {
    const { gradient: _gradient, ...shape } = el;
    if (next === 'path')
      return {
        ...shape,
        shape: 'path',
        path: el.path ?? structuredClone(DEFAULT_DRAWING),
        fill: null,
        outline: outline ?? { color: '#ffffff', width: 3 },
      };
    return {
      ...shape,
      shape: 'line',
      path: undefined,
      fill: null,
      outline: outline ?? { color: el.fill?.slice(0, 7) ?? '#ffffff', width: 6 },
      frame: { ...el.frame, y: el.frame.y + el.frame.height / 2 - 10, height: 20 },
    };
  }
  return { ...el, shape: next, path: undefined, fill: el.fill ?? (kind === 'line' ? '#000000' : null) };
}
