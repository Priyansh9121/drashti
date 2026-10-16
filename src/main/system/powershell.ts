import { execFile } from 'node:child_process';
import { join } from 'node:path';

/*
 * Windows PowerShell for a short question to the system (Session 31: a drive's file system, a process's
 * start time and program). Always Windows' own copy by its full path, never one found on PATH, and
 * without PSModulePath: started from PowerShell 7 (as CI's steps are), Windows PowerShell would load
 * 7's modules and fail. It takes a second or so to start, so it is asked only off the hot path, with a
 * time limit, and an answer that does not come is no answer.
 */

/** Windows PowerShell itself, by its full path. */
export function powershellPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** This environment without PSModulePath (in any case), with `extra` added. */
export function powershellEnv(
  extra: Record<string, string> = {},
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env))
    if (key.toUpperCase() !== 'PSMODULEPATH' && !(key in extra)) out[key] = value;
  return { ...out, ...extra };
}

/**
 * Run a script and give what it printed, or null if it failed or took longer than `timeoutMs`.
 * Values go in through `extra` (environment variables), never into the script's text.
 */
export function runPowerShell(
  script: string,
  extra: Record<string, string> = {},
  timeoutMs = 10_000,
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: timeoutMs, windowsHide: true, env: powershellEnv(extra), maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        resolve(error ? null : stdout);
      },
    );
  });
}
