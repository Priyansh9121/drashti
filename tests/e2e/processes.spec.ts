import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { type Proc, stillRunning, stillRunningIn, under, underIn } from './processes';

/*
 * How the quit tests know Drashti's processes (processes.ts). Windows keeps a process's parent number after the
 * parent has gone, and gives a gone process's number to another within seconds: alpha.15's gate (5 Nov 2026) found
 * three processes "left" 15 s after a clean quit in quit.spec.ts:249, in a run of 850 tests on CI's Windows, which
 * twelve runs of quit.spec.ts on their own never showed. A process is known by its number and when it started.
 */

const proc = (pid: number, ppid: number, name: string, started: number): Proc => ({
  pid,
  ppid,
  name,
  started,
});

test('a process whose parent number is now one of Drashti’s, its own parent long gone, is not under Drashti', () => {
  const all = [
    proc(100, 1, 'electron.exe', 10_000),
    proc(104, 100, 'electron.exe', 10_200),
    proc(108, 104, 'ffmpeg.exe', 11_000),
    // Started by an earlier process 100, gone long before this Drashti had its number, and its own child.
    proc(200, 100, 'other.exe', 5_000),
    proc(204, 200, 'other-child.exe', 5_100),
  ];
  expect(underIn(all, 100).map((p) => p.pid)).toEqual([104, 108]);
});

test('a number given to another process after Drashti quit is not a process of Drashti’s left running', () => {
  const listed = [proc(104, 100, 'electron.exe', 10_200)];
  expect(stillRunningIn([proc(104, 7, 'other.exe', 20_000)], listed)).toEqual([]);
  // The same process, still there, is.
  expect(stillRunningIn([proc(104, 100, 'electron.exe', 10_200)], listed)).toEqual(listed);
});

test('this computer’s own processes: a child is under the process that started it, with its start, until it ends', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' });
  try {
    const pid = child.pid ?? 0;
    await expect.poll(() => under(process.pid).some((p) => p.pid === pid)).toBe(true);
    const listed = under(process.pid).filter((p) => p.pid === pid);
    expect(listed).toHaveLength(1);
    // Its start: a real moment, within a minute of now.
    expect(Math.abs((listed[0]?.started ?? 0) - Date.now())).toBeLessThan(60_000);
    expect(stillRunning(listed)).toEqual(listed);
    child.kill();
    await expect.poll(() => stillRunning(listed), { timeout: 15_000 }).toEqual([]);
  } finally {
    child.kill();
  }
});
