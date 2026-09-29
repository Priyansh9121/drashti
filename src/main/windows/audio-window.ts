import { BrowserWindow } from 'electron';
import { loadPage } from './renderer';
import { secureWebPreferences } from './web-preferences';

/**
 * The audio player's session: its own, so the one permission it has (seeing
 * the sound outputs) stays there. Persistent, so output ids stay the same
 * across restarts and a remembered choice is found again.
 */
export const AUDIO_PARTITION = 'persist:drashti-audio';

/**
 * The audio player: a hidden window of its own, so sound keeps playing
 * whatever happens to the operator window. It is the only page that plays
 * sound, and the only one allowed to see and choose sound outputs.
 */
export function createAudioWindow(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: 320,
    height: 200,
    title: 'Drashti audio',
    skipTaskbar: true,
    focusable: false,
    // Hidden, but never throttled: timers keep sound in step with the pictures.
    webPreferences: { ...secureWebPreferences(), partition: AUDIO_PARTITION, backgroundThrottling: false },
  });
  void loadPage(win, 'audio');
  return win;
}
