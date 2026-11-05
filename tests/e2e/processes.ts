import { spawnSync } from 'node:child_process';

/*
 * This computer's processes, for the tests that check nothing of Drashti's is left running (quit.spec.ts). A process
 * is known by its number and when it started: Windows keeps a process's parent number after the parent has gone, and
 * gives a gone process's number to another within seconds (alpha.15's gate, 5 Nov 2026; processes.spec.ts).
 */

/** A process: its number, its parent's, its name, and when it started (ms; NaN when the system did not say). */
export interface Proc {
  pid: number;
  ppid: number;
  name: string;
  started: number;
}

/** Every process with its parent, name and start, from the system. */
export function processes(): Proc[] {
  if (process.platform === 'win32') {
    // Windows PowerShell, without the PowerShell 7 module path CI's steps run under.
    const env = { ...process.env };
    delete env['PSModulePath'];
    const out = spawnSync(
      `${process.env['SystemRoot'] ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { $t = if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { 0 }; "$($_.ProcessId) $($_.ParentProcessId) $t $($_.Name)" }',
      ],
      { encoding: 'utf8', env },
    ).stdout;
    return out
      .split(/\r?\n/u)
      .map((l) => l.trim().split(' '))
      .filter((p) => p.length >= 4)
      .map(([pid, ppid, started, ...name]) => ({
        pid: Number(pid),
        ppid: Number(ppid),
        name: name.join(' '),
        started: Number(started) || Number.NaN,
      }));
  }
  // Each start in the C locale's words, which Date.parse reads ("Thu Nov  5 21:27:36 2026", to the second).
  return spawnSync('ps', ['-axo', 'pid=,ppid=,lstart=,comm='], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
  })
    .stdout.split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(\S+ \S+ +\d+ [\d:]+ \d+)\s+(.*)$/u.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      name: m[4] ?? '',
      started: Date.parse(m[3] ?? ''),
    }));
}

/**
 * Those of `all` under `root` (its helpers, workers and what they started), each started no earlier than its parent:
 * one started before is the child of a process gone before its parent number was given to this one.
 */
export function underIn(all: Proc[], root: number): Proc[] {
  // Each process under it, with when it started (a start the system did not say compares as nothing).
  const mine = new Map([[root, all.find((p) => p.pid === root)?.started ?? Number.NaN]]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of all) {
      const parent = mine.get(p.ppid);
      if (parent === undefined || mine.has(p.pid) || p.started < parent) continue;
      mine.set(p.pid, p.started);
      grew = true;
    }
  }
  return all.filter((p) => mine.has(p.pid) && p.pid !== root);
}

/** Every process under this one, from the system. */
export function under(root: number): Proc[] {
  return underIn(processes(), root);
}

/** Whether a process has this number now. */
export const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Those of `listed` still running, as `now` lists them: the same number, started at the same moment. */
export function stillRunningIn(now: Proc[], listed: Proc[]): Proc[] {
  return listed.filter((p) =>
    now.some((q) => q.pid === p.pid && (Number.isNaN(p.started) || q.started === p.started)),
  );
}

/** Those of `listed` still running (by number alone if the system lists nothing: never fewer than are there). */
export function stillRunning(listed: Proc[]): Proc[] {
  const left = listed.filter((p) => alive(p.pid));
  if (left.length === 0) return [];
  const now = processes();
  return now.length === 0 ? left : stillRunningIn(now, left);
}
