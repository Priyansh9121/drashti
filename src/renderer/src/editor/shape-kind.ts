import type { ShapeElement, ShapeKind } from '../../../shared/model';
import { DEFAULT_DRAWING } from '../../../shared/shape-path';

/*
 * A shape made another kind in the inspector's Kind (Inspector.tsx's ShapeSection). A drawing starts unfilled with an
 * outline, a line is an outline across the shape's middle, and a box kind keeps the shape's fill (a line's black).
 */

/** The shape as this kind. */
export function withShapeKind(el: ShapeElement, next: ShapeKind): ShapeElement {
  const kind = el.shape ?? 'rectangle';
  const outline = el.outline ?? null;
  if (next === 'path')
    return {
      ...el,
      shape: 'path',
      path: el.path ?? structuredClone(DEFAULT_DRAWING),
      fill: null,
      outline: outline ?? { color: '#ffffff', width: 3 },
    };
  if (next === 'line')
    return {
      ...el,
      shape: 'line',
      path: undefined,
      fill: null,
      outline: outline ?? { color: el.fill?.slice(0, 7) ?? '#ffffff', width: 6 },
      frame: { ...el.frame, y: el.frame.y + el.frame.height / 2 - 10, height: 20 },
    };
  return { ...el, shape: next, path: undefined, fill: el.fill ?? (kind === 'line' ? '#000000' : null) };
}
