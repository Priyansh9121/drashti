import { describe, expect, it } from 'vitest';
import { exitText } from './exit-code';

/*
 * A crashed process's exit code as a log reader can look it up (Session 39): Windows' in hex, a Mac's crash by
 * its signal (Chromium gives the signal's number), any other code as its number. The codes are what Electron
 * 44 gave on the dev Mac: a renderer that crashed (process.crash, chrome://crash) 11; one Drashti stopped
 * itself (forcefullyCrashRenderer, reason "killed") 2.
 */

describe('exitText', () => {
  it('gives Windows’ exit codes in hex, as its crash codes are written', () => {
    expect(exitText(-1073741819, 'crashed', 'win32')).toBe('exit code 0xC0000005');
    expect(exitText(3221225477, 'crashed', 'win32')).toBe('exit code 0xC0000005');
    expect(exitText(-1073740791, 'crashed', 'win32')).toBe('exit code 0xC0000409');
    expect(exitText(2, 'killed', 'win32')).toBe('exit code 0x00000002');
  });

  it('gives a Mac’s crash by its signal, and any other code as its number', () => {
    expect(exitText(11, 'crashed', 'darwin')).toBe('signal 11: SIGSEGV');
    expect(exitText(5, 'crashed', 'darwin')).toBe('signal 5: SIGTRAP');
    expect(exitText(10, 'crashed', 'darwin')).toBe('signal 10: SIGBUS');
    expect(exitText(9, 'oom', 'darwin')).toBe('signal 9: SIGKILL');
    expect(exitText(2, 'killed', 'darwin')).toBe('exit code 2');
    expect(exitText(1, 'abnormal-exit', 'darwin')).toBe('exit code 1');
    expect(exitText(99, 'crashed', 'darwin')).toBe('exit code 99');
    expect(exitText(7, 'crashed', 'linux')).toBe('signal 7: SIGBUS');
  });

  it('gives nothing when there is no code', () => {
    expect(exitText(undefined, 'crashed', 'darwin')).toBeNull();
    expect(exitText(Number.NaN, 'crashed', 'win32')).toBeNull();
  });
});
