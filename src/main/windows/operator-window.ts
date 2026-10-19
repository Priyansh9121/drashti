import { BrowserWindow } from 'electron';
import { windowIcon } from './app-icon';
import { loadPage } from './renderer';
import { secureWebPreferences } from './web-preferences';

/** The operator window, opening on its appearance's window colour (Sessions 39–40), so it never flashes another. */
export function createOperatorWindow(background: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Drashti',
    backgroundColor: background,
    // Windows: keep the menu bar out of a volunteer's way (Alt shows it).
    autoHideMenuBar: true,
    ...windowIcon(),
    webPreferences: secureWebPreferences(),
  });
  win.once('ready-to-show', () => {
    win.show();
  });
  void loadPage(win, 'index');
  return win;
}
