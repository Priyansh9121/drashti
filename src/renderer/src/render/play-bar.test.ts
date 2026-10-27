import { describe, expect, it } from 'vitest';
import { playBarAt } from './play-bar';

/*
 * A video's play bar on the screens (Session 54): drawn from the engine's state and time alone, so every screen draws
 * the same bar at the same moment, over the part of the file that plays (between its start and end points).
 */

describe('a video’s play bar', () => {
  const clip = { startMs: 10_000, endMs: 70_000 };

  it('is along the part that plays, its time since the start point of that part’s length, playing as it goes', () => {
    expect(playBarAt({ startedAt: 1000, loop: false, clip }, 90, 16_000)).toEqual({
      fraction: 0.25,
      text: '0:15 / 1:00',
      playing: true,
    });
    // The whole file when it has no points.
    expect(playBarAt({ startedAt: 0, loop: false }, 90, 45_000)).toEqual({
      fraction: 0.5,
      text: '0:45 / 1:30',
      playing: true,
    });
  });

  it('goes round with a looping video, holds full at a played-once video’s end with a play mark, and waits paused', () => {
    expect(playBarAt({ startedAt: 0, loop: true, clip }, 90, 75_000)).toMatchObject({
      fraction: 0.25,
      playing: true,
    });
    expect(playBarAt({ startedAt: 0, loop: false, clip }, 90, 99_000)).toEqual({
      fraction: 1,
      text: '1:00 / 1:00',
      playing: false,
    });
    const paused = { at: 5000, toMs: 40_000, paused: true };
    expect(playBarAt({ startedAt: 0, loop: false, clip, seek: paused }, 90, 999_000)).toEqual({
      fraction: 0.5,
      text: '0:30 / 1:00',
      playing: false,
    });
  });

  it('draws nothing until the file says how long it is', () => {
    expect(playBarAt({ startedAt: 0, loop: false }, Number.NaN, 1000)).toBeNull();
    expect(playBarAt({ startedAt: 0, loop: false }, 0, 1000)).toBeNull();
  });
});
