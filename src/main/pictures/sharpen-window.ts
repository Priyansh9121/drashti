import { BrowserWindow, type Session } from 'electron';
import { constants, setPriority, getPriority } from 'node:os';
import { loadPage } from '../windows/renderer';
import { secureWebPreferences } from '../windows/web-preferences';

/**
 * The hidden window that makes pictures' sharpened copies (Session 26f, src/main/media/sharpened.ts), or with
 * `display` their display copies (alpha.22, src/main/media/display-copies.ts, in its private Session `pages`, on a
 * page of its own: only that page connects to the local media scheme, QA22-L8-2): never shown, never focused, never
 * throttled, with the app's secure settings, its process at the lowest priority so the show's processes always come
 * first. `gone`: its process ended unexpectedly.
 */
export function createSharpenWindow(gone: () => void, display = false, pages?: Session): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: 320,
    height: 200,
    title: display ? 'Drashti display copies' : 'Drashti sharpening',
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      ...secureWebPreferences(),
      ...(pages ? { session: pages } : {}),
      backgroundThrottling: false,
    },
  });
  win.webContents.once('dom-ready', () => {
    try {
      setPriority(win.webContents.getOSProcessId(), constants.priority.PRIORITY_LOW);
    } catch {
      // Not allowed on this system: it runs at normal priority.
    }
  });
  win.webContents.on('render-process-gone', () => {
    gone();
    if (!win.isDestroyed()) win.destroy();
  });
  // The display worker's address keeps its purpose, as its tests find it by (picture-display-copies.spec.ts).
  void loadPage(win, display ? 'display-copy' : 'sharpen', display ? { purpose: 'display' } : {});
  return win;
}

/** Set the actual worker process below normal and check the OS answer before giving it image bytes. */
export function pictureWorkerPriority(pid: number): number {
  if (pid <= 0) throw new Error('The picture worker has no process.');
  setPriority(pid, constants.priority.PRIORITY_LOW);
  const actual = getPriority(pid);
  if (actual <= constants.priority.PRIORITY_NORMAL)
    throw new Error('The picture worker priority was not lowered.');
  return actual;
}
