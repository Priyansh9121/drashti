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
 *
 * Each box is then told its measure, and tells whoever asked (MeasureContext: a thumbnail's mark, the slide
 * editor's inspector), still in that microtask. A report must change nothing when told the same measure again, and
 * must never draw the boxes again with new effect dependencies each time it is told (Session 58, MS-4): those boxes
 * would be queued and measured again, report again, and so on for ever, in microtasks, where React's limit on nested
 * updates never stops it, and the window would freeze with no error. A report that fails is the window's to report,
 * as a render error, once for each distinct failure, while every other box is still told and the window draws on
 * (MS-2; reportFitFailuresTo).
 */

/** A box of words as shrink-to-fit measures it. */
export interface FitBox {
  /** Shrink-to-fit is on: its fit is searched for. Off: it is only measured, at no fit. */
  readonly on: boolean;
  /**
   * The source's own fit (PowerPoint's shrink, Session 58's PF-4b; source-fit.ts's sourceFitScale), drawn first and
   * kept where the words fit at it, as PowerPoint draws them, even where they would fit larger (Q58-42); where they do
   * not, the largest fit below it at which they do. None (or 1, or below the floor): the largest fit up to 1.
   */
  readonly guess?: number | undefined;
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
 * Where a failure telling a box its measure goes: a report's (the box itself is already drawn at its fit). The
 * console's, as an uncaught error's, until the window says how it reports a render error.
 */
let reportFailure = (error: unknown): void => {
  reportError(error);
};

/**
 * How this window reports a failure telling a box its measure (Session 58, MS-2): the windows with reports (the
 * operator's thumbnails, the slide editor's inspector) give their own report of render errors (ui/render-errors.ts:
 * their console and the main process's log), and the window draws on. Not React's error path: that would take the
 * whole window down to "This window stopped working" for a thumbnail's mark.
 */
export function reportFitFailuresTo(report: (error: unknown) => void): void {
  reportFailure = report;
}

/**
 * The failures this window has reported: each distinct one is reported once (the lead's review of MS-2), as a report
 * that keeps failing fails on every slide drawn and every key typed. Distinct: its words and where it was thrown (its
 * stack). At most this many are kept: past them, nothing more is reported (the console and the log have plenty).
 */
const reportedFailures = new Set<string>();
const MOST_FAILURES_REPORTED = 50;

/** Reports a failure telling a box its measure, unless this window has reported the same one. */
function reportOnce(error: unknown): void {
  const key =
    error instanceof Error ? [error.name, error.message, error.stack ?? ''].join('\n') : String(error);
  if (reportedFailures.has(key) || reportedFailures.size >= MOST_FAILURES_REPORTED) return;
  reportedFailures.add(key);
  reportFailure(error);
}

/**
 * Measures boxes together, each step for all of them at once: every box drawn, then every box measured. A failure
 * telling one box its measure leaves the others told; each is reported after, as the window reports a render error
 * (reportFitFailuresTo).
 */
export function fitTogether(boxes: readonly FitBox[]): void {
  // Each box at its source's own fit (PowerPoint's, where it has one inside: Session 58, PF-4b), else at a fit of 1
  // (shrink-to-fit on) or at none; whose words run past it there searches below it.
  const startOf = (box: FitBox) => {
    const own = box.guess;
    return own !== undefined && own > MIN_FIT && own < 1 ? own : 1;
  };
  for (const box of boxes) box.write(box.on ? startOf(box) : null);
  const searches: Search[] = [];
  const kept = new Map<FitBox, number>();
  for (const box of boxes) {
    if (!box.on) continue;
    const start = startOf(box);
    if (box.over()) searches.push({ box, lo: MIN_FIT, hi: start, mid: start });
    else if (start < 1) kept.set(box, start);
  }
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
  // Each measured at the fit it ends at, then told (a box kept at its source's own fit, at that).
  const fitOf = new Map([...kept, ...searches.map((s): [FitBox, number] => [s.box, s.lo])]);
  const measured = boxes.map((box) => ({ box, fit: fitOf.get(box) ?? 1, over: box.over() }));
  const failures: unknown[] = [];
  for (const { box, fit, over } of measured) {
    try {
      box.settle(fit, over);
    } catch (error) {
      failures.push(error);
    }
  }
  // Each on its own (Session 58, MS-2): until then the first came through uncaught, to the console only.
  for (const error of failures) reportOnce(error);
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
