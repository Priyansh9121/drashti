import { describe, expect, it } from 'vitest';
import { MIN_FIT } from '../../../shared/readable';
import { FIT_STEPS, type FitBox, fitTogether, queueFit, reportFitFailuresTo } from './shrink-to-fit';

/*
 * Shrink-to-fit's search over many boxes at once (Session 57, MS-1: a slide of a 250-cell table froze the hall screen
 * for seconds). The unit tests run in Electron's Node, with no window to lay out, so a stand-in counts the layouts:
 * drawing a box at a new fit changes the layout, and the next measure of any box lays the window out again, as the
 * browser does (tests/e2e/text-measure-order.spec.ts counts the browser's own).
 */

/** A window's layout: changed by a write, laid out again (counted) by the next read. */
class Layout {
  layouts = 0;
  private changed = false;
  write(): void {
    this.changed = true;
  }
  read(): void {
    if (!this.changed) return;
    this.layouts++;
    this.changed = false;
  }
}

/** A stand-in box: what it was drawn at, how often it was measured, and what it was told. */
interface Probe extends FitBox {
  writes: (number | null)[];
  reads: number;
  settled: { fit: number; over: boolean }[];
}

/**
 * A box whose words run past it when `past` says so at the fit it is drawn at (none set draws them at 1). `told`
 * runs after it is told its measure (a report).
 */
function probe(
  layout: Layout,
  past: (fit: number) => boolean,
  { on = true, told, guess }: { on?: boolean; told?: () => void; guess?: number } = {},
): Probe {
  let drawn: number | null = null;
  const box: Probe = {
    on,
    guess,
    writes: [],
    reads: 0,
    settled: [],
    write(fit) {
      layout.write();
      drawn = fit;
      box.writes.push(fit);
    },
    over() {
      layout.read();
      box.reads++;
      return past(drawn ?? 1);
    },
    settle(fit, over) {
      box.settled.push({ fit, over });
      told?.();
    },
  };
  return box;
}

/** Words that need `need` times the room the box has at a fit of 1 (they fit once need × fit is at most 1). */
const needing = (need: number) => (fit: number) => need * fit > 1;

/** The search as each box ran it alone, in its own layout effect, until Session 57 (SlideView's useShrinkToFit). */
function searchAlone(box: FitBox): void {
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
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    box.write(lo);
  }
  box.settle(lo, box.over());
}

/** Until every box queued so far has been measured: their batch runs in a microtask queued before this one. */
const measured = () =>
  new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });

/** The fit a box was told, or NaN when it was told nothing. */
const fitOf = (box: Probe) => box.settled.at(0)?.fit ?? Number.NaN;

/** Boxes of every kind: fitting, shrinking a little or a lot, never fitting, measured only, and uneven words. */
function variety(layout: Layout): Probe[] {
  const boxes: Probe[] = [];
  for (let i = 0; i < 120; i++) boxes.push(probe(layout, needing(0.4 + i * 0.09)));
  // Fitting exactly at 1, and words that fit only at the floor, or never.
  boxes.push(probe(layout, needing(1)), probe(layout, needing(1 / MIN_FIT)), probe(layout, needing(40)));
  // Words that wrap unevenly: a smaller fit can run past where a larger one fit.
  for (let i = 0; i < 40; i++) boxes.push(probe(layout, (fit) => Math.sin(fit * (17 + i)) > 0.3 - i / 100));
  // Shrink-to-fit off: measured as drawn, past or not.
  boxes.push(
    probe(layout, () => true, { on: false }),
    probe(layout, () => false, { on: false }),
  );
  return boxes;
}

describe('shrink-to-fit over a slide of many boxes (Session 57, MS-1)', () => {
  it('lays out a slide of 250 shrinking boxes 14 times in all, not 14 times for each box', async () => {
    const before = new Layout();
    for (let i = 0; i < 250; i++) searchAlone(probe(before, needing(1.5 + (i % 9))));
    expect(before.layouts).toBe(250 * (FIT_STEPS + 2));

    const layout = new Layout();
    const boxes = Array.from({ length: 250 }, (_, i) => probe(layout, needing(1.5 + (i % 9))));
    for (const box of boxes) queueFit(box);
    await measured();
    expect(layout.layouts).toBe(FIT_STEPS + 2);
    expect(boxes.every((box) => box.settled.length === 1 && fitOf(box) < 1)).toBe(true);
  });

  it('lays out a slide of 250 boxes whose words fit once in all', async () => {
    const before = new Layout();
    for (let i = 0; i < 250; i++) searchAlone(probe(before, needing(0.5)));
    expect(before.layouts).toBe(250);

    const layout = new Layout();
    const boxes = Array.from({ length: 250 }, () => probe(layout, needing(0.5)));
    for (const box of boxes) queueFit(box);
    await measured();
    expect(layout.layouts).toBe(1);
    expect(boxes.map((box) => box.settled)).toEqual(boxes.map(() => [{ fit: 1, over: false }]));
  });

  it('draws and measures each box exactly as its search alone did, so each ends at the same fit', async () => {
    const alone = variety(new Layout());
    for (const box of alone) searchAlone(box);
    const together = variety(new Layout());
    for (const box of together) queueFit(box);
    await measured();
    expect(together.map(({ writes, reads, settled }) => ({ writes, reads, settled }))).toEqual(
      alone.map(({ writes, reads, settled }) => ({ writes, reads, settled })),
    );
    // The variety holds every outcome: fitting, shrunk, at the floor and still past, and measured only.
    const told = together.map((box) => ({ fit: fitOf(box), over: box.settled.at(0)?.over }));
    expect(told.some((t) => t.fit === 1 && t.over === false)).toBe(true);
    expect(told.some((t) => t.fit > MIN_FIT && t.fit < 1 && t.over === false)).toBe(true);
    expect(told.some((t) => t.fit === MIN_FIT && t.over === true)).toBe(true);
    expect(told.some((t) => t.fit === 1 && t.over === true)).toBe(true);
  });

  it('measures nothing during the commit: the boxes queued in it are measured together right after it', async () => {
    const layout = new Layout();
    const boxes = [
      probe(layout, needing(3)),
      probe(layout, needing(0.5)),
      probe(layout, () => true, { on: false }),
    ];
    for (const box of boxes) queueFit(box);
    expect(boxes.map((box) => [box.writes.length, box.reads, box.settled.length])).toEqual([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    await measured();
    expect(boxes.map((box) => box.settled.length)).toEqual([1, 1, 1]);
    expect(layout.layouts).toBe(FIT_STEPS + 2);
  });

  it('never measures a box gone before its batch ran, and measures the others', async () => {
    const layout = new Layout();
    const [first, gone, last] = [
      probe(layout, needing(2)),
      probe(layout, needing(2)),
      probe(layout, needing(2)),
    ];
    queueFit(first);
    const forget = queueFit(gone);
    queueFit(last);
    forget();
    await measured();
    expect(gone.writes).toEqual([]);
    expect(gone.reads).toBe(0);
    expect(gone.settled).toEqual([]);
    expect([first.settled.length, last.settled.length]).toEqual([1, 1]);
    expect(layout.layouts).toBe(FIT_STEPS + 2);
  });

  it('measures a box asked again before its batch ran (new words, a font arrived) once, as it is now', async () => {
    const layout = new Layout();
    const was = probe(layout, needing(4));
    const now = probe(layout, needing(2));
    // Its layout effect ran again: the cleanup forgets the first ask, the effect asks again.
    queueFit(was)();
    queueFit(now);
    await measured();
    expect(was.writes).toEqual([]);
    expect(was.settled).toEqual([]);
    const alone = probe(new Layout(), needing(2));
    searchAlone(alone);
    expect(now.settled).toEqual(alone.settled);
  });

  it('measures one box changed later (words typed in the editor) by itself, leaving the others alone', async () => {
    const layout = new Layout();
    const boxes = Array.from({ length: 50 }, (_, i) => probe(layout, needing(1 + i / 10)));
    for (const box of boxes) queueFit(box);
    await measured();
    const writes = boxes.map((box) => box.writes.length);
    layout.layouts = 0;
    const typed = probe(layout, needing(3.5));
    queueFit(typed);
    await measured();
    expect(boxes.map((box) => box.writes.length)).toEqual(writes);
    expect(typed.settled).toHaveLength(1);
    expect(layout.layouts).toBe(FIT_STEPS + 2);
  });

  it('measures a box asked for while a batch is told its results in a batch of its own, after it', async () => {
    const layout = new Layout();
    const late = probe(layout, needing(2));
    let lateWritesWhenAsked = -1;
    const first = probe(layout, needing(2), {
      told: () => {
        queueFit(late);
        lateWritesWhenAsked = late.writes.length;
      },
    });
    queueFit(first);
    await measured();
    await measured();
    expect(lateWritesWhenAsked).toBe(0);
    expect([first.settled.length, late.settled.length]).toEqual([1, 1]);
  });

  it('tells every box its measure when telling some fail, then reports each failure, as the window reports it', () => {
    // Session 58, MS-2: until then the first failure came through uncaught (the console only) and the rest were lost.
    const layout = new Layout();
    const told: string[] = [];
    const reported: { error: unknown; told: number }[] = [];
    reportFitFailuresTo((error) => {
      reported.push({ error, told: told.length });
    });
    const first = new Error('Placeholder first report failure');
    const second = new Error('Placeholder second report failure');
    const failing = probe(layout, needing(2), {
      told: () => {
        told.push('failing');
        throw first;
      },
    });
    const between = probe(layout, needing(2), {
      told: () => {
        told.push('between');
      },
    });
    const alsoFailing = probe(layout, needing(0.5), {
      told: () => {
        told.push('also failing');
        throw second;
      },
    });
    expect(() => {
      fitTogether([failing, between, alsoFailing]);
    }).not.toThrow();
    expect(told).toEqual(['failing', 'between', 'also failing']);
    expect([failing, between, alsoFailing].map((box) => box.settled.length)).toEqual([1, 1, 1]);
    // Each reported on its own, once every box of the batch was told.
    expect(reported).toEqual([
      { error: first, told: 3 },
      { error: second, told: 3 },
    ]);
  });

  it('reports a failure in a batch the window’s way, never uncaught, and the next batch is measured', async () => {
    const reported: unknown[] = [];
    reportFitFailuresTo((error) => {
      reported.push(error);
    });
    const failure = new Error('Placeholder report failure');
    const failing = probe(new Layout(), needing(2), {
      told: () => {
        throw failure;
      },
    });
    queueFit(failing);
    await measured();
    expect(failing.settled).toHaveLength(1);
    expect(reported).toEqual([failure]);
    const next = probe(new Layout(), needing(2));
    queueFit(next);
    await measured();
    expect(next.settled).toHaveLength(1);
    expect(reported).toEqual([failure]);
  });

  it('draws a deck box at PowerPoint’s own fit where its words fit at it, and searches only below it where they do not', () => {
    // Session 58, PF-4b made exact (Q58-42; run 4's movie: PowerPoint draws its saved shrink, never larger): the
    // source's own fit is drawn first and kept when the words fit at it, even where they would fit larger; where they
    // do not, the largest fit below it at which they do.
    const roomy = probe(new Layout(), needing(1.25), { guess: 0.7857 });
    fitTogether([roomy]);
    expect(roomy.writes).toEqual([0.7857]);
    expect(roomy.settled).toEqual([{ fit: 0.7857, over: false }]);
    // Words that fit unshrunk too: PowerPoint still draws them at its own fit.
    const fitting = probe(new Layout(), needing(0.5), { guess: 0.85 });
    fitTogether([fitting]);
    expect(fitting.writes).toEqual([0.85]);
    expect(fitting.settled).toEqual([{ fit: 0.85, over: false }]);
    // Words that need more room than PowerPoint's fit gives them here: the largest fit below it (0.625), searched
    // from it down, never above it.
    const tight = probe(new Layout(), needing(1.6), { guess: 0.7857 });
    fitTogether([tight]);
    expect(tight.writes[0]).toBe(0.7857);
    expect(Math.max(...tight.writes.filter((w): w is number => w !== null))).toBe(0.7857);
    expect(fitOf(tight)).toBeLessThanOrEqual(0.625);
    expect(fitOf(tight)).toBeGreaterThan(0.625 - 0.9 / 4096);
    // No source fit (or one of 1, or below the floor): as before, at 1, searched from halfway where the words run past.
    const plain = probe(new Layout(), needing(1.25));
    const atOne = probe(new Layout(), needing(2), { guess: 1 });
    const below = probe(new Layout(), needing(0.5), { guess: MIN_FIT / 2 });
    fitTogether([plain, atOne, below]);
    expect(plain.writes.slice(0, 2)).toEqual([1, (MIN_FIT + 1) / 2]);
    expect(atOne.writes.slice(0, 2)).toEqual([1, (MIN_FIT + 1) / 2]);
    expect(below.writes).toEqual([1]);
    expect(fitOf(plain)).toBeLessThanOrEqual(0.8);
    expect(fitOf(plain)).toBeGreaterThan(0.8 - 0.9 / 4096);
  });

  it('reports a failure that comes again on every fit once in the window, and a different one once too', async () => {
    // The lead's review of Session 58's MS-2: a report that keeps failing would otherwise go to the window's report
    // (its console, the main process) on every slide drawn and every key typed.
    const reported: string[] = [];
    reportFitFailuresTo((error) => {
      reported.push(error instanceof Error ? error.message : String(error));
    });
    const failing = (message: string) =>
      probe(new Layout(), needing(2), {
        told: () => {
          throw new Error(message);
        },
      });
    for (let fit = 0; fit < 3; fit++) {
      queueFit(failing('Placeholder failure on every fit'));
      queueFit(failing('Placeholder failure on every fit'));
      await measured();
    }
    queueFit(failing('Placeholder other failure'));
    await measured();
    queueFit(failing('Placeholder other failure'));
    await measured();
    expect(reported).toEqual(['Placeholder failure on every fit', 'Placeholder other failure']);
  });
});
