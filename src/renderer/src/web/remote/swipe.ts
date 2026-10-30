/*
 * Swipes on the phone's live picture (Session 55, Part 9): a swipe to the left (the finger moves left) is Next, a swipe
 * to the right is Back, like turning a page. The Back and Next buttons stay. What counts is one finger (or a pen) that
 * moves mostly sideways, far enough and quickly enough, and lifts; never two fingers (zooming: the gesture that began
 * with two never counts, whichever lifts first), a tap, a drag mostly up or down (the page's own scroll), a mouse, or a
 * touch the browser took for itself (pointercancel: its scroll or its own zoom). Pure, so the rules are tested apart
 * from the page (swipe.test.ts); RemoteApp.tsx feeds it the live picture's pointer events.
 */

/** How far the finger moves sideways, at least (CSS pixels). */
export const SWIPE_MIN_PX = 50;
/** How long it may take, at most (ms): longer is a slow drag, not a swipe. */
export const SWIPE_MAX_MS = 1000;
/** How much it may move up or down for each pixel sideways, at most. */
const SWIPE_SLOPE = 0.6;
/** A click within this long after a swipe (a mouse's, or a stray tap's) is the swipe's, not a tap. */
const SWIPED_CLICK_MS = 500;

export type SwipeWay = 'next' | 'back';

/** What a pointer event says, as much as a swipe needs. */
export interface SwipePoint {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  timeStamp: number;
}

interface Finger {
  x: number;
  y: number;
  at: number;
}

export class Swipes {
  private readonly down_ = new Map<number, Finger>();
  /** The gesture now: two fingers at once, or one the browser took, never counts until every finger has lifted. */
  private spoiled = false;
  private swipedAt = -Infinity;

  /** A finger (or a pen) touches: the first starts a gesture; a second spoils it (zooming). */
  down(p: SwipePoint): void {
    if (p.pointerType !== 'touch' && p.pointerType !== 'pen') return;
    if (this.down_.size > 0) this.spoiled = true;
    this.down_.set(p.pointerId, { x: p.clientX, y: p.clientY, at: p.timeStamp });
  }

  /** A finger moves (nothing to do until it lifts: only where it began and ended count). */
  move(p: SwipePoint): void {
    void p;
  }

  /** The browser took the touch for itself (its scroll, its own zoom): the gesture never counts. */
  cancel(p: Pick<SwipePoint, 'pointerId'>): void {
    if (!this.down_.has(p.pointerId)) return;
    this.down_.delete(p.pointerId);
    this.spoiled = this.down_.size > 0;
  }

  /** A finger lifts: Next or Back when it made a swipe on its own, else null. */
  up(p: SwipePoint): SwipeWay | null {
    const start = this.down_.get(p.pointerId);
    if (!start) return null;
    this.down_.delete(p.pointerId);
    if (this.spoiled) {
      // The last finger of a spoiled gesture lifting: the next one counts again.
      if (this.down_.size === 0) this.spoiled = false;
      return null;
    }
    const dx = p.clientX - start.x;
    const dy = p.clientY - start.y;
    const quick = p.timeStamp - start.at <= SWIPE_MAX_MS;
    const sideways = Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dy) <= Math.abs(dx) * SWIPE_SLOPE;
    if (!quick || !sideways) return null;
    this.swipedAt = p.timeStamp;
    // The finger moving left turns to the next page.
    return dx < 0 ? 'next' : 'back';
  }

  /** Whether a click at `now` (the event's timeStamp) is a swipe's own, just lifted: it opens nothing. */
  justSwiped(now: number): boolean {
    return now - this.swipedAt < SWIPED_CLICK_MS;
  }
}
