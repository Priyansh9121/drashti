import { BrowserWindow } from 'electron';
import { windowIcon } from './app-icon';
import { loadPage } from './renderer';
import { secureWebPreferences } from './web-preferences';
import { quietTests } from './quiet';

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
    // Quiet test mode (tests only, never a packaged Drashti): kept drawing as on a real screen from the moment it is
    // made, as the screens' windows are (Session 54, C review). See-through, it can count as hidden, and set only once
    // made, LIVE's videos did not show their frames in a quiet run while the screens' did.
    webPreferences: { ...secureWebPreferences(), ...(quietTests ? { backgroundThrottling: false } : {}) },
  });
  win.once('ready-to-show', () => {
    win.show();
  });
  void loadPage(win, 'index');
  return win;
}
