import type * as ChildProcesses from 'node:child_process';
import { type ChildProcess, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ffmpegHere, testFfmpeg } from '../../testing/ffmpeg-here';
import { measureMotion } from './cut';

/*
 * Finding a deck movie's steps (cut.ts measureMotion, through its runFfmpeg) on a busy computer (x58): every FFmpeg
 * started here tells of its exit before anything it wrote has been read (testing/words-after-exit.ts), as the unit
 * suite under load on this Mac did (20 Nov). Every frame FFmpeg measured, and the movie's size, rate and length, are
 * read all the same. A movie made by FFmpeg here; nothing real.
 */

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcesses>();
  const { wordsAfterExit } = await import('../../testing/words-after-exit');
  const spawn = ((...args: unknown[]) =>
    wordsAfterExit((actual.spawn as (...a: unknown[]) => ChildProcess)(...args))) as typeof actual.spawn;
  return { ...actual, spawn, default: { ...actual, spawn } };
});

const ffmpeg = testFfmpeg({ linux: true });

describe.skipIf(!ffmpegHere(ffmpeg))('a deck movie’s motion, measured by FFmpeg', () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-cut-words-'));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it('is read whole even when FFmpeg’s exit is told before its words are read (x58: a busy computer)', async () => {
    const movie = join(dir, 'Placeholder movie.mp4');
    const made = spawnSync(ffmpeg, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=320x180:r=30',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      movie,
    ]);
    expect(made.status, made.stderr.toString()).toBe(0);
    const motion = await measureMotion(ffmpeg, movie);
    expect(motion).toMatchObject({ durationMs: 2000, width: 320, height: 180, fps: 30, sound: false });
    // A frame for each of the movie's 60 (the first may have none to differ from), in order, to its end.
    expect(motion.frames.length).toBeGreaterThanOrEqual(59);
    expect(motion.frames.length).toBeLessThanOrEqual(60);
    expect(motion.frames.at(-1)?.t).toBeGreaterThanOrEqual(1933);
    expect(motion.frames.every((f, i) => i === 0 || f.t > (motion.frames[i - 1]?.t ?? 0))).toBe(true);
  });
});
