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

/** A rectangle of content, in content pixels. */
export interface ContentRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The part of the content a box shows, in content pixels (Sessions 31–36, SLD-2): all of it with fit and
 * stretch, the middle of it when fill crops it.
 */
export function shownPart(content: Size, box: Size, mode: ScalingMode): ContentRect {
  const p = placeContent(content, box, mode);
  if (p.scaleX <= 0 || p.scaleY <= 0) return { x: 0, y: 0, width: content.width, height: content.height };
  const x = Math.max(0, -p.x / p.scaleX);
  const y = Math.max(0, -p.y / p.scaleY);
  return {
    x,
    y,
    width: Math.min(content.width, box.width / p.scaleX),
    height: Math.min(content.height, box.height / p.scaleY),
  };
}

/** Where a box cuts the content off, as lines in content pixels: none when it shows all of it. */
export function cropLines(content: Size, box: Size, mode: ScalingMode): { across: number[]; down: number[] } {
  const shown = shownPart(content, box, mode);
  const cut = (at: number, size: number, whole: number) =>
    at > 0.5 || at + size < whole - 0.5 ? [at, at + size] : [];
  return {
    across: cut(shown.y, shown.height, content.height),
    down: cut(shown.x, shown.width, content.width),
  };
}

/**
 * A band along the bottom of a box (a share of its height), in content pixels: where it falls on the content
 * as the box places it. Null when it falls below the content (a letterboxed slide's bar holds it).
 */
export function bottomBand(
  content: Size,
  box: Size,
  mode: ScalingMode,
  share: number,
): { top: number; bottom: number } | null {
  const p = placeContent(content, box, mode);
  if (p.scaleY <= 0) return null;
  const top = (box.height * (1 - share) - p.y) / p.scaleY;
  const bottom = (box.height - p.y) / p.scaleY;
  if (top >= content.height) return null;
  return { top: Math.max(0, top), bottom: Math.min(content.height, bottom) };
}
