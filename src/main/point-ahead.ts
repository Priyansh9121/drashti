import type { DeckSlide } from '../shared/deck';
import { type PointAt, type PointedClip, pointedClip, sameClip } from '../shared/point-ahead';

/*
 * The deck slide the operator points at, told to every screen that loads ahead (C3, Session 58: Q57-26;
 * shared/point-ahead.ts). The operator window says which slide's row the pointer rests on (or null); this works out
 * that slide's first clip and where a click starts it, and tells the screens (each output's Preloader, a node's too)
 * only when that changes. Never while this computer is short of memory: then the screens are told none, at once, and
 * again every few seconds while a clip is loaded ahead, so one already loaded is let go of when memory runs short.
 */

/** How often memory is looked at again while a clip is loaded ahead (ms). */
export const MEMORY_CHECK_MS = 5000;

export interface PointAheadDeps {
  /** The deck of the slide a click on this row puts up (the engine's own order of slides), or undefined. */
  deckAt: (target: PointAt) => DeckSlide | undefined;
  /** Whether this computer has memory to spare to load a clip ahead now. */
  room: () => boolean;
  /** Tell every screen that loads ahead what to load for the pointer (null: nothing). */
  tell: (clip: PointedClip | null) => void;
  /** Timers (tests give their own). */
  every?: (fn: () => void, ms: number) => () => void;
}

const realEvery = (fn: () => void, ms: number): (() => void) => {
  const timer = setInterval(fn, ms);
  return () => {
    clearInterval(timer);
  };
};

export class PointAhead {
  /** What the pointer is on, as last said: kept so memory coming back loads it again. */
  private wanted: PointedClip | null = null;
  /** What the screens were last told. */
  private told: PointedClip | null = null;
  private stopWatching: (() => void) | null = null;

  constructor(private readonly deps: PointAheadDeps) {}

  /** The operator's pointer on a slide's row (null: on none). */
  point(target: PointAt | null): void {
    let deck: DeckSlide | undefined;
    try {
      deck = target ? this.deps.deckAt(target) : undefined;
    } catch {
      // A presentation that cannot be read now is pointed at as nothing: a click on it says why, as before.
      deck = undefined;
    }
    this.wanted = pointedClip(deck);
    this.update();
  }

  /** What the screens are loading ahead for the pointer now. */
  current(): PointedClip | null {
    return this.told;
  }

  /** At quit: nothing more is said, and memory is no longer watched. */
  stop(): void {
    this.wanted = null;
    this.stopWatching?.();
    this.stopWatching = null;
  }

  private update(): void {
    const next = this.wanted && this.deps.room() ? this.wanted : null;
    if (!sameClip(next, this.told)) {
      this.told = next;
      this.deps.tell(next);
    }
    // While a clip is wanted, memory is looked at again now and then: let go of when short, loaded when back.
    if (this.wanted && !this.stopWatching)
      this.stopWatching = (this.deps.every ?? realEvery)(() => {
        this.update();
      }, MEMORY_CHECK_MS);
    else if (!this.wanted && this.stopWatching) {
      this.stopWatching();
      this.stopWatching = null;
    }
  }
}
