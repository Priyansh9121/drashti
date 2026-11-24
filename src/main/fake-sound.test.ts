import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHROMIUM_FAKE_DEVICES,
  CHROMIUM_FAKE_SOUND_FILE,
  fakeMediaSelfTest,
  fakeMediaSwitchesOn,
  fakeSoundFeatures,
  fakeSoundSwitch,
} from './fake-sound';
import { switchesFor } from './switches';

/*
 * The test seam for caption AI's real recogniser (alpha.23, cap-realc): Chromium's fake microphone plays a generated
 * WAV file once, so the stream's own sound graph (the device, its tap, the port to Main) carries generated speech to
 * Route C with no microphone and no engine swapped. Never in a packaged Drashti, and never with a real microphone.
 */

const WAV = '/placeholder/test-results/caption clips.wav';
const env = (more: Record<string, string> = {}) => ({
  DRASHTI_TEST_FAKE_DEVICES: '1',
  DRASHTI_TEST_FAKE_SOUND_FILE: WAV,
  ...more,
});
/** What index.ts gives the seam: the two switches as switches.ts reads them. */
const seam = (packaged: boolean, given: Record<string, string>, platform: NodeJS.Platform = 'darwin') => {
  const sw = switchesFor(packaged, given);
  return fakeSoundSwitch({
    fakeDevices: sw('DRASHTI_TEST_FAKE_DEVICES') === '1',
    file: sw('DRASHTI_TEST_FAKE_SOUND_FILE'),
    platform,
  });
};

describe('the fake microphone’s sound file (tests only)', () => {
  it('unpackaged, with Chromium’s fake devices: the fake microphone plays the file once (Chromium’s %noloop)', () => {
    expect(CHROMIUM_FAKE_SOUND_FILE).toBe('use-file-for-fake-audio-capture');
    expect(CHROMIUM_FAKE_DEVICES).toBe('use-fake-device-for-media-stream');
    expect(seam(false, env())).toBe(`${WAV}%noloop`);
    expect(seam(false, env({ DRASHTI_TEST_FAKE_SOUND_FILE: 'C:\\placeholder\\clips.WAV' }), 'win32')).toBe(
      'C:\\placeholder\\clips.WAV%noloop',
    );
  });

  it('never without Chromium’s fake devices: the file is never put in place of a real microphone', () => {
    expect(seam(false, { DRASHTI_TEST_FAKE_SOUND_FILE: WAV })).toBeNull();
    expect(seam(false, env({ DRASHTI_TEST_FAKE_DEVICES: '0' }))).toBeNull();
  });

  it('packaged: nothing, whatever the environment says (the performance check’s run included)', () => {
    expect(seam(true, env())).toBeNull();
    expect(seam(true, env({ DRASHTI_SELFTEST: 'performance' }))).toBeNull();
    expect(seam(true, env({ DRASHTI_SELFTEST: 'ffmpeg' }), 'win32')).toBeNull();
  });

  it('refuses a file Chromium would misread: not given, relative, not a .wav, or with Chromium’s % separator in it', () => {
    expect(seam(false, { DRASHTI_TEST_FAKE_DEVICES: '1' })).toBeNull();
    for (const file of [
      '',
      'clips.wav',
      './test-results/clips.wav',
      '/placeholder/clips.mp3',
      '/placeholder/clips.wav.txt',
      '/placeholder/100%/clips.wav',
      '/placeholder/clips.wav%noloop',
    ])
      expect(seam(false, env({ DRASHTI_TEST_FAKE_SOUND_FILE: file })), file).toBeNull();
    // Each system's own idea of an absolute path.
    expect(seam(false, env({ DRASHTI_TEST_FAKE_SOUND_FILE: '/placeholder/clips.wav' }), 'win32')).toBeNull();
    expect(
      seam(false, env({ DRASHTI_TEST_FAKE_SOUND_FILE: 'C:\\placeholder\\clips.wav' }), 'darwin'),
    ).toBeNull();
  });

  it('says which of Chromium’s fake media switches are on (the packaged self-test requires none)', () => {
    const on = new Set<string>();
    const has = (name: string) => on.has(name);
    expect(fakeMediaSwitchesOn(has)).toEqual([]);
    on.add(CHROMIUM_FAKE_SOUND_FILE);
    expect(fakeMediaSwitchesOn(has)).toEqual([CHROMIUM_FAKE_SOUND_FILE]);
    on.add(CHROMIUM_FAKE_DEVICES);
    on.add('use-fake-ui-for-media-stream');
    expect(fakeMediaSwitchesOn(has)).toEqual([
      CHROMIUM_FAKE_DEVICES,
      CHROMIUM_FAKE_SOUND_FILE,
      'use-fake-ui-for-media-stream',
    ]);
  });

  it('the packaged self-test (DRASHTI_SELFTEST=ffmpeg) passes only with none of them on, and names any that are', () => {
    expect(fakeMediaSelfTest(() => false, 'HardwareMediaKeyHandling')).toEqual({
      passed: true,
      on: [],
      detail: 'none: Chromium’s fake camera and microphone are off',
    });
    const on = fakeMediaSelfTest(
      (name) => name === CHROMIUM_FAKE_SOUND_FILE || name === CHROMIUM_FAKE_DEVICES,
      'HardwareMediaKeyHandling',
    );
    expect(on).toEqual({
      passed: false,
      on: [CHROMIUM_FAKE_DEVICES, CHROMIUM_FAKE_SOUND_FILE],
      detail: `ON in this copy of Drashti: ${CHROMIUM_FAKE_DEVICES}, ${CHROMIUM_FAKE_SOUND_FILE}`,
    });
    // The Mac audio service's sandbox off (the seam's other half) counts too.
    expect(fakeMediaSelfTest(() => false, 'HardwareMediaKeyHandling,AudioServiceSandbox')).toEqual({
      passed: false,
      on: ['disable-features=AudioServiceSandbox'],
      detail: 'ON in this copy of Drashti: disable-features=AudioServiceSandbox',
    });
  });

  it('macOS: the audio service reads only its own system folders in its sandbox, so with the file (tests only) its sandbox is off; never on Windows (it reads the file there), never without the file', () => {
    expect(
      fakeSoundFeatures({ sound: `${WAV}%noloop`, platform: 'darwin', disabled: 'HardwareMediaKeyHandling' }),
    ).toBe('HardwareMediaKeyHandling,AudioServiceSandbox');
    expect(fakeSoundFeatures({ sound: `${WAV}%noloop`, platform: 'darwin', disabled: '' })).toBe(
      'AudioServiceSandbox',
    );
    expect(
      fakeSoundFeatures({ sound: `${WAV}%noloop`, platform: 'win32', disabled: 'HardwareMediaKeyHandling' }),
    ).toBeNull();
    expect(
      fakeSoundFeatures({ sound: null, platform: 'darwin', disabled: 'HardwareMediaKeyHandling' }),
    ).toBeNull();
    // Packaged: the seam's value is null, so the sandbox stays.
    expect(
      fakeSoundFeatures({
        sound: seam(true, env()),
        platform: 'darwin',
        disabled: 'HardwareMediaKeyHandling',
      }),
    ).toBeNull();
  });

  it('Chromium’s fake media switches are named in src only by fake-sound.ts, so nothing else can turn them on', () => {
    const src = join(__dirname, '..');
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return files(path);
        return /\.(ts|tsx|mjs|cjs)$/u.test(name) && !/\.test\.tsx?$/u.test(name) ? [path] : [];
      });
    const naming = files(src)
      .filter((file) =>
        /use-fake-device-for-media-stream|use-file-for-fake-audio-capture|use-fake-ui-for-media-stream/u.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map((file) => relative(src, file).split('\\').join('/'));
    expect(naming).toEqual(['main/fake-sound.ts']);
  });
});
