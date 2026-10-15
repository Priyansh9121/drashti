import type { Movement } from '../../../shared/looks';
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
