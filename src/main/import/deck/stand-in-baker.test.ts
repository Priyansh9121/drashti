import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ffmpegHere, testFfmpeg } from '../../testing/ffmpeg-here';
import type { MoviePlan } from './plan';
import { standInMovie } from './stand-in-baker';

/*
 * The stand-in's movie (tests only, Session 54, C2): FFmpeg takes its frames more slowly than they are drawn, so a
 * frame bigger than the pipe holds waits for it to drain (or close) before the next is drawn. Each wait used to leave
 * its listener for the close behind (Session 58, h-flaky): eleven waits on one movie made Node warn of a leak
 * ("MaxListenersExceededWarning: 11 close listeners added to [Socket]"), ten times in each deck-import.test.ts run.
 */

const ffmpeg = testFfmpeg({ linux: true });

/** One still slide, a second long: 30 frames of 320 × 180, each bigger than the pipe takes before it waits. */
const PLAN: MoviePlan = {
  baker: 'stand-in',
  settleMs: 0,
  slides: [
    {
      index: 0,
      transitionName: '',
      transitionMs: 0,
      groups: [],
      steps: [{ byClick: false, startMs: 0, endMs: 0, holdMs: null, still: true }],
      advanceMs: 1000,
      endlessUntilMs: null,
    },
  ],
};

describe.skipIf(!ffmpegHere(ffmpeg))('the stand-in movie', () => {
  it('waits for FFmpeg to take each frame, leaving nothing listening behind each wait', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-stand-in-'));
    const warnings: Error[] = [];
    const heard = (warning: Error) => {
      warnings.push(warning);
    };
    process.on('warning', heard);
    try {
      const movie = join(dir, 'movie.mp4');
      await standInMovie(ffmpeg, PLAN, movie);
      // Node tells a warning on the event loop's next turn.
      await new Promise((resolve) => setImmediate(resolve));
      expect(statSync(movie).size).toBeGreaterThan(0);
      expect(warnings.filter((w) => w.name === 'MaxListenersExceededWarning').map((w) => w.message)).toEqual(
        [],
      );
    } finally {
      process.off('warning', heard);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
