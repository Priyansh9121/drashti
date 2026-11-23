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

  it('rejects a file address leaving the renderer folder once decoded, or on another computer', () => {
    const inMac = 'file:///Applications/Drashti.app/Contents/Resources/app.asar/out/renderer/';
    const inWin = 'file:///C:/Program%20Files/Drashti/resources/app.asar/out/renderer/';
    // An encoded separator is not a dot segment to the address parser, but it is one once decoded.
    expect(isAppUrl(`${inMac}..%2F..%2F..%2Fx.html`, mac)).toBe(false);
    expect(isAppUrl(`${inMac}sub/..%2f..%2Fx.html`, mac)).toBe(false);
    expect(isAppUrl(`${inWin}..%5C..%5Cx.html`, win)).toBe(false);
    expect(isAppUrl(`${inWin}..%5c..%5Cx.html`, win)).toBe(false);
    expect(isAppUrl(`${inMac}index.html%00.png`, mac)).toBe(false);
    // A file address with a host is another computer's file (a network share on Windows).
    expect(isAppUrl(`${inMac.replace('file:///', 'file://other-computer/')}index.html`, mac)).toBe(false);
    // Our own pages, as they are loaded, still pass (a localhost host is no host at all).
    expect(isAppUrl(`${inMac.replace('file:///', 'file://localhost/')}index.html`, mac)).toBe(true);
    expect(isAppUrl(`${inMac}output.html?screen=a#x`, mac)).toBe(true);
    expect(isAppUrl(`${inWin}stream.html`, win)).toBe(true);
  });

  it('allows the dev server only when one is running', () => {
    expect(
      isAppUrl('http://localhost:5173/index.html', { ...mac, devServerUrl: 'http://localhost:5173' }),
    ).toBe(true);
    expect(isAppUrl('http://localhost:5173/index.html', mac)).toBe(false);
    expect(isAppUrl('http://localhost:9999/', { ...mac, devServerUrl: 'http://localhost:5173' })).toBe(false);
  });
});
