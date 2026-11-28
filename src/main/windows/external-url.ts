import { shell } from 'electron';
import { MAC_CAMERA_SETTINGS, WINDOWS_CAMERA_SETTINGS } from '../video-inputs/camera';

export interface ExternalUrlRules {
  /** Nonpackaged OAuth tests only, at this exact HTTP loopback origin. */
  loopbackOrigin?: string | undefined;
}

const SETTINGS = new Set([
  MAC_CAMERA_SETTINGS,
  WINDOWS_CAMERA_SETTINGS,
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
]);

/** Last decision before invoking an OS URL handler: web links and the three required privacy pages only. */
export async function openSafeExternal(url: string, rules: ExternalUrlRules = {}): Promise<void> {
  let allowed = SETTINGS.has(url);
  const unsafeText = Array.from(url).some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x20 || code === 0x7f || char === '\\';
  });
  if (!allowed && !unsafeText) {
    try {
      const parsed = new URL(url);
      if (parsed.username === '' && parsed.password === '' && parsed.hostname !== '') {
        allowed = parsed.protocol === 'https:';
        if (
          !allowed &&
          parsed.protocol === 'http:' &&
          parsed.hostname === '127.0.0.1' &&
          rules.loopbackOrigin
        ) {
          const fixture = new URL(rules.loopbackOrigin);
          allowed =
            fixture.protocol === 'http:' &&
            fixture.hostname === '127.0.0.1' &&
            fixture.username === '' &&
            fixture.password === '' &&
            parsed.origin === fixture.origin;
        }
      }
    } catch {
      // Invalid input never reaches the operating system. Do not put an OAuth query in an error or log.
    }
  }
  if (!allowed) throw new Error('External address refused');
  await shell.openExternal(url);
}
