import type { IdleState } from '../../../shared/idle';
import type { Lang } from '../../../shared/model';
import type { Size } from '../../../shared/scaling';
import { IdleRotation } from './IdleRotation';

/*
 * What an audience screen shows while nothing is up (Session 55, Part 1): a screen that has just started (plugged
 * in, at the start, after Set Up Screens…) shows it until something is put up, and so does every screen after Clear
 * all; there is no test slide. Today: the idle rotation where the screen's Look shows it, else nothing over the
 * scene's own black. The one place for Part 6's chosen wallpaper (black when none is chosen).
 */

/** What shows while nothing is up, as a screen's scene says it (data-nothing-up): the idle rotation, or black. */
export type NothingUpShows = 'idle' | 'black';

export function nothingUpShows(idle: boolean): NothingUpShows {
  return idle ? 'idle' : 'black';
}

export function NothingUp({
  shows,
  idle,
  languages,
  canvas,
}: {
  shows: NothingUpShows;
  idle: IdleState;
  languages: readonly Lang[] | null;
  canvas: Size;
}) {
  return shows === 'idle' ? <IdleRotation idle={idle} languages={languages} canvas={canvas} /> : null;
}
