import { BrowserWindow, type Display, screen } from 'electron';
import type { DisplayInfo, ScreenConfig } from '../../shared/screens';
import { log } from '../log';
import { loadPage } from '../windows/renderer';
import { secureWebPreferences } from '../windows/web-preferences';
import type { OutputWindow } from './output-manager';

/** Describe an Electron display. Resolution and refresh come from the OS; Drashti never changes them. */
export function toDisplayInfo(d: Display, primaryId: number): DisplayInfo {
  const pixelWidth = Math.round(d.size.width * d.scaleFactor);
  const pixelHeight = Math.round(d.size.height * d.scaleFactor);
  const label = d.label || '';
  return {
    id: d.id,
    label,
    bounds: { ...d.bounds },
    scaleFactor: d.scaleFactor,
    pixelWidth,
    pixelHeight,
    refreshHz: d.displayFrequency,
    rotation: d.rotation,
    internal: d.internal,
    primary: d.id === primaryId,
    key: { id: d.id, label, pixelWidth, pixelHeight, x: d.bounds.x, y: d.bounds.y, internal: d.internal },
  };
}

export function listDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d) => toDisplayInfo(d, primaryId));
}

/** Call `onChange` (debounced) when displays are added, removed or change mode. */
export function watchDisplays(onChange: () => void, delayMs = 300): void {
  let timer: NodeJS.Timeout | null = null;
  const schedule = (why: string) => {
    log.info(`Displays changed (${why})`);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, delayMs);
  };
  screen.on('display-added', () => {
    schedule('added');
  });
  screen.on('display-removed', () => {
    schedule('removed');
  });
  screen.on('display-metrics-changed', () => {
    schedule('metrics');
  });
}

export interface OutputWindowOptions {
  /**
   * Development only: a normal window instead of covering the display, so an
   * output can be tried on a machine with one screen.
   */
  windowed: boolean;
}

/**
 * A frameless window covering the whole display, above the menu bar and
 * dock, that never takes keyboard focus from the operator. Each one is its
 * own renderer process.
 */
export function createOutputWindow(
  config: ScreenConfig,
  display: DisplayInfo,
  options: OutputWindowOptions,
): { window: BrowserWindow; handle: OutputWindow } {
  const b = display.bounds;
  const win = options.windowed
    ? new BrowserWindow({
        x: b.x + 40,
        y: b.y + 40,
        width: Math.min(960, b.width - 80),
        height: Math.min(540, b.height - 80),
        show: false,
        title: `Drashti output - ${config.name}`,
        backgroundColor: '#000000',
        webPreferences: { ...secureWebPreferences(), backgroundThrottling: false },
      })
    : new BrowserWindow({
        ...b,
        show: false,
        frame: false,
        title: `Drashti output - ${config.name}`,
        backgroundColor: '#000000',
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        closable: true,
        focusable: false,
        skipTaskbar: true,
        hasShadow: false,
        enableLargerThanScreen: true,
        roundedCorners: false,
        thickFrame: false,
        webPreferences: { ...secureWebPreferences(), backgroundThrottling: false },
      });
  if (!options.windowed) {
    win.setAlwaysOnTop(true, 'screen-saver');
    if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setBounds(b);
  }
  win.once('ready-to-show', () => {
    win.showInactive();
  });
  void loadPage(win, 'output', { screen: config.id });
  const contentsId = win.webContents.id;
  const handle: OutputWindow = {
    webContentsId: contentsId,
    setBounds: (bounds) => {
      if (!options.windowed && !win.isDestroyed()) win.setBounds(bounds);
    },
    close: () => {
      if (!win.isDestroyed()) win.destroy();
    },
    isDestroyed: () => win.isDestroyed(),
  };
  return { window: win, handle };
}
