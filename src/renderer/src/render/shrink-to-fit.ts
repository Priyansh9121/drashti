import { MIN_FIT } from '../../../shared/readable';

/*
 * Shrink-to-fit's search (useShrinkToFit, render/SlideView.tsx): the largest fit (at most 1, never below MIN_FIT) at
 * which a box's words fit it, found by halving. Each halving draws the words at a new fit and measures them, and a
 * measure after a change lays the window out again. Each box searches by itself, in its own layout effect.
 */

/** A box of words as shrink-to-fit measures it. */
export interface FitBox {
  /** Shrink-to-fit is on: its fit is searched for. Off: it is only measured, at no fit. */
  readonly on: boolean;
  /** Draws its words at this fit (null: none set). The next measure lays the window out again. */
  write(fit: number | null): void;
  /** Whether its words run past it as drawn now (a measure of the layout). */
  over(): boolean;
  /** Its measure, once found: the fit its words are drawn at, and whether they still run past it. */
  settle(fit: number, over: boolean): void;
}

/** How many times the search halves: the fit to within 0.9 / 4096 of the largest that fits. */
export const FIT_STEPS = 12;

function fitAlone(box: FitBox): void {
  if (!box.on) {
    box.write(null);
    box.settle(1, box.over());
    return;
  }
  const fits = (fit: number) => {
    box.write(fit);
    return !box.over();
  };
  let lo = 1;
  if (!fits(1)) {
    lo = MIN_FIT;
    let hi = 1;
    for (let i = 0; i < FIT_STEPS; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    box.write(lo);
  }
  box.settle(lo, box.over());
}

/** Measures boxes, each by itself. */
export function fitTogether(boxes: readonly FitBox[]): void {
  for (const box of boxes) fitAlone(box);
}

/** Measures a box (from its layout effect). What it returns forgets the box (its effect's cleanup). */
export function queueFit(box: FitBox): () => void {
  fitAlone(box);
  return () => undefined;
}
