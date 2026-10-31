import { describe, expect, it } from 'vitest';
import { Swipes, SWIPE_MIN_PX } from './swipe';

/*
 * Swipes on the phone's live picture (Session 55, Part 9): the finger moving left is Next and moving right is Back,
 * like turning a page; two fingers (zooming) never count, nor a tap, a short or slow drag, a drag up or down (the page
 * scrolls), or a touch the browser took for itself (pointercancel). Times in ms, places in CSS pixels.
 */

type Kind = 'touch' | 'pen' | 'mouse';

/** One finger from `from` to `to` in `ms`, in a few moves. */
function drag(
  s: Swipes,
  from: [number, number],
  to: [number, number],
  {
    id = 1,
    ms = 200,
    kind = 'touch',
    at = 1000,
  }: { id?: number; ms?: number; kind?: Kind; at?: number } = {},
) {
  s.down({ pointerId: id, pointerType: kind, clientX: from[0], clientY: from[1], timeStamp: at });
  for (let step = 1; step <= 4; step++)
    s.move({
      pointerId: id,
      pointerType: kind,
      clientX: from[0] + ((to[0] - from[0]) * step) / 4,
      clientY: from[1] + ((to[1] - from[1]) * step) / 4,
      timeStamp: at + (ms * step) / 4,
    });
  return s.up({ pointerId: id, pointerType: kind, clientX: to[0], clientY: to[1], timeStamp: at + ms });
}

describe('swipes on the live picture (Session 55, Part 9)', () => {
  it('turns the page: the finger moving left is Next, moving right is Back', () => {
    expect(drag(new Swipes(), [300, 100], [120, 110])).toBe('next');
    expect(drag(new Swipes(), [60, 100], [260, 92])).toBe('back');
    // A pen too.
    expect(drag(new Swipes(), [300, 100], [100, 100], { kind: 'pen' })).toBe('next');
  });

  it('never counts a tap, a short drag, a slow one, or one mostly up or down (the page scrolls)', () => {
    expect(drag(new Swipes(), [200, 100], [200, 100], { ms: 80 })).toBeNull();
    expect(drag(new Swipes(), [200, 100], [200 - (SWIPE_MIN_PX - 1), 100])).toBeNull();
    expect(drag(new Swipes(), [300, 100], [100, 100], { ms: 1500 })).toBeNull();
    expect(drag(new Swipes(), [200, 300], [150, 100])).toBeNull();
    expect(drag(new Swipes(), [200, 100], [120, 180])).toBeNull();
  });

  it('never counts two fingers (zooming), even when one of them moves sideways or lifts first', () => {
    const s = new Swipes();
    s.down({ pointerId: 1, pointerType: 'touch', clientX: 150, clientY: 100, timeStamp: 1000 });
    s.down({ pointerId: 2, pointerType: 'touch', clientX: 250, clientY: 100, timeStamp: 1010 });
    for (let step = 1; step <= 4; step++) {
      s.move({
        pointerId: 1,
        pointerType: 'touch',
        clientX: 150 - step * 30,
        clientY: 100,
        timeStamp: 1000 + step * 40,
      });
      s.move({
        pointerId: 2,
        pointerType: 'touch',
        clientX: 250 + step * 30,
        clientY: 100,
        timeStamp: 1000 + step * 40,
      });
    }
    expect(
      s.up({ pointerId: 2, pointerType: 'touch', clientX: 370, clientY: 100, timeStamp: 1200 }),
    ).toBeNull();
    // The finger left on the picture carries on left: still no swipe, the gesture began with two.
    s.move({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 100, timeStamp: 1250 });
    expect(
      s.up({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 100, timeStamp: 1300 }),
    ).toBeNull();
    // And the next one-finger swipe counts again.
    expect(drag(s, [300, 100], [100, 100], { at: 2000 })).toBe('next');
  });

  it('never counts what the browser took for itself (a scroll or its own zoom: pointercancel), nor a mouse', () => {
    const s = new Swipes();
    s.down({ pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 100, timeStamp: 1000 });
    s.move({ pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 100, timeStamp: 1100 });
    s.cancel({ pointerId: 1 });
    expect(
      s.up({ pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100, timeStamp: 1200 }),
    ).toBeNull();
    expect(drag(s, [300, 100], [100, 100], { kind: 'mouse', at: 2000 })).toBeNull();
    // A finger lifted that never came down here: nothing.
    expect(s.up({ pointerId: 9, pointerType: 'touch', clientX: 0, clientY: 0, timeStamp: 3000 })).toBeNull();
  });

  it('says whether the last lift was a swipe, so its click (a mouse’s or a stray tap’s) opens nothing', () => {
    const s = new Swipes();
    expect(drag(s, [300, 100], [100, 100], { at: 1000 })).toBe('next');
    expect(s.justSwiped(1300)).toBe(true);
    expect(s.justSwiped(1800)).toBe(false);
  });
});
