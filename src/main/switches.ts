import { posix, win32 } from 'node:path';

/*
 * Drashti's DRASHTI_* switches (Session 30, Q5), every one read here. A packaged Drashti honours only those
 * the guides give admins (ADMIN_SWITCHES), and the performance check's (DRASHTI_PERF_*, windowed outputs,
 * extra displays) under DRASHTI_SELFTEST=performance. Every other switch, every DRASHTI_TEST_* and
 * DRASHTI_FFMPEG among them, is honoured only when Drashti is not packaged (development and the tests).
 *
 * Whether it is packaged is decided as Electron's app.isPackaged decides it, by the executable's name, so the
 * rule holds where there is no Electron app: a helper run as plain Node by the performance check, and the
 * unit tests. `switchesFor` takes both, for a test or a helper told by its parent.
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

export function switchesFor(packaged: boolean, env: Readonly<Record<string, string | undefined>>): Switches {
  const performance = env['DRASHTI_SELFTEST'] === 'performance';
  return (name) => (!packaged || honouredPackaged(name, performance) ? env[name] : undefined);
}

/** Packaged, as Electron decides it: run by anything but Electron's own executable. */
export function packagedExecutable(execPath: string, platform: NodeJS.Platform): boolean {
  const exe = (platform === 'win32' ? win32 : posix).basename(execPath).toLowerCase();
  return platform === 'win32' ? exe !== 'electron.exe' : exe !== 'electron';
}

let here: Switches | null = null;

/** This process's switches. */
export function sw(name: SwitchName): string | undefined {
  here ??= switchesFor(packagedExecutable(process.execPath, process.platform), process.env);
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
