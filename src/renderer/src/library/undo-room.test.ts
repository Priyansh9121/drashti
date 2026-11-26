import { describe, expect, it } from 'vitest';
import { footKept, watchPointer } from './undo-room';

/*
 * The Undo line's room (QA24-UNDOLINE-2): when the line goes with the pointer over the left column, or during one of
 * Drashti's drags, its room stays, empty, until the pointer is somewhere else; with the pointer elsewhere it goes at
 * once, as before. The page's half (the pointer over the column, the room's height) is tests/e2e/undo-line-room.spec.ts.
 */

const at = (shown: boolean, kept: boolean, overColumn: boolean, dragging: boolean) =>
  footKept({ shown, kept, overColumn, dragging });

describe('the Undo line’s room', () => {
  it('is the line while the line shows, wherever the pointer is', () => {
    expect(at(true, false, false, false)).toBe(true);
    expect(at(true, true, true, false)).toBe(true);
    expect(at(true, true, false, true)).toBe(true);
  });

  it('stays, once the line has gone, while the pointer is over the left column', () => {
    expect(at(false, true, true, false)).toBe(true);
  });

  it('stays, once the line has gone, while one of Drashti’s drags is under way (a drag moves no pointer)', () => {
    expect(at(false, true, false, true)).toBe(true);
  });

  it('closes once the pointer is elsewhere and no drag is under way, and the line goes at once then', () => {
    expect(at(false, true, false, false)).toBe(false);
  });

  it('never comes by itself: only a line that was there leaves one', () => {
    expect(at(false, false, true, false)).toBe(false);
    expect(at(false, false, false, true)).toBe(false);
    expect(at(false, false, true, true)).toBe(false);
  });
});

/** Each time the line is told to read the column's :hover again, counted; the column and the page stand-ins. */
function watched(roomKept: boolean) {
  const column = new EventTarget();
  const page = new EventTarget();
  let reads = 0;
  const stop = watchPointer(column, page, roomKept, () => {
    reads += 1;
  });
  return { column, page, stop, reads: () => reads };
}

describe('what tells the Undo line where the pointer is', () => {
  it('the column’s mouseenter and mouseleave, while the line shows or its room is kept', () => {
    for (const roomKept of [false, true]) {
      const w = watched(roomKept);
      w.column.dispatchEvent(new Event('mouseenter'));
      w.column.dispatchEvent(new Event('mouseleave'));
      expect(w.reads()).toBe(2);
      w.stop();
    }
  });

  it('while its room is kept, any mouseover in the window too: a menu or dialog that closed under a still pointer leaves the column no mouseleave for the first move out (the review’s SHOULD-2)', () => {
    const w = watched(true);
    // The pointer moved straight out of the column onto the middle: no mouseleave came, the middle's mouseover did.
    w.page.dispatchEvent(new Event('mouseover'));
    expect(w.reads()).toBe(1);
    w.stop();
  });

  it('while the line shows, not every mouseover in the window (its :hover is read again when it goes)', () => {
    const w = watched(false);
    w.page.dispatchEvent(new Event('mouseover'));
    expect(w.reads()).toBe(0);
    w.stop();
  });

  it('nothing once it has stopped watching', () => {
    const w = watched(true);
    w.stop();
    w.column.dispatchEvent(new Event('mouseenter'));
    w.column.dispatchEvent(new Event('mouseleave'));
    w.page.dispatchEvent(new Event('mouseover'));
    expect(w.reads()).toBe(0);
  });
});
