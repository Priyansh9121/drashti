import { BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc';
import { cutText } from '../../shared/text';
import { handle } from '../ipc/handle';
import { loadPage } from '../windows/renderer';
import { sendToPage } from '../windows/send';
import { windowIcon } from '../windows/app-icon';
import { secureWebPreferences } from '../windows/web-preferences';
import type { AccessService } from './service';

/*
 * The lock screen and the stop as the windows reach them (Session 54, access by Gmail): their requests, the
 * only ones that run while this computer is not let in (with Quit, and the two any page may make: what Drashti
 * is, and a page's render errors for the log); and the lock window itself, which shows before Drashti opens
 * when it is not let in at once. Every request is checked again in the access service.
 */

/** What runs while this computer is not let in. */
export const OPEN_WHILE_LOCKED: ReadonlySet<string> = new Set<string>([
  ...Object.values(IPC.access),
  IPC.app.getInfo,
  IPC.app.renderError,
]);

/** Plain text from a page, at most `max` characters, cut between letters (anything else: nothing). */
const text = (raw: unknown, max: number): string => (typeof raw === 'string' ? cutText(raw, max) : '');

/** The lock screen's requests, and every change of the view sent to the windows that show it. */
export function registerAccessIpc(o: {
  service: AccessService;
  /** Quit Drashti (the lock screen's and the stop's Quit). */
  quit: () => void;
  /** The windows that show the lock, the stop or the countdown. */
  windows: () => (BrowserWindow | null)[];
}): void {
  handle(IPC.access.view, () => o.service.view());
  handle(IPC.access.request, (_e, gmail, name) => o.service.requestAccess(text(gmail, 254), text(name, 200)));
  handle(IPC.access.status, () => o.service.checkRequest());
  handle(IPC.access.redeem, (_e, gmail, token) => o.service.redeemToken(text(gmail, 254), text(token, 200)));
  handle(IPC.access.retry, () => o.service.retry());
  handle(IPC.access.quit, () => {
    // After the answer: the window that asked is closing as it hears it.
    setTimeout(o.quit, 0);
    return null;
  });
  o.service.onView((view) => {
    for (const win of o.windows()) sendToPage(win, IPC.access.changed, view);
  });
}

/**
 * The lock window: the lock screen, before Drashti opens (Request Access, I Have a Token, Try Again, Quit). Small,
 * and in the middle of the screen; it fits CI's 1024 × 645 work area with its title bar. Shown once its page has
 * drawn, on its appearance's window colour.
 */
export function createLockWindow(background: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 760,
    height: 600,
    minWidth: 480,
    minHeight: 420,
    show: false,
    center: true,
    title: 'Drashti',
    backgroundColor: background,
    autoHideMenuBar: true,
    ...windowIcon(),
    webPreferences: secureWebPreferences(),
  });
  win.once('ready-to-show', () => {
    win.show();
  });
  void loadPage(win, 'lock');
  return win;
}
