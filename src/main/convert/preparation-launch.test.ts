import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { getPriority, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { preparationLaunch, PRIORITY_FAILURE_EXIT } from './preparation-launch';
const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
it('retains a native Windows executable and argv for its verified setter path', () => {
  const args = ['placeholder path with spaces', "a'b", '0:a:1'];
  expect(preparationLaunch('placeholder ffmpeg.exe', args, 'win32')).toEqual({
    file: 'placeholder ffmpeg.exe',
    args,
    guarded: false,
  });
});
it('verifies low priority before a short process can finish and disappear from its parent', () => {
  const args = ['-e', "process.stdout.write(String(require('node:os').getPriority(0)))"];
  const launch = preparationLaunch(process.execPath, args);
  if (process.platform === 'win32') {
    expect(launch).toEqual({ file: process.execPath, args, guarded: false });
    return;
  }
  expect(launch.guarded).toBe(true);
  const result = spawnSync(launch.file, launch.args, { env });
  expect(result.status, result.stderr.toString()).toBe(0);
  expect(Number(result.stdout.toString())).toBeGreaterThanOrEqual(10);
  expect(() => getPriority(result.pid)).toThrow();
});
it.each(['denied', 'unchanged'])('runs no work when POSIX priority is %s', (reason) => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-priority-launch-'));
  cleanup.push(dir);
  const marker = join(dir, 'work.txt');
  const args = ['-e', "require('node:fs').writeFileSync(process.argv[1],'Placeholder work')", marker];
  if (process.platform === 'win32') {
    expect(preparationLaunch(process.execPath, args, 'win32').guarded).toBe(false);
    return;
  }
  const inspect = join(dir, 'inspect.sh'),
    lower = join(dir, 'lower.sh');
  writeFileSync(inspect, '#!/bin/sh\nprintf "0\\n"\n');
  writeFileSync(lower, `#!/bin/sh\nexit ${reason === 'denied' ? '1' : '0'}\n`);
  chmodSync(inspect, 0o755);
  chmodSync(lower, 0o755);
  const launch = preparationLaunch(process.execPath, args, process.platform, {
    inspect,
    lower,
    assess: '/usr/bin/awk',
  });
  const result = spawnSync(launch.file, launch.args, { env });
  expect(result.status, result.stderr.toString()).toBe(PRIORITY_FAILURE_EXIT);
  expect(existsSync(marker)).toBe(false);
});
