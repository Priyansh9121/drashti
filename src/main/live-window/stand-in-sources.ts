import { BrowserWindow } from 'electron';
import type { ListedSource, WindowSources } from './live-window-service';
import { windowKey } from './sources';

/*
 * Tests only (DRASHTI_TEST_WINDOW_STANDIN, never a packaged Drashti; Session 48). Seeing another app's
 * window needs macOS's Screen Recording, which only a person can give, and no test may look at the real
 * windows of the computer it runs on. So windows the test opens itself in Drashti's own process, titled
 * "Placeholder…" (a moving test pattern), stand in for other apps' windows: listed with a display and
 * Drashti's own windows, so the picker's filter (./sources.ts) is what leaves those out, and captured as
 * the stream's page captures itself. 'no-access' stands in for a Mac that has not given Screen Recording.
 */

const isPlaceholder = (w: BrowserWindow): boolean =>
  !w.isDestroyed() && w.getTitle().startsWith('Placeholder');
const idOf = (w: BrowserWindow): string => `window:${String(w.id)}:0`;
const windowOf = (id: string): BrowserWindow | undefined =>
  BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && windowKey(idOf(w)) === windowKey(id));

async function pictureOf(w: BrowserWindow): Promise<string | null> {
  try {
    const shot = await w.webContents.capturePage();
    return shot.isEmpty() ? null : shot.resize({ width: 320 }).toDataURL();
  } catch {
    return null;
  }
}

export function standInWindowSources(mode: string, log: (line: string) => void): WindowSources {
  return {
    access: () => (mode === 'no-access' ? 'denied' : 'granted'),
    askAccess: () => {
      log('Stand-in windows: System Settings would open at Screen Recording');
      return Promise.resolve();
    },
    list: async (): Promise<ListedSource[]> => {
      const all = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
      const windows = await Promise.all(
        all.map(async (w) => ({
          id: idOf(w),
          name: w.getTitle(),
          picture: isPlaceholder(w) ? await pictureOf(w) : null,
        })),
      );
      return [{ id: 'screen:0:0', name: 'Entire screen', picture: null }, ...windows];
    },
    ownIds: () =>
      new Set(
        BrowserWindow.getAllWindows()
          .filter((w) => !w.isDestroyed() && !isPlaceholder(w))
          .map(idOf),
      ),
    isOpen: (id) => {
      const w = windowOf(id);
      return Promise.resolve(w !== undefined && isPlaceholder(w) && w.isVisible() && !w.isMinimized());
    },
    grant: (id) => {
      const w = windowOf(id);
      return w && isPlaceholder(w) ? w.webContents.mainFrame : null;
    },
  };
}
