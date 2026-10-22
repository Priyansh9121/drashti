import { BrowserWindow, desktopCapturer, shell, systemPreferences } from 'electron';
import type { ListedSource, WindowSources } from './live-window-service';
import { windowKey } from './sources';

/*
 * The computer's own windows (Session 48), through Chromium's window capture: on macOS that needs Screen
 * Recording, which only the person at the computer can give (System Settings › Privacy & Security). Only
 * windows are ever asked for (never a display); ./sources.ts filters what is offered again.
 */

/** The picker's small pictures. */
const PICTURE = { width: 320, height: 180 };
/** Asking for no pictures at all: the quickest list, to see whether a window is still there. */
const NO_PICTURE = { width: 0, height: 0 };
const SCREEN_RECORDING = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

export function electronWindowSources(platform: NodeJS.Platform): WindowSources {
  /** The windows' names as last listed, by id. */
  let names = new Map<string, string>();
  const windows = (thumbnailSize: { width: number; height: number }) =>
    desktopCapturer.getSources({ types: ['window'], thumbnailSize, fetchWindowIcons: false });
  return {
    access: () => (platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted'),
    askAccess: async () => {
      if (platform !== 'darwin') return;
      // Asking for the windows once puts Drashti in System Settings' list (and macOS asks, the first time).
      await windows(NO_PICTURE).catch(() => []);
      await shell.openExternal(SCREEN_RECORDING);
    },
    list: async (): Promise<ListedSource[]> => {
      const sources = await windows(PICTURE);
      names = new Map(sources.map((s) => [s.id, s.name]));
      return sources.map((s) => ({
        id: s.id,
        name: s.name,
        picture: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
      }));
    },
    ownIds: () => new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId())),
    isOpen: async (id) => {
      const key = windowKey(id);
      return (await windows(NO_PICTURE)).some((s) => windowKey(s.id) === key);
    },
    // Only ever a window's id (./sources.ts): Chromium captures that window, and nothing else.
    grant: (id) => (windowKey(id) === null ? null : { id, name: names.get(id) ?? '' }),
  };
}
