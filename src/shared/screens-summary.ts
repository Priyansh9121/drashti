import type { ScreenStatus } from './screens';

/*
 * The status line's screens and a screen restarted again and again (a23-heartbeat), in words: here so they are
 * tested, as the operator window's components have no tests of their own.
 */

/** Beside a screen's name in Screens, while it keeps being restarted. */
export const RESTARTING_WORDS = 'Keeps restarting';

/** Why, in Screens. */
export function restartingSentence(restarts: number): string {
  void restarts;
  return '';
}

/** "2 screens showing · 1 display not connected · 1 stopped", so a volunteer notices a dead output. */
export function screensSummary(status: readonly ScreenStatus[]): {
  text: string;
  tone: 'danger' | 'warning' | 'muted';
} {
  const showing = status.filter((s) => s.state === 'showing').length;
  const missing = status.filter((s) => s.state === 'missing-display').length;
  const stopped = status.filter((s) => s.state === 'stopped').length;
  const text =
    status.length === 0
      ? 'No screens set up'
      : `${String(showing)} ${showing === 1 ? 'screen' : 'screens'} showing${missing ? ` · ${String(missing)} display${missing === 1 ? '' : 's'} not connected` : ''}${stopped ? ` · ${String(stopped)} stopped` : ''}`;
  return { text, tone: stopped ? 'danger' : missing ? 'warning' : 'muted' };
}
