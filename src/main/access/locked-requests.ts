import { IPC } from '../../shared/ipc';
import { pageOf } from '../../preload/page-groups';

/*
 * Which requests run while this computer is not let in (Session 54, access by Gmail): the lock screen's and Quit,
 * and the two any page may make (what Drashti is, and a page's render errors for the log). And Drashti's own screens
 * (the outputs, the audio player, the stream's and Zoom's pictures) keep running, as they decide nothing: they draw
 * what the engine has, black once Drashti has stopped (or a self-test's placeholder content), and report how they
 * draw, so no screen is taken for hung and reloaded again and again. Never the operator window's, whatever page it
 * shows, nor a screen's answer to the operator's questions, which is the operator's to give.
 */

/** The lock screen's, Quit, and what any page may ask. */
export const OPEN_WHILE_LOCKED: ReadonlySet<string> = new Set<string>([
  ...Object.values(IPC.access),
  IPC.app.getInfo,
  IPC.app.renderError,
]);

/** Drashti's own screens' pages. */
const SCREEN_PAGES: ReadonlySet<string> = new Set(['output', 'audio', 'stream', 'zoom']);

/** A screen's answers to the operator's questions (Audience off? Keep these screens?): the operator's. */
const OPERATOR_ANSWERS: ReadonlySet<string> = new Set<string>([
  IPC.output.switchAnswer,
  IPC.output.keepAnswer,
]);

/** Whether a request may run while this computer is not let in. */
export function mayRunWhileLocked(
  channel: string,
  sender: { url: string; operatorWindow: boolean },
): boolean {
  if (OPEN_WHILE_LOCKED.has(channel)) return true;
  if (sender.operatorWindow || OPERATOR_ANSWERS.has(channel)) return false;
  const page = pageOf(sender.url);
  return page !== null && SCREEN_PAGES.has(page);
}
