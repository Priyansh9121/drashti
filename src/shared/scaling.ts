import type { ScalingMode } from './screens';

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  scaleX: number;
  scaleY: number;
  /** Offset of the scaled content inside the box, in box pixels. */
  x: number;
  y: number;
}

/**
 * Place content of one size inside a box of another:
 *   fit     - whole content visible, centred, letterboxed (uniform scale);
 *   fill    - box fully covered, centred, overflow cropped (uniform scale);
 *   stretch - content distorted to exactly the box.
 */
export function placeContent(content: Size, box: Size, mode: ScalingMode): Placement {
  if (content.width <= 0 || content.height <= 0 || box.width <= 0 || box.height <= 0) {
    return { scaleX: 0, scaleY: 0, x: 0, y: 0 };
  }
  const sx = box.width / content.width;
  const sy = box.height / content.height;
  if (mode === 'stretch') return { scaleX: sx, scaleY: sy, x: 0, y: 0 };
  const s = mode === 'fit' ? Math.min(sx, sy) : Math.max(sx, sy);
  return {
    scaleX: s,
    scaleY: s,
    x: (box.width - content.width * s) / 2,
    y: (box.height - content.height * s) / 2,
  };
}

/** The CSS transform for a placement (use with transform-origin: 0 0). */
export function placementTransform(p: Placement): string {
  return `translate(${p.x}px, ${p.y}px) scale(${p.scaleX}, ${p.scaleY})`;
}
