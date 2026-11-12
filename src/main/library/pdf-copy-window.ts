import { BrowserWindow, type Display, screen } from 'electron';
import type { Size } from '../../shared/scaling';
import { phoneCaptureGeometry } from './pdf-copy-session';
import { loadPage } from '../windows/renderer';
import { secureWebPreferences } from '../windows/web-preferences';

/** The common slide renderer prints in an isolated hidden page; no show/focus call exists. */
export function createPdfCopyWindow(picture?: Size): BrowserWindow {
  const primary = screen.getPrimaryDisplay();
  const keepsScale = (display: Display) => {
    if (!picture) return true;
    const { x, y } = display.bounds;
    const { width, height } = phoneCaptureGeometry(picture, display.scaleFactor);
    return screen.getDisplayMatching({ x, y, width, height }).scaleFactor === display.scaleFactor;
  };
  // Anchor the hidden window where growing to its capture size will keep the starting display scale.
  const display = keepsScale(primary) ? primary : (screen.getAllDisplays().find(keepsScale) ?? primary);
  const { x, y } = display.bounds;
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
