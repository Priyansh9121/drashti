/*
 * Row maths for long lists: only the rows in view (and a margin either side)
 * are drawn, so a library of thousands of presentations stays quick.
 */

export interface RowLayout {
  /** Where each row starts. */
  offsets: number[];
  total: number;
}

export function layoutRows(heights: readonly number[]): RowLayout {
  const offsets: number[] = [];
  let total = 0;
  for (const h of heights) {
    offsets.push(total);
    total += h;
  }
  return { offsets, total };
}

/** The first row that ends below `y`. */
function rowAt(offsets: readonly number[], total: number, y: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((offsets[mid] ?? total) <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The rows to draw, [start, end), for a viewport at `scrollTop` with `margin` pixels drawn either side. */
export function visibleRows(
  layout: RowLayout,
  scrollTop: number,
  viewport: number,
  margin: number,
): { start: number; end: number } {
  const count = layout.offsets.length;
  if (count === 0) return { start: 0, end: 0 };
  const start = rowAt(layout.offsets, layout.total, Math.max(0, scrollTop - margin));
  const last = rowAt(layout.offsets, layout.total, scrollTop + viewport + margin);
  return { start, end: Math.min(count, last + 1) };
}

/** Where to scroll so row `index` is in view, or null when it already is. */
export function scrollToShow(
  layout: RowLayout,
  heights: readonly number[],
  index: number,
  scrollTop: number,
  viewport: number,
): number | null {
  const top = layout.offsets[index];
  const height = heights[index];
  if (top === undefined || height === undefined) return null;
  if (top < scrollTop) return top;
  if (top + height > scrollTop + viewport) return Math.max(0, top + height - viewport);
  return null;
}
