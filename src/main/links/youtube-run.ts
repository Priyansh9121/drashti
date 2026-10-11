import { spawn } from 'node:child_process';
import { constants, setPriority } from 'node:os';
import { killTree } from './youtube-tools';

/*
 * Starting yt-dlp (Session 25c), in the download process: at the lowest
 * priority, which the Deno and FFmpeg it starts inherit; as the leader of a
 * process group of its own on a Mac (so stopping it stops them too); with
 * the environment Drashti made for it, never Drashti's own. What it prints
 * is read line by line and never logged.
 */

/** How yt-dlp is started: the real one, or (tests only, never in a packaged Drashti) the fake. */
export interface YtDlpLaunch {
  command: string;
  /** Arguments before yt-dlp's own (the fake's script). */
  prefix: string[];
  env: Record<string, string>;
  /** Drashti's own Deno and FFmpeg, for yt-dlp's options. */
  deno: string;
  ffmpeg: string;
}

export interface ToolRun {
  pid: number | null;
  /** How it ended, with the end of what it printed on its error output. */
  done: Promise<{ code: number | null; errors: string }>;
  /** Stop it and everything it started (Deno, FFmpeg). */
  stop(): void;
}

/** Kept of the error output: its end, where yt-dlp says what went wrong. */
const ERRORS_KEPT = 64 * 1024;

export function runYtDlp(
  launch: YtDlpLaunch,
  args: string[],
  cwd: string,
  onLine: (line: string) => void,
): ToolRun {
  const child = spawn(launch.command, [...launch.prefix, ...args], {
    env: launch.env,
    cwd,
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (child.pid !== undefined)
    try {
      setPriority(child.pid, constants.priority.PRIORITY_LOW);
    } catch {
      // It inherits the download process's own low priority anyway.
    }
  let pending = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/\r?\n|\r/u);
    pending = lines.pop() ?? '';
    for (const line of lines) onLine(line);
  });
  let errors = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    errors = (errors + chunk).slice(-ERRORS_KEPT);
  });
  const done = new Promise<{ code: number | null; errors: string }>((resolve) => {
    child.on('error', () => {
      resolve({ code: null, errors });
    });
    child.on('close', (code) => {
      if (pending !== '') onLine(pending);
      pending = '';
      resolve({ code, errors });
    });
  });
  return {
    pid: child.pid ?? null,
    done,
    stop: () => {
      if (child.pid !== undefined) killTree(child.pid);
    },
  };
}
