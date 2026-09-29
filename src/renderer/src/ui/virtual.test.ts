import { describe, expect, it } from 'vitest';
import { layoutRows, scrollToShow, visibleRows } from './virtual';

describe('long lists', () => {
  const heights = [
    28,
    ...Array.from({ length: 999 }, () => 56),
    28,
    ...Array.from({ length: 4000 }, () => 56),
  ];
  const layout = layoutRows(heights);

  it('lays rows out one after another', () => {
    expect(layout.offsets.slice(0, 3)).toEqual([0, 28, 84]);
    expect(layout.total).toBe(28 * 2 + 56 * 4999);
  });

  it('draws only the rows in view and a margin either side', () => {
    expect(visibleRows(layout, 0, 560, 0)).toEqual({ start: 0, end: 11 });
    const middle = visibleRows(layout, 28 + 56 * 500, 560, 112);
    expect(middle.start).toBe(499);
    expect(middle.end - middle.start).toBeLessThan(20);
    expect(visibleRows(layout, layout.total, 560, 0).end).toBe(heights.length);
    expect(visibleRows(layoutRows([]), 0, 560, 100)).toEqual({ start: 0, end: 0 });
  });

  it('scrolls a row into view only when it is out of view', () => {
    expect(scrollToShow(layout, heights, 3, 0, 560)).toBeNull();
    expect(scrollToShow(layout, heights, 100, 0, 560)).toBe(28 + 56 * 100 - 560);
    expect(scrollToShow(layout, heights, 2, 5000, 560)).toBe(84);
    expect(scrollToShow(layout, heights, 99_999, 0, 560)).toBeNull();
  });
});
