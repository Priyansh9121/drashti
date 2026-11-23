import type * as ChildProcesses from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { run } from './deck-converters';

/*
 * What a program run for a deck answers (deck-converters.ts run(): pgrep, lsappinfo, ps, osascript and open on a Mac,
 * PowerShell on Windows; their callers parse what it printed) on a busy computer (a21, after x58): every program
 * started here tells of its exit before anything it wrote has been read (testing/words-after-exit.ts), as a busy
 * computer may. A Node program stands in for each (Electron run as Node); placeholder words only.
 */

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcesses>();
  const { wordsAfterExit } = await import('../testing/words-after-exit');
  const spawn = ((...args: unknown[]) =>
    wordsAfterExit((actual.spawn as (...a: unknown[]) => ChildProcess)(...args))) as typeof actual.spawn;
  return { ...actual, spawn, default: { ...actual, spawn } };
});

const node = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
/** Leftover programs a test started (stopped at the end, whatever the test did). */
const leftovers: number[] = [];
afterAll(() => {
  for (const pid of leftovers)
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
});

describe('a program run for a deck', () => {
  it('is read whole even when its exit is told before its words are read (a busy computer)', async () => {
    const line = 'Placeholder answer line\n';
    const ran = await run(
      process.execPath,
      [
        '-e',
        `process.stdout.write(${JSON.stringify(line)}.repeat(4000)); process.stderr.write('Placeholder warning\\n');`,
      ],
      30_000,
      undefined,
      node,
    );
    expect(ran).toMatchObject({ code: 0, timedOut: false, aborted: false });
    expect(ran.stdout).toBe(line.repeat(4000));
    expect(ran.stderr).toBe('Placeholder warning\n');
  });

  it('is not held by a program it leaves running with its output (a leftover soffice), and its words are read', async () => {
    // The program starts another that keeps its stdout and stderr open for a minute, says that one's number, and
    // ends: its output never closes while the leftover lives.
    const script = [
      "const { spawn } = require('node:child_process');",
      "const left = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'inherit' });",
      "process.stdout.write('Placeholder leftover ' + String(left.pid) + '\\n');",
      // It ends by itself once that is written (an exit at once could lose what was still being written).
      'left.unref();',
    ].join('\n');
    const started = Date.now();
    const ran = await run(process.execPath, ['-e', script], 30_000, undefined, node);
    const took = Date.now() - started;
    const pid = Number(/Placeholder leftover (\d+)/u.exec(ran.stdout)?.[1] ?? 0);
    if (pid > 0) leftovers.push(pid);
    expect(ran).toMatchObject({ code: 0, timedOut: false, aborted: false });
    expect(pid, `its words: ${JSON.stringify(ran.stdout)}`).toBeGreaterThan(0);
    // Not the leftover's minute, nor run()'s 30 s limit.
    expect(took).toBeLessThan(15_000);
  });
});
