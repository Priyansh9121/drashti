import { posix, win32 } from 'node:path';

/*
 * Drashti's DRASHTI_* switches (Session 30, Q5), every one read here. A packaged Drashti honours only those
 * the guides give admins (ADMIN_SWITCHES), and the performance check's (DRASHTI_PERF_*, windowed outputs,
 * extra displays) under DRASHTI_SELFTEST=performance. Every other switch, every DRASHTI_TEST_* and
 * DRASHTI_FFMPEG among them, is honoured only when Drashti is not packaged (development and the tests).
 *
 * Whether it is packaged (Session 55 review, packagedRun): its main code runs from an app.asar, as an installed
 * Drashti's does whatever its executable is called (a copy of the app renamed electron included), or it is not run by
 * Electron's own executable (Electron's own rule for app.isPackaged, which a helper run as plain Node keeps). The
 * one answer is packaged(), for this file's switches and everywhere else Drashti asks (src/main/index.ts).
 * `switchesFor` takes it, for a test or a helper told by its parent.
 */

/** What a packaged Drashti honours: the guides tell admins to use these (README, "Switches"). */
export const ADMIN_SWITCHES: ReadonlySet<string> = new Set([
  'DRASHTI_SELFTEST',
  'DRASHTI_SELFTEST_DIR',
  'DRASHTI_USER_DATA_DIR',
  'DRASHTI_NO_QUIT_CONFIRM',
  'DRASHTI_PRIORITY',
  'DRASHTI_DIAGNOSTICS',
  'DRASHTI_ROLE',
  'DRASHTI_NODE_PORT',
  'DRASHTI_LOG_PERMISSIONS',
]);

/** Honoured packaged only by the performance check (DRASHTI_SELFTEST=performance), with every DRASHTI_PERF_*. */
export const PERFORMANCE_SWITCHES: ReadonlySet<string> = new Set([
  'DRASHTI_WINDOWED_OUTPUTS',
  'DRASHTI_EXTRA_DISPLAYS',
]);
const PERF = /^DRASHTI_PERF_[A-Z0-9_]+$/u;

export type SwitchName = `DRASHTI_${string}`;
export type Switches = (name: SwitchName) => string | undefined;

/** Whether a packaged Drashti honours a switch (with the performance check running, or not). */
export function honouredPackaged(name: string, performance: boolean): boolean {
  return ADMIN_SWITCHES.has(name) || (performance && (PERF.test(name) || PERFORMANCE_SWITCHES.has(name)));
}

/**
 * The self-tests a packaged Drashti runs (Session 54, E review): any other DRASHTI_SELFTEST is no self-test at all, so
 * it never starts Drashti as one (locked, yet with its engine taking a self-test's commands).
 */
export const PACKAGED_SELF_TESTS: ReadonlySet<string> = new Set([
  'watchdog',
  'node-watchdog',
  'performance',
  'ffmpeg',
  'restore-relaunch',
]);

export function switchesFor(packaged: boolean, env: Readonly<Record<string, string | undefined>>): Switches {
  const performance = env['DRASHTI_SELFTEST'] === 'performance';
  return (name) => {
    if (packaged && !honouredPackaged(name, performance)) return undefined;
    const value = env[name];
    if (packaged && name === 'DRASHTI_SELFTEST' && value !== undefined && !PACKAGED_SELF_TESTS.has(value))
      return undefined;
    return value;
  };
}

/** Packaged, as Electron decides it: run by anything but Electron's own executable. */
export function packagedExecutable(execPath: string, platform: NodeJS.Platform): boolean {
  const exe = (platform === 'win32' ? win32 : posix).basename(execPath).toLowerCase();
  return platform === 'win32' ? exe !== 'electron.exe' : exe !== 'electron';
}

/**
 * Packaged (Session 55 review): the main code runs from an app.asar (`codeDir`, where this code is), whatever the
 * executable is called, or Electron's own rule says so. Development, the end-to-end tests and the performance check
 * run Electron's own executable on the code in out/: not packaged.
 */
export function packagedRun(execPath: string, platform: NodeJS.Platform, codeDir: string): boolean {
  return packagedExecutable(execPath, platform) || /\.asar(?:[\\/]|$)/iu.test(codeDir);
}

let packagedHere: boolean | null = null;

/** Whether this Drashti is packaged: the one answer for every switch and everywhere Drashti asks. */
export function packaged(): boolean {
  packagedHere ??= packagedRun(process.execPath, process.platform, __dirname);
  return packagedHere;
}

let here: Switches | null = null;

/** This process's switches. */
export function sw(name: SwitchName): string | undefined {
  here ??= switchesFor(packaged(), process.env);
  return here(name);
}

/** A test's length of time (ms), or null: not given, not a positive number, or packaged. */
export function swMs(name: SwitchName): number | null {
  const ms = Number(sw(name));
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/** A switch that is on ('1'). */
export const swOn = (name: SwitchName): boolean => sw(name) === '1';

/** Whether any DRASHTI_TEST_* switch is given and honoured (then YouTube's real yt-dlp never starts). */
export function anyTestSwitch(): boolean {
  return Object.keys(process.env).some(
    (k) => k.startsWith('DRASHTI_TEST_') && sw(k as SwitchName) !== undefined,
  );
}
