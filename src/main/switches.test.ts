import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ffmpegCandidates } from './stream/ffmpeg-path';
import { ADMIN_SWITCHES, packagedExecutable, switchesFor } from './switches';

/*
 * Which DRASHTI_* switches Drashti honours (Session 30, Q5): packaged, the admin's few always and the
 * performance check's under DRASHTI_SELFTEST=performance; every other one only unpackaged. And every switch
 * in src is read through switches.ts: a test of the source, so a switch added later cannot slip past.
 */

const src = join(__dirname, '..');

/** Lines a packaged Drashti's own processes pass each other, or print: never a switch someone sets. */
const INTERNAL = new Set([
  // Lines the self-tests and the performance check print for the test that started them.
  'DRASHTI_SELFTEST_RESULT',
  'DRASHTI_PERFTEST_RESULT',
  'DRASHTI_DEVICE_STATS',
  'DRASHTI_NODE_STATS',
  // The installer's check of a signature, given to the PowerShell it starts.
  'DRASHTI_SIGNED_FILE',
  // A drive (Session 31: is the recording's folder on FAT32?), given to the PowerShell it starts.
  'DRASHTI_DRIVE',
  // What the tests' fake yt-dlp is told, by Drashti, when the tests run it (links/youtube-tools.ts).
  'DRASHTI_FAKE_YT_DLP_CONFIG',
  // What the performance check tells the helpers it starts (perf-devices.ts, perf-nodes.ts).
  'DRASHTI_PERF_PORT',
  'DRASHTI_PERF_PAGES',
  'DRASHTI_PERF_VERSION',
  'DRASHTI_PERF_PROTOCOL',
  'DRASHTI_PERF_ENGINE',
]);
/** The files where a helper reads what its parent gave it, as plain Node (no switches.ts there). */
const HELPERS = new Set(['main/network/perf-devices.ts', 'main/nodes/perf-nodes.ts']);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|mjs|cjs)$/u.test(name) && !/\.test\.tsx?$/u.test(name) ? [path] : [];
  });
}

describe('switches', () => {
  it('packaged: the admin’s always, the performance check’s only while it runs, the rest never', () => {
    const env = {
      DRASHTI_SELFTEST: 'watchdog',
      DRASHTI_USER_DATA_DIR: '/data',
      DRASHTI_TEST_FAKE_DEVICES: '1',
      // Session 50: the placeholder presentations, which a new library starts without, for the tests only.
      DRASHTI_TEST_SEED_PLACEHOLDERS: '1',
      DRASHTI_FFMPEG: '/elsewhere/ffmpeg',
      DRASHTI_PERF_SONGS: '50',
      DRASHTI_WINDOWED_OUTPUTS: '1',
      DRASHTI_UPDATE_URL: 'http://127.0.0.1:9',
    };
    const packaged = switchesFor(true, env);
    expect(packaged('DRASHTI_USER_DATA_DIR')).toBe('/data');
    expect(packaged('DRASHTI_SELFTEST')).toBe('watchdog');
    for (const name of [
      'DRASHTI_TEST_FAKE_DEVICES',
      'DRASHTI_TEST_SEED_PLACEHOLDERS',
      'DRASHTI_FFMPEG',
      'DRASHTI_PERF_SONGS',
      'DRASHTI_WINDOWED_OUTPUTS',
      'DRASHTI_UPDATE_URL',
    ] as const)
      expect(packaged(name), name).toBeUndefined();
    const performance = switchesFor(true, { ...env, DRASHTI_SELFTEST: 'performance' });
    expect(performance('DRASHTI_PERF_SONGS')).toBe('50');
    expect(performance('DRASHTI_WINDOWED_OUTPUTS')).toBe('1');
    expect(performance('DRASHTI_TEST_FAKE_DEVICES')).toBeUndefined();
    expect(performance('DRASHTI_FFMPEG')).toBeUndefined();
    // Unpackaged (development, the tests): everything.
    expect(switchesFor(false, env)('DRASHTI_TEST_FAKE_DEVICES')).toBe('1');
    expect(switchesFor(false, env)('DRASHTI_TEST_SEED_PLACEHOLDERS')).toBe('1');
    expect(ADMIN_SWITCHES.size).toBe(9);
  });

  it('packaged, runs only the self-tests it knows: any other name is no self-test at all (Session 54, E review)', () => {
    for (const known of ['watchdog', 'node-watchdog', 'performance', 'ffmpeg', 'restore-relaunch'])
      expect(switchesFor(true, { DRASHTI_SELFTEST: known })('DRASHTI_SELFTEST'), known).toBe(known);
    for (const other of ['x', 'old-library', 'WATCHDOG', ''])
      expect(switchesFor(true, { DRASHTI_SELFTEST: other })('DRASHTI_SELFTEST'), other).toBeUndefined();
    // Unpackaged (development, the tests): as given.
    expect(switchesFor(false, { DRASHTI_SELFTEST: 'old-library' })('DRASHTI_SELFTEST')).toBe('old-library');
  });

  it('packaged as Electron decides it: by the executable, so a helper run as Node decides it the same', () => {
    expect(
      packagedExecutable('/x/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', 'darwin'),
    ).toBe(false);
    expect(packagedExecutable('/Applications/Drashti.app/Contents/MacOS/Drashti', 'darwin')).toBe(true);
    expect(packagedExecutable('C:\\x\\node_modules\\electron\\dist\\electron.exe', 'win32')).toBe(false);
    expect(packagedExecutable('C:\\Program Files\\Drashti\\Drashti.exe', 'win32')).toBe(true);
  });

  it('a packaged Drashti runs its own FFmpeg, whatever DRASHTI_FFMPEG says', () => {
    const place = { resourcesPath: '/r', appPath: '/a', platform: 'darwin' as const, arch: 'arm64' };
    expect(ffmpegCandidates({ ...place, packaged: true, override: '/elsewhere/ffmpeg' })).toEqual([
      join('/r', 'ffmpeg', 'ffmpeg'),
    ]);
    expect(ffmpegCandidates({ ...place, packaged: false, override: '/elsewhere/ffmpeg' })).toEqual([
      '/elsewhere/ffmpeg',
    ]);
  });

  it('every DRASHTI_ switch in src is read through switches.ts', () => {
    const bypass: string[] = [];
    const unread = new Set<string>();
    const named = new Set<string>();
    const through = new Set<string>();
    for (const file of sources(src)) {
      const rel = relative(src, file).split('\\').join('/');
      if (rel === 'main/switches.ts') continue;
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/DRASHTI_[A-Z0-9_]*[A-Z0-9]/gu)) named.add(m[0]);
      for (const m of text.matchAll(/\bsw(?:On|Ms)?\(\s*'(DRASHTI_[A-Z0-9_]+)'/gu)) through.add(m[1] ?? '');
      // A read straight from the environment: only a helper's of what its parent gave it.
      for (const m of text.matchAll(
        /process\.env(?:\[\s*'(DRASHTI_[A-Z0-9_]+)'\s*\]|\.(DRASHTI_[A-Z0-9_]+))/gu,
      )) {
        const name = m[1] ?? m[2] ?? '';
        if (!(HELPERS.has(rel) && INTERNAL.has(name))) bypass.push(`${rel}: ${name}`);
      }
    }
    for (const name of named) if (!through.has(name) && !INTERNAL.has(name)) unread.add(name);
    expect(bypass, 'read straight from process.env').toEqual([]);
    // Named but neither read through switches.ts nor one of Drashti's own lines (the prefix DRASHTI_TEST_ is
    // the one exception: anyTestSwitch looks at every switch it begins).
    expect([...unread].filter((n) => n !== 'DRASHTI_TEST').sort()).toEqual([]);
  });
});
