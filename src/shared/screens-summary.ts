import type { ScreenStatus } from './screens';

/*
 * The status line's screens and a screen restarted again and again (a23-heartbeat), in words: here so they are
 * tested, as the operator window's components have no tests of their own.
 */

/** Beside a screen's name in Screens, while it keeps being restarted. */
export const RESTARTING_WORDS = 'Keeps restarting';

/** Why, in Screens. */
/**
 * Held for the owner (QA23-HEARTBEAT-1, A): this build keeps a page as it is instead of restarting it a 5th time in a
 * row (HeartbeatDeps.keep on Main and on nodes), so the words say what happens next under A.
 */
export const HEARTBEAT_KEEPS_A_PAGE = true as boolean;

/** Why, in Screens: under A (`keeps`), what happens next, never that Drashti keeps trying (review MA2). */
export function restartingSentence(restarts: number, keeps = false): string {
  const said = `It stopped answering, so Drashti restarted it ${String(restarts)} times in a row.`;
  return keeps
    ? `${said} If it does not draw the show after this restart either, Drashti stops restarting it and shows it as Stopped. Try again restarts it now.`
    : `${said} It keeps trying, about once a minute. Try again restarts it now.`;
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

/** Why a stopped screen is stopped, in its notice and in Screens. */
export function stoppedSentence(status: ScreenStatus): string {
  // Held for the owner (QA23-HEARTBEAT-1, A): its page kept as it is (it may well be black: one that never drew).
  return status.notAnswering
    ? 'It stopped answering after 4 restarts in a row, so Drashti stopped restarting it and left it as it is: it may still catch up. Drashti tries it again by itself every few minutes.'
    : 'It kept failing, so it is black for now. Drashti tries it again by itself every few minutes.';
}
