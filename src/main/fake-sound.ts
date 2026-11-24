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

/** Chromium's feature: the audio service runs in its sandbox (on macOS it reads only audio system folders). */
const AUDIO_SANDBOX = 'AudioServiceSandbox';

/**
 * macOS: the audio service's sandbox lets it read only audio system folders (Plug-Ins, Tunings, Components), so the
 * fake microphone hears silence where the tests' file lies (CI Mac, run 45291890198). With the file only (tests),
 * Chromium's `disable-features` gains its sandbox: the value to set, keeping what is already disabled; otherwise null.
 * Windows' audio service reads the file in its sandbox, which stays.
 */
export function fakeSoundFeatures(o: {
  sound: string | null;
  platform: NodeJS.Platform;
  disabled: string;
}): string | null {
  if (!o.sound || o.platform !== 'darwin') return null;
  return [...o.disabled.split(',').filter((f) => f !== '' && f !== AUDIO_SANDBOX), AUDIO_SANDBOX].join(',');
}

/** Which of Chromium's fake media switches this process has on (the packaged self-test requires none). */
export function fakeMediaSwitchesOn(has: (name: string) => boolean): string[] {
  return [CHROMIUM_FAKE_DEVICES, CHROMIUM_FAKE_SOUND_FILE, CHROMIUM_FAKE_UI].filter((name) => has(name));
}

/**
 * The packaged self-test's part (DRASHTI_SELFTEST=ffmpeg, scripts/check-ffmpeg.mjs --packaged, started asking for the
 * fake devices, the fake microphone's file and the stream-clock seam's clip): passed only when none of Chromium's fake
 * media switches is on, the audio service keeps its sandbox, and the stream's page has no test clip to play.
 */
export function fakeMediaSelfTest(
  has: (name: string) => boolean,
  disabledFeatures: string,
  streamTestSound = false,
): {
  passed: boolean;
  on: string[];
  detail: string;
} {
  const on = [
    ...fakeMediaSwitchesOn(has),
    ...(disabledFeatures.split(',').includes(AUDIO_SANDBOX) ? [`disable-features=${AUDIO_SANDBOX}`] : []),
    ...(streamTestSound ? ['DRASHTI_TEST_STREAM_SOUND_FILE'] : []),
  ];
  return on.length === 0
    ? { passed: true, on, detail: 'none: Chromium’s fake camera and microphone are off' }
    : { passed: false, on, detail: `ON in this copy of Drashti: ${on.join(', ')}` };
}
