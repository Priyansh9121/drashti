import type { BrowserWindow } from 'electron';
import type { EventChannel, EventContract } from '../../shared/ipc';

/*
 * Sending to a window's page (Session 20). As Drashti quits, a window's page is destroyed before the
 * window itself is, so a check of the window alone let a send through to a page that was gone, and
 * Electron threw "Object has been destroyed", uncaught, in the main process (seen when quitting with
 * the Stream panel's preview open).
 */

/** The window and its page are both still there. */
export const pageAlive = (win: BrowserWindow | null | undefined): win is BrowserWindow =>
  !!win && !win.isDestroyed() && !win.webContents.isDestroyed();

/** Send to a window's page while it is still there; false when it is not. */
export function sendToPage<C extends EventChannel>(
  win: BrowserWindow | null | undefined,
  channel: C,
  payload: EventContract[C],
): boolean {
  if (!pageAlive(win)) return false;
  win.webContents.send(channel, payload);
  return true;
}
