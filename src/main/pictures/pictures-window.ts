import { BrowserWindow } from 'electron';
import { loadPage } from '../windows/renderer';
import { secureWebPreferences } from '../windows/web-preferences';

/**
 * The hidden window that draws a PDF's pages as pictures (Session 15): never
 * shown, never focused, never throttled (its timers pace the pages), with
 * the app's secure settings; it goes as soon as its document is drawn.
 */
export function createPicturesWindow(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: 320,
    height: 200,
    title: 'Drashti pictures',
    skipTaskbar: true,
    focusable: false,
    webPreferences: { ...secureWebPreferences(), backgroundThrottling: false },
  });
  void loadPage(win, 'pdf');
  return win;
}
