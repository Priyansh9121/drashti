import { BrowserWindow } from 'electron';
import type { LiveCopyWindow } from './live-copy';

/*
 * Live's copy's window (alpha.23): skeleton (Red).
 */

export function createLiveCopyWindow(_gone: () => void): { window: BrowserWindow; copy: LiveCopyWindow } {
  const win = new BrowserWindow({ show: false });
  return {
    window: win,
    copy: {
      latest: () => null,
      isDestroyed: () => false,
      close: () => undefined,
    },
  };
}
