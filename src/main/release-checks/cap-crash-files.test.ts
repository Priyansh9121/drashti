import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { capCrashFiles } from '../../../scripts/cap-crash-files.mjs';

/*
 * What a CI run's report carries of its failed tests' crash files (Session 39): the earliest, up to a cap,
 * and a list of the rest by name and size. Only files inside a test's crash-files folder count. Made-up
 * files only.
 */

/** A file of `kb` kilobytes, last written `minute` minutes into a made-up run. */
function file(path: string, kb: number, minute: number): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, Buffer.alloc(kb * 1024));
  const at = new Date(Date.UTC(2026, 9, 19, 6, minute));
  utimesSync(path, at, at);
}

describe('capCrashFiles', () => {
  it('keeps the earliest crash files up to the cap, removes the rest and lists them', () => {
    const root = mkdtempSync(join(tmpdir(), 'drashti-cap-'));
    file(join(root, 'test-a', 'crash-files', 'pending', 'one.dmp'), 600, 1);
    file(join(root, 'test-b', 'crash-files', 'reports', 'two.dmp'), 600, 2);
    file(join(root, 'test-c-retry1', 'crash-files', 'pending', 'three.dmp'), 600, 3);
    // Not crash files: a trace and a screenshot stay whatever the cap.
    file(join(root, 'test-a', 'trace.zip'), 900, 0);
    file(join(root, 'test-b', 'test-failed-1.png'), 900, 0);
    const result = capCrashFiles(root, 1.2);
    expect(result.kept).toBe(2);
    expect(result.leftOut).toEqual([join('test-c-retry1', 'crash-files', 'pending', 'three.dmp')]);
    expect(existsSync(join(root, 'test-a', 'crash-files', 'pending', 'one.dmp'))).toBe(true);
    expect(existsSync(join(root, 'test-b', 'crash-files', 'reports', 'two.dmp'))).toBe(true);
    expect(existsSync(join(root, 'test-c-retry1', 'crash-files', 'pending', 'three.dmp'))).toBe(false);
    expect(existsSync(join(root, 'test-a', 'trace.zip'))).toBe(true);
    expect(existsSync(join(root, 'test-b', 'test-failed-1.png'))).toBe(true);
    const list = readFileSync(join(root, 'crash-files-left-out.txt'), 'utf8');
    expect(list).toContain('Crash files left out of this report: 1 (0.6 MB), past the cap of 1.2 MB.');
    expect(list).toContain(`${join('test-c-retry1', 'crash-files', 'pending', 'three.dmp')} 614400 bytes`);
    expect(result.line).toBe('Crash files in the report: 2 kept (1.2 MB), 1 left out (cap 1.2 MB).');
  });

  it('leaves a report with nothing over the cap as it is, with no list', () => {
    const root = mkdtempSync(join(tmpdir(), 'drashti-cap-'));
    file(join(root, 'test-a', 'crash-files', 'pending', 'one.dmp'), 10, 1);
    expect(capCrashFiles(root, 200).line).toBe(
      'Crash files in the report: 1 kept (0.0 MB), 0 left out (cap 200 MB).',
    );
    expect(existsSync(join(root, 'crash-files-left-out.txt'))).toBe(false);
    expect(capCrashFiles(join(root, 'none'), 200).kept).toBe(0);
  });
});
