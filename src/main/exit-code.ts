/*
 * A process's exit code as someone reading the log can look it up (Session 39): Windows' in hex, as its crash
 * codes are written (0xC0000005 is an access violation); on a Mac, a crash's signal by its name (Chromium gives
 * the signal's number as the code there: a renderer that crashed reads 11, SIGSEGV), and any other code as
 * its number (a renderer Drashti stopped itself reads 2, Chromium's own code for a hung one).
 */

/** The signals a crash ends on, by number, on a Mac and on Linux (where 7 and 10 differ). */
const SIGNALS: Record<'darwin' | 'linux', Readonly<Record<number, string>>> = {
  darwin: {
    4: 'SIGILL',
    5: 'SIGTRAP',
    6: 'SIGABRT',
    7: 'SIGEMT',
    8: 'SIGFPE',
    9: 'SIGKILL',
    10: 'SIGBUS',
    11: 'SIGSEGV',
    12: 'SIGSYS',
    13: 'SIGPIPE',
    15: 'SIGTERM',
  },
  linux: {
    4: 'SIGILL',
    5: 'SIGTRAP',
    6: 'SIGABRT',
    7: 'SIGBUS',
    8: 'SIGFPE',
    9: 'SIGKILL',
    11: 'SIGSEGV',
    15: 'SIGTERM',
  },
};

/** Chromium's reasons for a process that ended on a signal (its exit code is then the signal's number). */
const ON_A_SIGNAL = new Set(['crashed', 'oom']);

/** "exit code 0xC0000005", "signal 11: SIGSEGV" or "exit code 2"; null when there is no code to give. */
export function exitText(
  exitCode: number | undefined,
  reason: string,
  platform: NodeJS.Platform,
): string | null {
  if (exitCode === undefined || !Number.isInteger(exitCode)) return null;
  if (platform === 'win32')
    return `exit code 0x${(exitCode >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
  const signal = platform === 'darwin' || platform === 'linux' ? SIGNALS[platform][exitCode] : undefined;
  if (ON_A_SIGNAL.has(reason) && signal) return `signal ${String(exitCode)}: ${signal}`;
  return `exit code ${String(exitCode)}`;
}
