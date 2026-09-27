import { describe, expect, it } from 'vitest';
import { secureWebPreferences } from './web-preferences';

describe('secureWebPreferences', () => {
  it('isolates and sandboxes every renderer', () => {
    const p = secureWebPreferences();
    expect(p).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    });
    expect(p.preload).toMatch(/preload[\\/]index\.js$/);
  });
});
