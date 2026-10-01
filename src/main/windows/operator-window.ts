import { BrowserWindow } from 'electron';
import { loadPage } from './renderer';
import { secureWebPreferences } from './web-preferences';

export function createOperatorWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Drashti',
    backgroundColor: '#0b0d11',
    // Windows: keep the menu bar out of a volunteer's way (Alt shows it).
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences(),
  });
  win.once('ready-to-show', () => {
    win.show();
  });
  void loadPage(win, 'index');
  return win;
}
