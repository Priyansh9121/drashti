import type { ScreenStatus } from './screens';

/*
 * The status line's screens and a screen restarted again and again (a23-heartbeat), in words: here so they are
 * tested, as the operator window's components have no tests of their own.
 */

/** Beside a screen's name in Screens, while it keeps being restarted. */
export const RESTARTING_WORDS = 'Keeps restarting';

/** Why, in Screens. */
export function restartingSentence(restarts: number): string {
  return `It stopped answering, so Drashti restarted it ${String(restarts)} times in a row. It keeps trying, waiting longer each time. Try again restarts it now.`;
}

/**
 * "2 screens showing · 1 display not connected · 1 keeps restarting · 1 stopped", so a volunteer notices a dead
 * output. One restarted again and again (a23-heartbeat) is said apart from those showing, in red as a stopped one.
 */
export function screensSummary(status: readonly ScreenStatus[]): {
  text: string;
  tone: 'danger' | 'warning' | 'muted';
} {
  const restarting = status.filter((s) => s.state === 'showing' && s.restarts !== undefined).length;
  const showing = status.filter((s) => s.state === 'showing' && s.restarts === undefined).length;
  const missing = status.filter((s) => s.state === 'missing-display').length;
  // Given up on after crashing again and again (Session 23): black until Drashti tries it again.
  const stopped = status.filter((s) => s.state === 'stopped').length;
  const parts = [
    `${String(showing)} ${showing === 1 ? 'screen' : 'screens'} showing`,
    ...(missing ? [`${String(missing)} display${missing === 1 ? '' : 's'} not connected`] : []),
    ...(restarting ? [`${String(restarting)} ${restarting === 1 ? 'keeps' : 'keep'} restarting`] : []),
    ...(stopped ? [`${String(stopped)} stopped`] : []),
  ];
  const text = status.length === 0 ? 'No screens set up' : parts.join(' · ');
  return { text, tone: stopped || restarting ? 'danger' : missing ? 'warning' : 'muted' };
}
