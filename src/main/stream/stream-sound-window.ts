import { BrowserWindow } from 'electron';
import { STREAM_PARTITION } from './stream-session';
import { loadPage } from '../windows/renderer';
import { secureWebPreferences } from '../windows/web-preferences';

/** A separate BrowserWindow owns the renderer; the existing session preserves saved microphone ids. */
export const STREAM_SOUND_PARTITION = STREAM_PARTITION;

export function streamSoundPermissionAllowed(
  permission: string,
  own: boolean,
  url: string,
  media: readonly string[] = [],
): boolean {
  try {
    const page = new URL(url);
    return (
      permission === 'media' &&
      own &&
      (page.protocol === 'file:' || page.protocol === 'http:') &&
      page.pathname.endsWith('/stream-sound.html') &&
      media.every((kind) => kind === 'audio')
    );
  } catch {
    return false;
  }
}

/** No pictures, output device or offscreen drawing: only the stream's input, mix, captions and PCM. */
export function createStreamSoundWindow(log?: (line: string) => void): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: 320,
    height: 200,
    title: 'Drashti stream sound',
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      ...secureWebPreferences(),
      partition: STREAM_SOUND_PARTITION,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.webContents.on('console-message', (details) => {
    if (details.message.startsWith('[program] ')) log?.(details.message.slice(10, 310));
  });
  void loadPage(win, 'stream-sound');
  return win;
}
