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
    workArea: { ...d.workArea },
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

let extraDisplays = 0;

/**
 * Development and tests only, with windowed outputs: pretend there are `n`
 * more displays, copies of the primary one, so several outputs can be tried
 * on a computer with one screen.
 */
export function setExtraDisplays(n: number): void {
  extraDisplays = Math.max(0, Math.min(4, Math.floor(n)));
}

/** The first id given to an extra (pretend) display. */
export const EXTRA_DISPLAY_ID = 900_000_000;

export function listDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  const real = screen.getAllDisplays().map((d) => toDisplayInfo(d, primaryId));
  const primary = real.find((d) => d.primary);
  if (!primary || extraDisplays === 0) return real;
  const extra = Array.from({ length: extraDisplays }, (_, i): DisplayInfo => {
    const id = EXTRA_DISPLAY_ID + i;
    const label = `Extra display ${i + 1}`;
    // Shifted a little, so windowed outputs on "different" displays do not sit exactly on top of each other.
    const bounds = {
      ...primary.bounds,
      x: primary.bounds.x + 60 * (i + 1),
      y: primary.bounds.y + 60 * (i + 1),
    };
    return {
      ...primary,
      id,
      label,
      bounds,
      primary: false,
      internal: false,
      key: { ...primary.key, id, label, x: bounds.x, y: bounds.y, internal: false },
    };
  });
  return [...real, ...extra];
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
    if (process.platform === 'darwin') {
      // Stay visible when someone switches Spaces on the output's display. The window joins every
      // Space of its own display only, so it never moves to another display. skipTransformProcessType
      // matters: without it Electron hides the app's Dock icon (and with it the menu bar) and briefly
      // hides the operator window every time an output opens.
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    }
    win.setBounds(b);
  }
  const show = showWhenReady(win);
  void loadPage(win, 'output', { screen: config.id });
  const contentsId = win.webContents.id;
  const handle: OutputWindow = {
    webContentsId: contentsId,
    setBounds: (bounds) => {
      if (!options.windowed && !win.isDestroyed()) win.setBounds(bounds);
    },
    close: () => {
      show.cancel();
      if (!win.isDestroyed()) win.destroy();
    },
    isDestroyed: () => win.isDestroyed(),
  };
  return { window: win, handle };
}

/**
 * Show a window, without taking the focus, once its page has drawn its first
 * frame; `cancel` before closing it. An output turned off while its page is
 * still loading (Uncover, the wizard, a display change in its first moments)
 * can have that first frame arrive while the window is being destroyed:
 * showing it then made Electron read a widget already gone, and crashed
 * Drashti on Windows (Session 10, from three crash dumps).
 */
function showWhenReady(win: BrowserWindow): { cancel: () => void } {
  const show = () => {
    if (!win.isDestroyed()) win.showInactive();
  };
  win.once('ready-to-show', show);
  return {
    cancel: () => {
      win.removeListener('ready-to-show', show);
    },
  };
}

/**
 * For a few seconds, a display's number and name across it: the setup
 * wizard's Identify, before any output is assigned. Never on the display
 * the operator window is on (the caller leaves it out). It does not take
 * keyboard focus, and closes by itself.
 */
export function showDisplayNumber(
  display: DisplayInfo,
  number: number,
  options: OutputWindowOptions & { forMs: number },
): BrowserWindow {
  const b = display.bounds;
  const win = new BrowserWindow({
    ...(options.windowed
      ? {
          x: b.x + 80,
          y: b.y + 80,
          width: Math.min(640, b.width - 160),
          height: Math.min(360, b.height - 160),
        }
      : {
          ...b,
          frame: false,
          resizable: false,
          movable: false,
          focusable: false,
          skipTaskbar: true,
          hasShadow: false,
        }),
    show: false,
    title: `Drashti display ${number}`,
    backgroundColor: '#000000',
    webPreferences: secureWebPreferences(),
  });
  if (!options.windowed) win.setAlwaysOnTop(true, 'screen-saver');
  const show = showWhenReady(win);
  void loadPage(win, 'output', { identify: String(number), label: display.label || `Display ${number}` });
  setTimeout(() => {
    show.cancel();
    if (!win.isDestroyed()) win.destroy();
  }, options.forMs);
  return win;
}
