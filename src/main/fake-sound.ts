import { posix, win32 } from 'node:path';

/*
 * Chromium's fake camera and microphone, for the tests only (never a packaged Drashti: switches.ts honours no
 * DRASHTI_TEST_* there). DRASHTI_TEST_FAKE_DEVICES=1 puts a moving test pattern and a beep in place of real devices.
 * With DRASHTI_TEST_FAKE_SOUND_FILE too (alpha.23, cap-realc), the fake microphone plays that WAV file once instead of
 * its beep: generated speech for caption AI's real recogniser, heard through the stream's own sound graph, its speech
 * tap and its port to Main, as a mixer's feed is. Every one of Chromium's fake media switches is named here alone.
 */

/** Chromium's fake camera and microphone. */
export const CHROMIUM_FAKE_DEVICES = 'use-fake-device-for-media-stream';
/** Chromium's fake microphone plays this WAV file (`<file>%noloop`: once, then silence). */
export const CHROMIUM_FAKE_SOUND_FILE = 'use-file-for-fake-audio-capture';
/** Chromium answers every camera and microphone question yes, without asking (Drashti never sets it). */
const CHROMIUM_FAKE_UI = 'use-fake-ui-for-media-stream';

/**
 * The value for Chromium's fake microphone to play `file` once, or null: only with Chromium's fake devices (so the
 * file never stands in front of a real microphone), and only an absolute path to a .wav file without '%' (Chromium's
 * separator before its `noloop`; any other word there stops its audio service).
 */
export function fakeSoundSwitch(o: {
  fakeDevices: boolean;
  file: string | undefined;
  platform: NodeJS.Platform;
}): string | null {
  const file = o.file;
  if (!o.fakeDevices || !file) return null;
  // Windows: a drive's or a share's whole path (a path from the root of "the current drive" is not one).
  const absolute =
    o.platform === 'win32'
      ? /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/])/iu.test(file) && win32.isAbsolute(file)
      : posix.isAbsolute(file);
  if (!absolute || file.includes('%') || !/\.wav$/iu.test(file)) return null;
  return `${file}%noloop`;
}

/** Which of Chromium's fake media switches this process has on (the packaged self-test requires none). */
export function fakeMediaSwitchesOn(has: (name: string) => boolean): string[] {
  return [CHROMIUM_FAKE_DEVICES, CHROMIUM_FAKE_SOUND_FILE, CHROMIUM_FAKE_UI].filter((name) => has(name));
}

/**
 * The packaged self-test's part (DRASHTI_SELFTEST=ffmpeg, scripts/check-ffmpeg.mjs --packaged, started asking for the
 * fake devices and the fake microphone's file): passed only when none of Chromium's fake media switches is on.
 */
export function fakeMediaSelfTest(has: (name: string) => boolean): {
  passed: boolean;
  on: string[];
  detail: string;
} {
  const on = fakeMediaSwitchesOn(has);
  return on.length === 0
    ? { passed: true, on, detail: 'none: Chromium’s fake camera and microphone are off' }
    : { passed: false, on, detail: `ON in this copy of Drashti: ${on.join(', ')}` };
}
