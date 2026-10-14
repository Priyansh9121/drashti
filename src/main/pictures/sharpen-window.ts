import { BrowserWindow } from 'electron';
import { constants, setPriority } from 'node:os';
import { loadPage } from '../windows/renderer';
import { secureWebPreferences } from '../windows/web-preferences';

/**
 * The hidden window that makes pictures' sharpened copies (Session 26f, src/main/media/sharpened.ts): never
 * shown, never focused, never throttled, with the app's secure settings, its process at the lowest
 * priority so the show's processes always come first. `gone`: its process ended unexpectedly.
 */
export function createSharpenWindow(gone: () => void): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: 320,
    height: 200,
    title: 'Drashti sharpening',
    skipTaskbar: true,
    focusable: false,
    webPreferences: { ...secureWebPreferences(), backgroundThrottling: false },
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
  void loadPage(win, 'sharpen');
  return win;
}
