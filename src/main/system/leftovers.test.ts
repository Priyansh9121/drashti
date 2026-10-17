import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type ChildEntry, Leftovers, parsePs, parseWindows, type ProcessFacts } from './leftovers';

/*
 * Programs left running by a crash (Session 31, ROB-3): only the very one written down is stopped at the
 * next start (the same id, start time and program), never a process that got its id since, never Drashti.
 */

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const FFMPEG = '/Applications/Drashti.app/Contents/Resources/ffmpeg/ffmpeg';

/** A record whose system is a table the test sets: what is running, and what was stopped. */
function setUp(running: Map<number, ProcessFacts>, ownPid = 1) {
  dir = mkdtempSync(join(tmpdir(), 'drashti-leftovers-'));
  const stopped: number[] = [];
  const asked: number[][] = [];
  const said: string[] = [];
  const look = (pids: readonly number[]) => {
    asked.push([...pids]);
    const found = new Map<number, ProcessFacts>();
    for (const p of pids) {
      const f = running.get(p);
      if (f) found.set(p, f);
    }
    return found;
  };
  const leftovers = new Leftovers({
    file: join(dir, 'started-programs.json'),
    facts: (pids) => Promise.resolve(look(pids)),
    factsNow: look,
    stop: (e: ChildEntry) => {
      stopped.push(e.pid);
      running.delete(e.pid);
    },
    alive: (pid) => running.has(pid),
    ownPid,
    log: (_level, message) => said.push(message),
  });
  return { leftovers, stopped, asked, said };
}

describe('programs left running by the last run', () => {
  it('stops the very one written down, says so, and starts the record afresh', async () => {
    const running = new Map([[4704, { startedAt: 1_000, path: FFMPEG }]]);
    const { leftovers, stopped, said } = setUp(running);
    // A Save as MP4's part-file beside where it was to go.
    const part = join(dir, '.0d1b.mp4');
    writeFileSync(part, 'a part written so far');
    await leftovers.started(4704, 'conversion', { partFile: part });
    expect(leftovers.entries()).toEqual([
      { pid: 4704, startedAt: 1_000, path: FFMPEG, what: 'conversion', group: false, partFile: part },
    ]);
    // The next start: still running, the same one.
    expect(leftovers.stopLeft()).toBe(1);
    expect(stopped).toEqual([4704]);
    expect(said).toEqual([
      'Stopped a conversion left running by the last run (process 4704)',
      'Removed a part-file left by the last run',
    ]);
    expect(existsSync(part)).toBe(false);
    expect(leftovers.entries()).toEqual([]);
  });

  it('never stops a process that got the id since (started later, or another program)', async () => {
    const running = new Map([
      [4704, { startedAt: 1_000, path: FFMPEG }],
      [5100, { startedAt: 2_000, path: FFMPEG }],
    ]);
    const { leftovers, stopped, said } = setUp(running);
    await leftovers.started(4704, 'conversion');
    await leftovers.started(5100, 'yt-dlp', { group: true });
    // Both ended; the system gave 4704 to a program started later, and 5100 to another program.
    running.set(4704, { startedAt: 9_000, path: FFMPEG });
    running.set(5100, { startedAt: 2_000, path: '/usr/bin/some-other-program' });
    expect(leftovers.stopLeft()).toBe(0);
    expect(stopped).toEqual([]);
    expect(said).toEqual([]);
    expect(leftovers.entries()).toEqual([]);
  });

  it('never stops Drashti itself, and asks the system nothing when nothing is written down', async () => {
    const running = new Map([
      [77, { startedAt: 5, path: '/Applications/Drashti.app/Contents/MacOS/Drashti' }],
    ]);
    const { leftovers, stopped, asked } = setUp(running, 77);
    expect(leftovers.stopLeft()).toBe(0);
    expect(asked).toEqual([]);
    await leftovers.started(77, 'conversion');
    expect(leftovers.stopLeft()).toBe(0);
    expect(stopped).toEqual([]);
  });

  it('forgets a program once it ends, and never writes one down that ended before the system answered', async () => {
    const running = new Map([[4704, { startedAt: 1_000, path: FFMPEG }]]);
    const { leftovers } = setUp(running);
    await leftovers.started(4704, 'conversion');
    leftovers.forget(4704);
    expect(leftovers.entries()).toEqual([]);
    // Ended while the system was being asked: never written down.
    const late = leftovers.started(4704, 'conversion');
    leftovers.forget(4704);
    await late;
    expect(leftovers.entries()).toEqual([]);
    // Not running at all: nothing written.
    await leftovers.started(999, 'conversion');
    expect(leftovers.entries()).toEqual([]);
  });

  it('reads what macOS’s ps and Windows PowerShell say', () => {
    const ps = parsePs(
      [
        ' 4704 Sat Oct 17 11:17:52 2026     /Users/me/Drashti/vendor/ffmpeg/darwin-arm64/ffmpeg',
        '    1 Fri Oct  9 21:07:44 2026     /sbin/launchd',
        'garbage',
      ].join('\n'),
    );
    expect(ps.get(4704)).toEqual({
      startedAt: new Date(2026, 9, 17, 11, 17, 52).getTime(),
      path: '/Users/me/Drashti/vendor/ffmpeg/darwin-arm64/ffmpeg',
    });
    expect(ps.get(1)?.startedAt).toBe(new Date(2026, 9, 9, 21, 7, 44).getTime());
    expect(ps.size).toBe(2);
    const win = parseWindows(
      '5100|2026-10-17T00:17:52.1234560Z|C:\\Program Files\\Drashti\\resources\\ffmpeg\\ffmpeg.exe\r\nbad line\r\n',
    );
    expect(win.get(5100)).toEqual({
      startedAt: Date.parse('2026-10-17T00:17:52.123Z'),
      path: 'C:\\Program Files\\Drashti\\resources\\ffmpeg\\ffmpeg.exe',
    });
    expect(win.size).toBe(1);
  });
});
