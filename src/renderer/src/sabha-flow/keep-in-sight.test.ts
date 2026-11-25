import { describe, expect, it } from 'vitest';
import { nearestScrollTop } from './keep-in-sight';

/*
 * Now kept in sight in the read list (QA23-FLOW-2) by its own box alone: as Back and Next move Now, the list scrolls
 * the least that shows the Now row whole, and never the panel around it (so Back and Next never move from under the
 * pointer). Rows by their top within the list's content and their height; the box by its scrollTop and height.
 */

describe('the read list keeps Now in sight by its own box', () => {
  const box = { scrollTop: 100, height: 200 };

  it('leaves the box as it is while the row shows whole', () => {
    expect(nearestScrollTop(box, { top: 100, height: 30 })).toBe(100);
    expect(nearestScrollTop(box, { top: 270, height: 30 })).toBe(100);
  });

  it('scrolls up to a row above, its top at the box’s top', () => {
    expect(nearestScrollTop(box, { top: 40, height: 30 })).toBe(40);
    expect(nearestScrollTop(box, { top: 90, height: 30 })).toBe(90);
  });

  it('scrolls down to a row below, its bottom at the box’s bottom', () => {
    expect(nearestScrollTop(box, { top: 290, height: 30 })).toBe(120);
    expect(nearestScrollTop(box, { top: 500, height: 40 })).toBe(340);
  });

  it('shows the top of a row taller than the box', () => {
    expect(nearestScrollTop(box, { top: 400, height: 260 })).toBe(400);
    expect(nearestScrollTop(box, { top: 20, height: 260 })).toBe(20);
  });

  it('never scrolls above the list’s top', () => {
    expect(nearestScrollTop({ scrollTop: 50, height: 200 }, { top: -5, height: 30 })).toBe(0);
  });
});
