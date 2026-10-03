import { app, type BrowserWindow, dialog, type MessageBoxOptions } from 'electron';
import { log } from '../log';

/*
 * Quiet test mode, for end-to-end tests on a computer someone is using
 * (tests/e2e/helpers.ts sets DRASHTI_TEST_QUIET=1 for local runs; CI runs
 * Drashti as an operator would). A packaged Drashti ignores it.
 *
 * Drashti then stays out of that person's way:
 * - It never becomes the active app. On macOS it runs as an accessory app
 *   (no Dock icon, no menu bar). Windows are shown without activating, and
 *   nothing can focus a window, bring it forward, keep it on top or make it
 *   full screen.
 * - It never covers the screen. Outputs open as ordinary windows (see
 *   index.ts), and every window is see-through and lets clicks through to
 *   whatever is under it.
 * - It makes no sound, and a system dialog no test answered is answered
 *   with its cancel button (the log says so) instead of appearing.
 * The pages still draw and run as on a real screen, and Playwright stands in
 * for keyboard focus, so the tests see what they need. Tests that need a
 * real full-screen output or real focus run on CI only.
 */
export const quietTests = process.env['DRASHTI_TEST_QUIET'] === '1' && !app.isPackaged;

const ignore = (): undefined => undefined;

/** Turn quiet test mode on when it was asked for. Call it before any window opens. */
export function startQuietTests(): void {
  if (!quietTests) return;
  if (process.platform === 'darwin') app.setActivationPolicy('accessory');
  app.focus = ignore;
  app.on('browser-window-created', (_event, win) => {
    quietWindow(win);
  });
  answerDialogs();
  log.info('Quiet test mode: Drashti stays in the background, see-through and silent');
}

/** A window that never takes focus or covers anything, and still draws. */
function quietWindow(win: BrowserWindow): void {
  win.setOpacity(0);
  win.setIgnoreMouseEvents(true);
  win.setHasShadow(false);
  win.webContents.setAudioMuted(true);
  // A see-through window can count as hidden; its page must keep drawing as on a real screen.
  win.webContents.setBackgroundThrottling(false);
  Object.assign(win, {
    show: () => {
      win.showInactive();
    },
    focus: ignore,
    moveTop: ignore,
    setAlwaysOnTop: ignore,
    setFullScreen: ignore,
    setSimpleFullScreen: ignore,
    setKiosk: ignore,
    setVisibleOnAllWorkspaces: ignore,
  });
}

/** System dialogs nobody stubbed are answered with their cancel button (no content in the log). */
function answerDialogs(): void {
  const cancelOf = (args: unknown[]): number => {
    const options = args.find(
      (a): a is MessageBoxOptions => typeof a === 'object' && a !== null && 'message' in a,
    );
    return options?.cancelId ?? 0;
  };
  const answered = (what: string) => {
    log.warn(`Quiet test mode: answered a ${what} with its cancel button instead of showing it`);
  };
  Object.assign(dialog, {
    showMessageBox: (...args: unknown[]) => {
      answered('message box');
      return Promise.resolve({ response: cancelOf(args), checkboxChecked: false });
    },
    showMessageBoxSync: (...args: unknown[]) => {
      answered('message box');
      return cancelOf(args);
    },
    showErrorBox: () => {
      answered('error box');
    },
    showOpenDialog: () => {
      answered('file dialog');
      return Promise.resolve({ canceled: true, filePaths: [] });
    },
    showOpenDialogSync: () => {
      answered('file dialog');
      return undefined;
    },
    showSaveDialog: () => {
      answered('save dialog');
      return Promise.resolve({ canceled: true, filePath: '' });
    },
    showSaveDialogSync: () => {
      answered('save dialog');
      return '';
    },
  });
}
