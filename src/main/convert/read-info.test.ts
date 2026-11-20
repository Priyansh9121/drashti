import type * as ChildProcesses from 'node:child_process';
import { type ChildProcess, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ffmpegHere, testFfmpeg } from '../testing/ffmpeg-here';
import { readInfo } from './read-info';

/*
 * Reading what a file holds (read-info.ts) on a busy computer (x58): every FFmpeg started here tells of its exit
 * before anything it wrote has been read (testing/words-after-exit.ts), as the unit suite under load on this Mac did
 * (20 Nov: deck-import.test.ts read a 2.4 s clip as no length). Whatever FFmpeg said is read whole all the same.
 * A video made by FFmpeg here; nothing real.
 */

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcesses>();
  const { wordsAfterExit } = await import('../testing/words-after-exit');
  const spawn = ((...args: unknown[]) =>
    wordsAfterExit((actual.spawn as (...a: unknown[]) => ChildProcess)(...args))) as typeof actual.spawn;
  return { ...actual, spawn, default: { ...actual, spawn } };
});

const ffmpeg = testFfmpeg({ linux: true });

describe.skipIf(!ffmpegHere(ffmpeg))('what FFmpeg says a file holds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-read-info-'));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it('is read whole even when FFmpeg’s exit is told before its words are read (x58: a busy computer)', async () => {
    const video = join(dir, 'Placeholder two seconds.mp4');
    const made = spawnSync(ffmpeg, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=320x180:r=25',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      video,
    ]);
    expect(made.status, made.stderr.toString()).toBe(0);
    const info = await readInfo(ffmpeg, video);
    expect(info.timedOut).toBeUndefined();
    expect(info.durationMs).toBe(2000);
    expect(info.video).toMatchObject({ codec: 'h264', width: 320, height: 180, still: false });
    expect(info.audio).toBeNull();
  });
});
