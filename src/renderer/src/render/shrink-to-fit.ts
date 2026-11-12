import { MIN_FIT } from '../../../shared/readable';

/*
 * Shrink-to-fit's search (useShrinkToFit, render/SlideView.tsx): the largest fit (at most 1, never below MIN_FIT) at
 * which a box's words fit it, found by halving. Each halving draws the words at a new fit and measures them, and a
 * measure after a change lays the window out again.
 *
 * Every box drawn in one commit searches together (Session 57, MS-1). One box at a time, each of its 14 measures laid
 * out the whole window again: a slide of a 250-cell imported table took 3,500 layouts, and the hall screen drew no
 * frame for up to 2.5 s. Together, every box takes each step at once: all drawn at their next fit, then all measured,
 * so a slide takes 14 layouts in all (1 when every box's words fit). Each box is drawn at the same fits and measured
 * as often as alone, so it ends at exactly the same fit: one box's fit never moves another's words (each box has
 * its own place and size).
 *
 * The boxes are queued from their layout effects and measured in a microtask the first one queues: right after
 * the commit, before the browser draws its next frame, so words are never drawn unfitted. Each window (renderer)
 * has its own queue.
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

/** A box still searching: the largest fit known to fit (lo), the smallest known not to (hi), and the one drawn. */
interface Search {
  box: FitBox;
  lo: number;
  hi: number;
  mid: number;
}

/**
 * Measures boxes together, each step for all of them at once: every box drawn, then every box measured. A failure
 * telling one box its measure leaves the others told, and comes through after.
 */
export function fitTogether(boxes: readonly FitBox[]): void {
  // Each box at a fit of 1 (shrink-to-fit on) or at none; whose words run past at 1 searches.
  for (const box of boxes) box.write(box.on ? 1 : null);
  const searches: Search[] = [];
  for (const box of boxes) if (box.on && box.over()) searches.push({ box, lo: MIN_FIT, hi: 1, mid: 1 });
  for (let step = 0; step < FIT_STEPS && searches.length > 0; step++) {
    for (const s of searches) {
      s.mid = (s.lo + s.hi) / 2;
      s.box.write(s.mid);
    }
    for (const s of searches) {
      if (s.box.over()) s.hi = s.mid;
      else s.lo = s.mid;
    }
  }
  for (const s of searches) s.box.write(s.lo);
  // Each measured at the fit it ends at, then told.
  const fitOf = new Map(searches.map((s) => [s.box, s.lo]));
  const measured = boxes.map((box) => ({ box, fit: fitOf.get(box) ?? 1, over: box.over() }));
  const failures: unknown[] = [];
  for (const { box, fit, over } of measured) {
    try {
      box.settle(fit, over);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}

/** The boxes queued since the last batch, in the order their layout effects ran. */
const queued = new Set<FitBox>();
let batchQueued = false;

function measureQueued(): void {
  batchQueued = false;
  const boxes = [...queued];
  queued.clear();
  fitTogether(boxes);
}

/**
 * Measures a box with every other box queued in the same commit (from its layout effect). What it returns forgets
 * the box if its batch has not run (its effect's cleanup: the box went, or its effect runs again).
 */
export function queueFit(box: FitBox): () => void {
  queued.add(box);
  if (!batchQueued) {
    batchQueued = true;
    queueMicrotask(measureQueued);
  }
  return () => {
    queued.delete(box);
  };
}
