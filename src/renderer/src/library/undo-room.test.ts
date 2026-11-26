import { describe, expect, it } from 'vitest';
import { footKept } from './undo-room';

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
