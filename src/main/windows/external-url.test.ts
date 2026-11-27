import { describe, expect, it, vi, beforeEach } from 'vitest';
import { openSafeExternal } from './external-url';
import { MAC_CAMERA_SETTINGS, WINDOWS_CAMERA_SETTINGS } from '../video-inputs/camera';

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn(async () => undefined) }));
vi.mock('electron', () => ({ shell: { openExternal } }));
beforeEach(() => openExternal.mockClear());

const SCREEN = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

it.each(['https://accounts.google.com/o/oauth2/v2/auth?state=placeholder',
  MAC_CAMERA_SETTINGS, WINDOWS_CAMERA_SETTINGS, SCREEN])('preserves the required external link: %s', async (url) => {
  await openSafeExternal(url);
  expect(openExternal).toHaveBeenCalledExactlyOnceWith(url);
});

it.each(['file:///tmp/placeholder.txt', 'file://host/share/app.exe', 'javascript:void(0)',
  'data:text/html,placeholder', 'cmd:placeholder', 'powershell:placeholder', 'smb://host/share',
  'ms-settings:other-page', `${WINDOWS_CAMERA_SETTINGS}?extra=1`,
  `${MAC_CAMERA_SETTINGS}&other=1`, `${SCREEN}Extra`,
  'http://example.invalid/', 'http://127.0.0.1:1234/', '//example.invalid/',
  'https://user:password@example.invalid/', ' https://example.invalid/',
  'https://example.invalid/\nplaceholder', 'https:\\example.invalid/'])('refuses unsafe or unneeded OS handlers: %s', async (url) => {
  await expect(openSafeExternal(url)).rejects.toThrow('External address refused');
  expect(openExternal).not.toHaveBeenCalled();
});

it('allows test OAuth only at the explicitly supplied loopback origin', async () => {
  const url = 'http://127.0.0.1:4321/o/oauth2/v2/auth?state=placeholder';
  await openSafeExternal(url, { loopbackOrigin: 'http://127.0.0.1:4321' });
  expect(openExternal).toHaveBeenCalledExactlyOnceWith(url);
  openExternal.mockClear();
  for (const bad of ['http://127.0.0.1:4322/', 'http://localhost:4321/',
    'http://127.0.0.1.example.invalid:4321/', 'http://example.invalid/']) {
    await expect(openSafeExternal(bad, { loopbackOrigin: 'http://127.0.0.1:4321' }))
      .rejects.toThrow('External address refused');
  }
  expect(openExternal).not.toHaveBeenCalled();
});
