import { describe, expect, it } from 'vitest';
import type { CameraAccess } from '../../shared/video-inputs';
import { cameraSystem, MAC_CAMERA_SETTINGS, WINDOWS_CAMERA_SETTINGS } from './camera';

/* Whether Drashti may use the cameras (Session 50): the Mac's question, Windows' setting; never a real one here. */

function os(start: CameraAccess, answer = true) {
  let status = start;
  const opened: string[] = [];
  let asked = 0;
  return {
    opened,
    asked: () => asked,
    os: {
      status: () => status,
      ask: () => {
        asked++;
        if (status === 'not-determined') status = answer ? 'granted' : 'denied';
        return Promise.resolve(status === 'granted');
      },
      open: (url: string) => {
        opened.push(url);
        return Promise.resolve();
      },
    },
  };
}

describe('the camera’s system setting', () => {
  it('a Mac: asked once, when it has never been asked, after the page said why; refused, System Settings opens at Camera', async () => {
    const mac = os('not-determined', false);
    const camera = cameraSystem('darwin', mac.os);
    expect(camera.access()).toBe('not-determined');
    expect(await camera.ask()).toBe('denied');
    expect(mac.asked()).toBe(1);
    // Refused: macOS never asks again; asking again does nothing, and Settings is where to turn it on.
    expect(await camera.ask()).toBe('denied');
    expect(mac.asked()).toBe(1);
    await camera.openSettings();
    expect(mac.opened).toEqual([MAC_CAMERA_SETTINGS]);
    expect(MAC_CAMERA_SETTINGS).toBe(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
    );
    const allowed = os('not-determined', true);
    expect(await cameraSystem('darwin', allowed.os).ask()).toBe('granted');
  });

  it('Windows: never asks (the camera privacy setting decides, and says denied when it is off); Settings opens at Camera', async () => {
    const off = os('denied');
    const camera = cameraSystem('win32', off.os);
    expect(camera.access()).toBe('denied');
    expect(await camera.ask()).toBe('denied');
    expect(off.asked()).toBe(0);
    await camera.openSettings();
    expect(off.opened).toEqual([WINDOWS_CAMERA_SETTINGS]);
    expect(WINDOWS_CAMERA_SETTINGS).toBe('ms-settings:privacy-webcam');
    expect(cameraSystem('win32', os('granted').os).access()).toBe('granted');
  });

  it('elsewhere there is no such setting: allowed, nothing asked, nothing opened', async () => {
    const other = os('denied');
    const camera = cameraSystem('linux', other.os);
    expect(camera.access()).toBe('granted');
    expect(await camera.ask()).toBe('granted');
    await camera.openSettings();
    expect(other.asked()).toBe(0);
    expect(other.opened).toEqual([]);
  });

  it('tests: Chromium’s fake camera is allowed; a test may say how the setting stands; nothing is ever asked or opened', async () => {
    const fake = os('denied');
    const lines: string[] = [];
    const camera = cameraSystem('darwin', fake.os, { fake: true, log: (l) => lines.push(l) });
    expect(camera.access()).toBe('granted');
    await camera.openSettings();
    expect(fake.opened).toEqual([]);
    expect(lines).toEqual(['Camera: would open the privacy settings at Camera (a test)']);
    // DRASHTI_TEST_CAMERA_ACCESS: the Mac never asked (it is allowed once asked), or the setting is off.
    const never = cameraSystem('darwin', fake.os, { fake: true, access: 'not-determined' });
    expect(never.access()).toBe('not-determined');
    expect(await never.ask()).toBe('granted');
    expect(never.access()).toBe('granted');
    const off = cameraSystem('win32', fake.os, { fake: true, access: 'denied' });
    expect(await off.ask()).toBe('denied');
    await off.openSettings();
    expect(fake.asked()).toBe(0);
    expect(fake.opened).toEqual([]);
    // Anything else is no such word: the fake camera's own answer.
    expect(cameraSystem('darwin', fake.os, { fake: true, access: 'maybe' }).access()).toBe('granted');
  });
});
