import { mkdtempSync } from 'node:fs';
import { constants, getPriority, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runYtDlp, type YtDlpLaunch } from './youtube-run';

/*
 * The priority yt-dlp runs at (Session 59): the lowest, so the show always comes first, unless a launch says
 * another, as only tests do (on CI's busy Windows the lowest starved the fake). A stand-in that waits until it is
 * stopped (Electron as Node); nothing of yt-dlp's own.
 */

const env = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
);

const waiting = (priority?: number): YtDlpLaunch => ({
  command: process.execPath,
  prefix: ['-e', 'setInterval(() => undefined, 1000)'],
  env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
  deno: 'deno',
  ffmpeg: 'ffmpeg',
  ...(priority === undefined ? {} : { priority }),
});

describe('yt-dlp’s priority (Session 59)', () => {
  it('is the lowest, below the show, unless the launch says another (as only tests do)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'drashti-yt-run-'));
    const lowest = runYtDlp(waiting(), [], cwd, () => undefined);
    const normal = runYtDlp(waiting(constants.priority.PRIORITY_NORMAL), [], cwd, () => undefined);
    try {
      expect(getPriority(lowest.pid ?? -1)).toBe(constants.priority.PRIORITY_LOW);
      expect(getPriority(normal.pid ?? -1)).toBe(constants.priority.PRIORITY_NORMAL);
    } finally {
      lowest.stop();
      normal.stop();
      await Promise.all([lowest.done, normal.done]);
    }
  });
});
