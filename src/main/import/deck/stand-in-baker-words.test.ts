import type * as ChildProcesses from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ExitFirstChild, exitFirstChild } from '../../testing/exit-first-child';
import type { MoviePlan } from './plan';
import { standInMovie } from './stand-in-baker';

/*
 * The stand-in movie (tests only, Session 54, C2) when FFmpeg fails and its exit is told before its last words are
 * read, as a busy computer may (a22-exitreaders, after x58): FFmpeg here is a stand-in that ends that way
 * (testing/exit-first-child.ts). Its reason is in what the stand-in says all the same. Nothing is started or made.
 */

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcesses>();
  return { ...actual, spawn, default: { ...actual, spawn } };
});

/** One still slide, a second long. */
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
const REASON = 'Placeholder: the movie could not be written here';

afterEach(() => {
  spawn.mockReset();
});

describe('the stand-in movie, when FFmpeg’s exit is told before its last words are read', () => {
  it('says why FFmpeg could not make it', async () => {
    const children: ExitFirstChild[] = [];
    spawn.mockImplementation(() => {
      const child = exitFirstChild();
      children.push(child);
      // It takes every frame, then fails at the end, saying why.
      child.stdin.once('finish', () => {
        child.end(1, { stderr: `${REASON}\n` });
      });
      return child;
    });
    await expect(standInMovie('placeholder-ffmpeg', PLAN, 'placeholder.mp4')).rejects.toThrow(
      `The stand-in could not make the movie: ${REASON}`,
    );
    expect(children).toHaveLength(1);
  });
});
