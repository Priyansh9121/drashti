import { describe, expect, it } from 'vitest';
import { isAudioPage, permissionCheckAllowed } from './security';

const AUDIO = 'file:///Applications/Drashti.app/Contents/Resources/app.asar/out/renderer/audio.html';
const OPERATOR = 'file:///Applications/Drashti.app/Contents/Resources/app.asar/out/renderer/index.html';

describe('permissions', () => {
  it('lets only the audio player see and choose sound outputs', () => {
    expect(permissionCheckAllowed('speaker-selection', true, AUDIO)).toBe(true);
    expect(permissionCheckAllowed('speaker-selection', true, 'http://localhost:5173/audio.html')).toBe(true);
    // Another window, or the audio player's window showing any other page, gets nothing.
    expect(permissionCheckAllowed('speaker-selection', false, AUDIO)).toBe(false);
    expect(permissionCheckAllowed('speaker-selection', true, OPERATOR)).toBe(false);
    expect(permissionCheckAllowed('speaker-selection', true, 'https://example.com/audio.html')).toBe(false);
  });

  it('refuses everything else, even to the audio player', () => {
    for (const permission of [
      'media',
      'notifications',
      'geolocation',
      'clipboard-read',
      'display-capture',
      'midi',
      'hid',
      'serial',
      'usb',
      'fullscreen',
      'openExternal',
      'unknown',
    ]) {
      expect(permissionCheckAllowed(permission, true, AUDIO), permission).toBe(false);
      expect(permissionCheckAllowed(permission, false, OPERATOR), permission).toBe(false);
    }
  });

  it('knows the audio page by its address', () => {
    expect(isAudioPage(AUDIO)).toBe(true);
    expect(isAudioPage(`${AUDIO}?x=1`)).toBe(true);
    expect(isAudioPage('file:///x/audio.html.evil')).toBe(false);
    expect(isAudioPage('not a url')).toBe(false);
  });
});
