import type { Movement } from '../../../shared/looks';
import type { LowerThirdLine } from '../../../shared/program';
import { EASE, seg } from './easing';
import type { UnitFrame } from './reveal';

/*
 * How a lower third moves (Session 27, the design lab's): it comes in when it goes up, its box holds while
 * its words change to the next slide's, and it leaves with a short fade when the slide is taken off on its
 * own (Clear all, Black-out and the Logo stay immediate). Calm fades in place; Bold opens its box from the
 * middle and lets its lines rise into place. Each a pure function of the time since it began (the slide's
 * shownAt, or when it was taken off), so every screen, key and fill and the stream draw the same frame.
 */

export type LowerThirdPhase = 'in' | 'change' | 'out';

/** A lower third part-way: the whole box's opacity, how far in from each side its box is cut (percent; null: not cut), and its words. */
export interface LowerThirdFrame {
  whole: number;
  side: number | null;
  /** The old words, all together. */
  oldWords: number;
  oldLine(i: number): UnitFrame;
  newLine(i: number): UnitFrame;
}

const still: UnitFrame = { opacity: 1, rise: 0 };

/** How long a phase takes, in ms (the lab's), for so many new and old lines. */
export function lowerThirdLength(phase: LowerThirdPhase, movement: Movement, newLines: number): number {
  const bold = movement === 'bold';
  const last = Math.max(0, newLines - 1) * 60;
  switch (phase) {
    case 'in':
      return bold ? Math.max(350, 120 + last + 360) : 250;
    case 'change':
      return bold ? Math.max(200, 120 + last + 300) : 400;
    case 'out':
      return bold ? 310 : 180;
  }
}

/** A lower third `t` ms into a phase. */
export function lowerThirdFrame(phase: LowerThirdPhase, movement: Movement, t: number): LowerThirdFrame {
  const bold = movement === 'bold';
  switch (phase) {
    case 'in': {
      if (!bold)
        return {
          whole: seg(t, 0, 250, EASE.out),
          side: null,
          oldWords: 0,
          oldLine: () => still,
          newLine: () => still,
        };
      const p = seg(t, 0, 350, EASE.out);
      return {
        whole: 1,
        side: p >= 1 ? null : 50 * (1 - p),
        oldWords: 0,
        oldLine: () => still,
        newLine: (i) => {
          const q = seg(t, 120 + i * 60, 360, EASE.out);
          return { opacity: q, rise: 16 * (1 - q) };
        },
      };
    }
    case 'change': {
      if (!bold) {
        const x = seg(t, 0, 400, EASE.smooth);
        return {
          whole: 1,
          side: null,
          oldWords: 1 - x,
          oldLine: () => still,
          newLine: () => ({ opacity: x, rise: 0 }),
        };
      }
      return {
        whole: 1,
        side: null,
        oldWords: 1,
        oldLine: () => {
          const p = seg(t, 0, 200, EASE.out);
          return { opacity: 1 - p, rise: -12 * p };
        },
        newLine: (i) => {
          const p = seg(t, 120 + i * 60, 300, EASE.out);
          return { opacity: p, rise: 16 * (1 - p) };
        },
      };
    }
    case 'out': {
      if (!bold)
        return {
          whole: 1 - seg(t, 0, 180, EASE.out),
          side: null,
          oldWords: 1,
          oldLine: () => still,
          newLine: () => still,
        };
      const p = seg(t, 60, 250, EASE.out);
      return {
        whole: 1,
        side: 50 * p,
        oldWords: 1 - seg(t, 0, 120, EASE.out),
        oldLine: () => still,
        newLine: () => still,
      };
    }
  }
}

/**
 * What a slide's moving lower third is doing (render/LowerThird.tsx): the lines up, the lines going (changed
 * from, or taken off), and the motion it began when what was up last changed, from when; `still` or `gone` when
 * it began none (a screen that comes along later draws what is up, still).
 */
export interface LowerThirdRun {
  key: string | null;
  lines: LowerThirdLine[];
  prev: LowerThirdLine[] | null;
  phase: LowerThirdPhase | 'still' | 'gone';
  start: number;
}

/** How long a run's motion takes, in ms (0: none). */
export const lowerThirdRunLength = (run: LowerThirdRun, movement: Movement): number =>
  run.phase === 'still' || run.phase === 'gone' ? 0 : lowerThirdLength(run.phase, movement, run.lines.length);

/**
 * A run as it is drawn at `now`, the engine's time (Session 51): its motion part-way, or once that is over, still
 * (gone after going out). A pure function of the run and the time, however many frames a screen drew before, so
 * a key and its fill draw the same at the same moment. Before, only a screen's next animation frame ended a
 * motion: a key whose window had none yet drew its lower third coming in when its fill drew it still.
 */
export function lowerThirdAt(run: LowerThirdRun, movement: Movement, now: number): LowerThirdRun {
  if (run.phase === 'still' || run.phase === 'gone') return run;
  if (now - run.start < lowerThirdRunLength(run, movement)) return run;
  return { ...run, prev: null, phase: run.phase === 'out' ? 'gone' : 'still' };
}

/**
 * What a lower third begins when what is up changes (`key`: a slide's id and shownAt; null, none), at `now`: in, a
 * change as its box holds (when it draws words then), or out when the slide was taken off on its own
 * (`leaving`: state.slideOff); else gone at once (Clear all, a slide with no words). The run keeps its motion even
 * when it is over by `now` (a screen told late): lowerThirdAt draws it as the time has it.
 */
export function nextLowerThirdRun(
  was: LowerThirdRun,
  key: string | null,
  lines: LowerThirdLine[],
  shownAt: number,
  leaving: { at: number } | null,
  movement: Movement,
  now: number,
): LowerThirdRun {
  const drawn = lowerThirdAt(was, movement, now);
  const had = drawn.phase !== 'gone' && drawn.phase !== 'out' && drawn.lines.length > 0 ? drawn.lines : null;
  if (key !== null && lines.length > 0)
    return { key, lines, prev: had, phase: had ? 'change' : 'in', start: shownAt };
  if (had && leaving) return { key: null, lines: [], prev: had, phase: 'out', start: leaving.at };
  return { key: null, lines: [], prev: null, phase: 'gone', start: 0 };
}
