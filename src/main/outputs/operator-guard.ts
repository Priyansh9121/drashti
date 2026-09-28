import type { DisplayInfo } from '../../shared/screens';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The display a window is on: the one holding its middle, else the one it overlaps most. */
export function displayOf(bounds: Rect, displays: readonly DisplayInfo[]): DisplayInfo | null {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const middle = displays.find(
    (d) =>
      cx >= d.bounds.x &&
      cx < d.bounds.x + d.bounds.width &&
      cy >= d.bounds.y &&
      cy < d.bounds.y + d.bounds.height,
  );
  if (middle) return middle;
  let best: DisplayInfo | null = null;
  let bestArea = 0;
  for (const d of displays) {
    const area = overlap(bounds, d.bounds);
    if (area > bestArea) {
      best = d;
      bestArea = area;
    }
  }
  return best;
}

/**
 * Where the operator window should go so that no output covers it, or null
 * to leave it where it is. It moves only when an output is on its display
 * and another display has no output; it then goes to the middle of that
 * display's work area (primary display first, then the built-in one).
 */
export function placeOperator(
  bounds: Rect,
  displays: readonly DisplayInfo[],
  outputDisplayIds: ReadonlySet<number>,
): Rect | null {
  const here = displayOf(bounds, displays);
  if (!here || !outputDisplayIds.has(here.id)) return null;
  const free = displays.filter((d) => !outputDisplayIds.has(d.id));
  const target = free.find((d) => d.primary) ?? free.find((d) => d.internal) ?? free[0];
  if (!target) return null;
  const area = target.workArea;
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
}
