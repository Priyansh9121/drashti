import type * as ChildProcesses from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ExitFirstChild, exitFirstChild } from '../../testing/exit-first-child';
import type { MoviePlan } from './plan';
import { standInMovie } from './stand-in-baker';

/*
 * The stand-in movie (tests only, Session 54, C2) when FFmpeg fails and its exit is told before its last words are
 * read, as a busy computer may (a22-exitreaders, after x58): FFmpeg here is a stand-in that ends that way
 * (testing/exit-first-child.ts), its input let go at its exit as Node does. Its reason is in what the stand-in says
 * all the same, whether FFmpeg fails once it has every frame or after its first. Nothing is started or made.
 */

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcesses>();
  return { ...actual, spawn, default: { ...actual, spawn } };
});

/** One still slide, a second long: 30 frames, each bigger than the pipe takes before it waits. */
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
const WORDS = `The stand-in could not make the movie: ${REASON}`;

afterEach(() => {
  spawn.mockReset();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The stand-in's movie, or what it threw, or that it was still waiting after 5 s (it should take milliseconds). */
async function outcome(): Promise<unknown> {
  const made = standInMovie('placeholder-ffmpeg', PLAN, 'placeholder.mp4').then(
    () => 'made',
    (error: unknown) => error,
  );
  return Promise.race([made, sleep(5000).then(() => 'still waiting after 5 s')]);
}

/** An FFmpeg that takes its first frame, then fails: `before` happens first, then its exit (told before its words). */
function failingAfterFirstFrame(before?: (child: ExitFirstChild) => void): ExitFirstChild {
  let frames = 0;
  const child = exitFirstChild({
    taken: () => {
      frames += 1;
      if (frames !== 1) return;
      setImmediate(() => {
        before?.(child);
        child.end(1, { stderr: `${REASON}\n` });
      });
    },
  });
  return child;
}

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
    await expect(standInMovie('placeholder-ffmpeg', PLAN, 'placeholder.mp4')).rejects.toThrow(WORDS);
    expect(children).toHaveLength(1);
  });

  it('stops at once and says why when FFmpeg fails after its first frame (its input gone at its exit)', async () => {
    spawn.mockImplementation(() => failingAfterFirstFrame());
    const result = await outcome();
    expect(result).toBeInstanceOf(Error);
    expect(String(result)).toContain(WORDS);
  });

  it('the same when what is being written fails first (EPIPE, before its exit): nothing is left unhandled', async () => {
    spawn.mockImplementation(() =>
      failingAfterFirstFrame((child) => {
        child.stdin.destroy(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
      }),
    );
    const result = await outcome();
    expect(result).toBeInstanceOf(Error);
    expect(String(result)).toContain(WORDS);
  });
});
