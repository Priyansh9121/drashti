import { join } from 'node:path';

export const preloadPath = (): string => join(__dirname, '../preload/index.js');

/** webPreferences shared by every window: isolated, sandboxed, no Node. */
export function secureWebPreferences(): Electron.WebPreferences {
  return {
    preload: preloadPath(),
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: false,
  };
}
