import { describe, expect, it } from 'vitest';
import { isAppUrl } from './navigation';

describe('isAppUrl', () => {
  const mac = { rendererDir: '/Applications/Drashti.app/Contents/Resources/app.asar/out/renderer' };
  const win = { rendererDir: 'C:\\Program Files\\Drashti\\resources\\app.asar\\out\\renderer' };

  it('allows built renderer pages', () => {
    expect(
      isAppUrl('file:///Applications/Drashti.app/Contents/Resources/app.asar/out/renderer/index.html', mac),
    ).toBe(true);
    expect(
      isAppUrl(
        'file:///C:/Program%20Files/Drashti/resources/app.asar/out/renderer/output.html?screen=a',
        win,
      ),
    ).toBe(true);
  });

  it('rejects other files and sites', () => {
    expect(isAppUrl('file:///etc/passwd', mac)).toBe(false);
    expect(
      isAppUrl('file:///Applications/Drashti.app/Contents/Resources/app.asar/out/renderer-evil/x.html', mac),
    ).toBe(false);
    expect(isAppUrl('https://example.com/', mac)).toBe(false);
    expect(isAppUrl('not a url', mac)).toBe(false);
  });

  it('allows the dev server only when one is running', () => {
    expect(
      isAppUrl('http://localhost:5173/index.html', { ...mac, devServerUrl: 'http://localhost:5173' }),
    ).toBe(true);
    expect(isAppUrl('http://localhost:5173/index.html', mac)).toBe(false);
    expect(isAppUrl('http://localhost:9999/', { ...mac, devServerUrl: 'http://localhost:5173' })).toBe(false);
  });
});
