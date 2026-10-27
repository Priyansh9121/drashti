import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { settledMovie } from './bake';

/*
 * Waiting for PowerPoint's movie (Session 54, C review): its `save as movie` answers at once and writes the file
 * meanwhile, so a movie that never appears, or stops growing before it reads as a movie, is given up on, never
 * waited for until the long time limit. (FFmpeg is not needed: one that is not there reads nothing.)
 */

const dir = mkdtempSync(join(tmpdir(), 'drashti-movie-wait-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
const noFfmpeg = join(dir, 'no-ffmpeg-here');

describe('waiting for PowerPoint’s movie', () => {
  it('gives up when the movie never appears', async () => {
    const started = Date.now();
    const r = await settledMovie(noFfmpeg, join(dir, 'never.mov'), 5000, {
      limitMs: 60_000,
      appearMs: 600,
      stallMs: 60_000,
    });
    expect(r).toBe('never');
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('gives up when the movie stops growing and never reads as a movie', async () => {
    const file = join(dir, 'stalled.mov');
    writeFileSync(file, Buffer.alloc(1000));
    const grow = setInterval(() => {
      appendFileSync(file, Buffer.alloc(10));
    }, 200);
    setTimeout(() => {
      clearInterval(grow);
    }, 1000);
    const started = Date.now();
    const r = await settledMovie(noFfmpeg, file, 5000, { limitMs: 60_000, appearMs: 60_000, stallMs: 1500 });
    expect(r).toBe('stalled');
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it('stops when it is told to', async () => {
    const stop = new AbortController();
    setTimeout(() => {
      stop.abort();
    }, 300);
    expect(
      await settledMovie(noFfmpeg, join(dir, 'never again.mov'), 5000, {
        limitMs: 60_000,
        signal: stop.signal,
      }),
    ).toBe('stopped');
  });
});
