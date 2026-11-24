import { BrowserWindow, type NativeImage } from 'electron';
import { loadPage } from '../windows/renderer';
import { LIVE_COPY_FPS, type LiveCopyWindow, liveCopyOptions, liveCopyQuery } from './live-copy';

/*
 * Live's copy's window (alpha.23, live-copy.ts): the screens' page drawn off screen, never on a display, muted, about
 * once a second (its frame rate), each picture it draws kept until the next for Live's still. Its page stopping tells
 * Live (`gone`); closed, it is destroyed at once, its last picture with it.
 */

export function createLiveCopyWindow(gone: () => void): { window: BrowserWindow; copy: LiveCopyWindow } {
  const win = new BrowserWindow(liveCopyOptions());
  // Muted: the screens' videos play without sound already (their sound is the audio player's); this holds it.
  win.webContents.setAudioMuted(true);
  win.webContents.setFrameRate(LIVE_COPY_FPS);
  let latest: NativeImage | null = null;
  // Each picture painted is copied into the main process: counted, so a test sees it is about one a second.
  let paints = 0;
  win.webContents.on('paint', (_event, _dirty, image) => {
    paints++;
    if (!image.isEmpty()) latest = image;
  });
  win.webContents.on('render-process-gone', () => {
    latest = null;
    gone();
  });
  // Its page's own title would take the window's: it keeps this one (seen only in a log or a test).
  win.on('page-title-updated', (event) => {
    event.preventDefault();
  });
  void loadPage(win, 'output', liveCopyQuery());
  return {
    window: win,
    copy: {
      latest: () => (win.isDestroyed() ? null : latest),
      paints: () => paints,
      isDestroyed: () => win.isDestroyed(),
      close: () => {
        latest = null;
        if (!win.isDestroyed()) win.destroy();
      },
    },
  };
}
