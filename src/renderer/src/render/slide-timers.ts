import { createContext, useContext } from 'react';
import type { Movement } from '../../../shared/looks';
import type { TimerState } from '../../../shared/timers';
import { useEngine } from '../engine/engine-store';

/*
 * What a slide's Timers draw with (Session 50): the timers of the engine state a screen draws (a Scene's: an
 * output, a node's, LIVE, a phone's picture), else this page's own copy of the show (a thumbnail, the slide
 * editor); and the screen's group's Movement, which moves their digits.
 */

/** The timers of the state being drawn; null: this page's own copy of the show. */
export const SlideTimersContext = createContext<readonly TimerState[] | null>(null);

/** How the screen's group moves (Session 27): a Timer's digits fade (Calm) or roll up (Bold). */
export const SlideMovementContext = createContext<Movement>('calm');

/** A timer, from the state being drawn, else from this page's own copy of the show. */
export function useSlideTimer(timerId: string): TimerState | undefined {
  const given = useContext(SlideTimersContext);
  const own = useEngine((s) => (given ? undefined : s.state?.timers.find((t) => t.id === timerId)));
  return given ? given.find((t) => t.id === timerId) : own;
}
