import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/*
 * The two programs YouTube in Import from a Link runs (Session 25c), fetched
 * and checked by scripts/fetch-youtube-tools.mjs: yt-dlp, which downloads
 * (Drashti holds no YouTube downloading code of its own), and Deno, which
 * yt-dlp starts to run YouTube's own player JavaScript. Packaged, they sit
 * beside FFmpeg in the app's resources; run from the repository, in vendor/.
 *
 * Nothing of the user's reaches them: they get an environment of Drashti's
 * own making (no DENO_*, NODE_*, PYTHON*, yt-dlp or proxy variables, and a
 * home, temporary folder and Deno cache inside a Drashti work folder that is
 * emptied afterwards).
 */

export interface ToolPlace {
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
  platform: NodeJS.Platform;
  arch: string;
}

export interface YoutubeTools {
  ytDlp: string;
  deno: string;
}

/** Where yt-dlp and Deno should be (they may be missing: then YouTube says so). */
export function youtubeToolPaths(p: ToolPlace): YoutubeTools {
  const win = p.platform === 'win32';
  const ytDlpExe = win ? 'yt-dlp.exe' : 'yt-dlp_macos';
  const denoExe = win ? 'deno.exe' : 'deno';
  if (p.packaged)
    return {
      ytDlp: join(p.resourcesPath, 'yt-dlp', ytDlpExe),
      deno: join(p.resourcesPath, 'deno', denoExe),
    };
  const target = `${p.platform}-${p.arch}`;
  return {
    ytDlp: join(p.appPath, 'vendor', 'yt-dlp', target, ytDlpExe),
    deno: join(p.appPath, 'vendor', 'deno', target, denoExe),
  };
}

/** Both programs, or null when either is missing. */
export function findYoutubeTools(p: ToolPlace): YoutubeTools | null {
  const tools = youtubeToolPaths(p);
  return existsSync(tools.ytDlp) && existsSync(tools.deno) ? tools : null;
}

/**
 * How yt-dlp 2026.08.19 starts Deno to run YouTube's player JavaScript, read from its source
 * (yt_dlp/extractor/youtube/jsc/_builtin/deno.py: its base options, then --no-npm --cached-only because
 * Drashti allows no remote components). No --allow-* flag: Deno may read no file, reach no address,
 * read no environment variable and start no program. The script comes on its standard input ("-").
 * The packaged check starts Deno exactly this way (youtube-selftest.ts).
 */
export const DENO_AS_YT_DLP_RUNS_IT = [
  'run',
  '--ext=js',
  '--no-code-cache',
  '--no-prompt',
  '--no-remote',
  '--no-lock',
  '--node-modules-dir=none',
  '--no-config',
  '--no-npm',
  '--cached-only',
  '-',
];

/** The folders inside one work folder that the programs may write to. */
export interface ToolFolders {
  /** Their home (yt-dlp would look for settings there; it is told not to). */
  home: string;
  /** Their temporary folder. */
  temp: string;
  /** Deno's cache (yt-dlp's notes: Deno's analysis cache cannot be turned off). */
  deno: string;
}

export const toolFolders = (work: string): ToolFolders => ({
  home: join(work, 'home'),
  temp: join(work, 'temp'),
  deno: join(work, 'deno'),
});

/** The few system variables a program needs to start on Windows (none of them the user's choice). */
const WINDOWS_SYSTEM = [
  'SystemRoot',
  'windir',
  'SystemDrive',
  'ComSpec',
  'PATHEXT',
  'OS',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'PROCESSOR_LEVEL',
  'PROCESSOR_REVISION',
];

/**
 * The whole environment yt-dlp (and so Deno, which yt-dlp gives its own environment) runs with: built
 * from nothing, never from Drashti's, so none of the user's DENO_*, NODE_*, PYTHON*, yt-dlp, proxy or
 * other variables can reach them. Deno's update check is off and its cache is in the work folder.
 */
export function toolEnv(
  folders: ToolFolders,
  platform: NodeJS.Platform,
  system: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  if (platform === 'win32') {
    for (const name of WINDOWS_SYSTEM) {
      // Windows' own variables keep their spelling but not always their case: find each either way.
      const key = Object.keys(system).find((k) => k.toLowerCase() === name.toLowerCase());
      const value = key === undefined ? undefined : system[key];
      if (value !== undefined) env[name] = value;
    }
    const root = env['SystemRoot'] ?? 'C:\\Windows';
    env['PATH'] = [join(root, 'System32'), root, join(root, 'System32', 'Wbem')].join(';');
    env['USERPROFILE'] = folders.home;
    env['APPDATA'] = join(folders.home, 'AppData', 'Roaming');
    env['LOCALAPPDATA'] = join(folders.home, 'AppData', 'Local');
    env['TEMP'] = folders.temp;
    env['TMP'] = folders.temp;
  } else {
    env['PATH'] = '/usr/bin:/bin:/usr/sbin:/sbin';
    env['TMPDIR'] = folders.temp;
    env['LANG'] = 'en_US.UTF-8';
  }
  env['HOME'] = folders.home;
  env['DENO_DIR'] = folders.deno;
  env['DENO_NO_UPDATE_CHECK'] = '1';
  env['DENO_NO_PROMPT'] = '1';
  env['DENO_NO_PACKAGE_JSON'] = '1';
  env['NO_COLOR'] = '1';
  return env;
}

/**
 * Stop a program and every program it started (yt-dlp's Deno and FFmpeg): on a Mac its process group
 * (it is started as the leader of one), on Windows its tree. Waits for nothing.
 */
export function killTree(pid: number, platform: NodeJS.Platform = process.platform): void {
  if (platform === 'win32') {
    const root = process.env['SystemRoot'] ?? 'C:\\Windows';
    spawnSync(join(root, 'System32', 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Gone already, or never the leader of a group: stop the one process.
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Gone already.
    }
  }
}
