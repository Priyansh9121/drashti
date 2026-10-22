import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RELAUNCH_MARK, RELAUNCH_RESULT, runRelaunchSelfTest } from './relaunch-selftest';
import type { SelfTestResult } from './selftest';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * Both starts of the self-test on a pretend library: the first backs it up (the names it held), changes it,
 * asks for the restore and restarts; then the restore puts back `restoredTo` (the backup's names unless
 * given), and the start after it checks the library and writes its result.
 */
async function bothStarts(
  library: string[],
  restoredTo?: (backup: string[]) => string[],
): Promise<{ backup: string[]; changed: string[]; result: SelfTestResult }> {
  const root = mkdtempSync(join(tmpdir(), 'drashti-relaunch-test-'));
  roots.push(root);
  const userData = join(root, 'data');
  const workDir = join(root, 'work');
  mkdirSync(userData);
  mkdirSync(workDir);
  let names = [...library];
  let backup: string[] = [];
  let restarted = false;
  const ctx = {
    userData,
    workDir,
    names: () => [...names],
    backUp: (into: string) => {
      backup = [...names];
      return Promise.resolve(join(into, 'Placeholder backup'));
    },
    add: (name: string) => {
      names.push(name);
    },
    requestRestore: () => undefined,
    restart: () => {
      restarted = true;
    },
    exit: () => undefined,
  };
  await runRelaunchSelfTest({ ...ctx, restored: { restored: false, code: null, message: null } });
  expect(restarted).toBe(true);
  const changed = [...names];
  // The copy app.relaunch() starts is a new process.
  const mark = join(userData, RELAUNCH_MARK);
  const first = JSON.parse(readFileSync(mark, 'utf8')) as { pid: number; expect: string[] };
  writeFileSync(mark, JSON.stringify({ ...first, pid: process.pid + 1 }));
  names = restoredTo ? restoredTo(backup) : [...backup];
  await runRelaunchSelfTest({
    ...ctx,
    restored: { restored: true, from: 'Placeholder backup', keptIn: 'Before restore', media: false },
  });
  const result = JSON.parse(readFileSync(join(workDir, RELAUNCH_RESULT), 'utf8')) as SelfTestResult;
  return { backup, changed, result };
}

const libraryCheck = (result: SelfTestResult) =>
  result.checks.find((c) => c.name === 'the library is the backup’s');

describe('the restart after a restore, for real (Session 50: a new library has no placeholder presentations)', () => {
  it('puts a placeholder presentation in a new library before the backup, for the restore to bring back', async () => {
    const { backup, changed, result } = await bothStarts([]);
    expect(backup).toEqual(['Placeholder kept in the backup']);
    expect(changed).toEqual(['Placeholder kept in the backup', 'Placeholder added after the backup']);
    expect(result.passed).toBe(true);
    expect(libraryCheck(result)).toMatchObject({ ok: true, detail: '1 presentation' });
  });

  it('fails when the restored library is empty: the backup’s presentation did not come back', async () => {
    const { result } = await bothStarts([], () => []);
    expect(result.passed).toBe(false);
    expect(libraryCheck(result)?.ok).toBe(false);
  });

  it('fails when the change made after the backup is still there', async () => {
    const { result } = await bothStarts([], (backup) => [...backup, 'Placeholder added after the backup']);
    expect(libraryCheck(result)?.ok).toBe(false);
  });

  it('backs a library with presentations up as it is', async () => {
    const { backup, result } = await bothStarts(['Placeholder one', 'Placeholder two']);
    expect(backup).toEqual(['Placeholder one', 'Placeholder two']);
    expect(result.passed).toBe(true);
    expect(libraryCheck(result)).toMatchObject({ ok: true, detail: '2 presentations' });
  });
});
