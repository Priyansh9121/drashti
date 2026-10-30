import { describe, expect, it } from 'vitest';
import { FOCUS_ASSIST_SCRIPT, focusFromAssertions, focusFromWnf, readFocus } from './focus';

describe('Do Not Disturb, Focus and Focus assist (Ready?, Session 55, Part 8)', () => {
  it('a Mac: Focus is on while macOS holds an assertion, off with none', () => {
    const on = JSON.stringify({
      data: [
        {
          storeAssertionRecords: [
            { assertionDetails: { assertionDetailsModeIdentifier: 'com.apple.donotdisturb.mode.default' } },
          ],
        },
      ],
    });
    expect(focusFromAssertions(on)).toBe(true);
    expect(focusFromAssertions(JSON.stringify({ data: [{}] }))).toBe(false);
    expect(focusFromAssertions(JSON.stringify({ data: [{ storeAssertionRecords: [] }] }))).toBe(false);
    // Anything else is not known (never a guess).
    expect(focusFromAssertions('not json')).toBeNull();
    expect(focusFromAssertions(JSON.stringify({ something: 'else' }))).toBeNull();
  });

  it('Windows: Focus assist’s state 1 (priority only) or 2 (alarms only) is on, 0 is off, anything else not known', () => {
    expect(focusFromWnf('0\r\n')).toBe(false);
    expect(focusFromWnf('1\r\n')).toBe(true);
    expect(focusFromWnf('2')).toBe(true);
    expect(focusFromWnf('error')).toBeNull();
    expect(focusFromWnf(null)).toBeNull();
    expect(focusFromWnf('7')).toBeNull();
  });

  it('reads the Mac’s file, and says not known when macOS keeps it private (no prompt, no keychain)', async () => {
    const reads: string[] = [];
    const quiet = await readFocus('darwin', {
      home: '/Users/placeholder',
      readFile: (path) => {
        reads.push(path);
        return Promise.resolve(JSON.stringify({ data: [{ storeAssertionRecords: [{}] }] }));
      },
      powershell: () => Promise.reject(new Error('not on a Mac')),
    });
    expect(quiet).toBe(true);
    expect(reads).toEqual(['/Users/placeholder/Library/DoNotDisturb/DB/Assertions.json']);
    const denied = await readFocus('darwin', {
      home: '/Users/placeholder',
      readFile: () => Promise.reject(Object.assign(new Error('Operation not permitted'), { code: 'EPERM' })),
      powershell: () => Promise.reject(new Error('not on a Mac')),
    });
    expect(denied).toBeNull();
  });

  it('asks Windows through PowerShell (off the main thread), and Linux not at all', async () => {
    const scripts: string[] = [];
    const on = await readFocus('win32', {
      home: 'C:\\Users\\placeholder',
      readFile: () => Promise.reject(new Error('not on Windows')),
      powershell: (script) => {
        scripts.push(script);
        return Promise.resolve('2\r\n');
      },
    });
    expect(on).toBe(true);
    expect(scripts).toEqual([FOCUS_ASSIST_SCRIPT]);
    expect(FOCUS_ASSIST_SCRIPT).toMatch(/NtQueryWnfStateData/u);
    expect(
      await readFocus('linux', {
        home: '/home/placeholder',
        readFile: () => Promise.reject(new Error('never')),
        powershell: () => Promise.reject(new Error('never')),
      }),
    ).toBeNull();
  });
});
