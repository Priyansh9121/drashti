import { BrowserWindow, screen } from 'electron';
import { loadPage } from '../windows/renderer';
import { secureWebPreferences } from '../windows/web-preferences';

/** The common slide renderer prints in an isolated hidden page; no show/focus call exists. */
export function createPdfCopyWindow(): BrowserWindow {
  // Its 320 × 200 starting size gives the display scale before the capture grows the window.
  const { x, y } = screen.getPrimaryDisplay().bounds;
  const win = new BrowserWindow({
    x,
    y,
    show: false,
    enableLargerThanScreen: true,
    transparent: true,
    backgroundColor: '#00000000',
    opacity: 0,
    focusable: false,
    skipTaskbar: true,
    width: 320,
    height: 200,
    title: 'Drashti PDF copy',
    webPreferences: { ...secureWebPreferences(), backgroundThrottling: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('will-redirect', (event) => event.preventDefault());
  win.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  void loadPage(win, 'pdf-export');
  return win;
}
