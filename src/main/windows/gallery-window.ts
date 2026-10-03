import { BrowserWindow } from 'electron';
import { loadPage } from './renderer';
import { secureWebPreferences } from './web-preferences';

let gallery: BrowserWindow | null = null;

/** The component gallery (development only, from the Diagnostics menu): one window, brought forward if open. */
export function openGalleryWindow(): BrowserWindow {
  if (gallery && !gallery.isDestroyed()) {
    gallery.focus();
    return gallery;
  }
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    title: 'Drashti Component Gallery',
    backgroundColor: '#0b0d11',
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences(),
  });
  win.once('ready-to-show', () => {
    win.show();
  });
  gallery = win;
  win.on('closed', () => {
    if (gallery === win) gallery = null;
  });
  void loadPage(win, 'gallery');
  return win;
}
