import { describe, expect, it } from 'vitest';
import { parseMarkerTime, markerTime } from './markers';
import {
  playbackAtMs,
  playbackBounds,
  playbackLeftMs,
  playbackOffset,
  playbackPosition,
  playbackSpanMs,
} from './media';

/* Where a file is on the shared clock, with start and end points and jumps (Session 14). */

describe('playback position', () => {
  it('plays the whole file, looping or holding at its end', () => {
    expect(playbackPosition({ startedAt: 0, loop: false }, 10, 4000)).toBe(4);
    expect(playbackPosition({ startedAt: 0, loop: false }, 10, 14_000)).toBe(10);
    expect(playbackPosition({ startedAt: 0, loop: true }, 10, 14_000)).toBe(4);
  });

  it('loops between its start and end points, and holds at the end point', () => {
    const clip = { startMs: 2000, endMs: 6000 };
    expect(playbackBounds(clip, 10)).toEqual({ start: 2, end: 6 });
    expect(playbackPosition({ startedAt: 0, loop: true, clip }, 10, 1000)).toBe(3);
    expect(playbackPosition({ startedAt: 0, loop: true, clip }, 10, 5000)).toBe(3);
    expect(playbackPosition({ startedAt: 0, loop: false, clip }, 10, 9000)).toBe(6);
    // An end point past the file's end is the file's end.
    expect(playbackBounds({ startMs: 0, endMs: 99_000 }, 10)).toEqual({ start: 0, end: 10 });
  });

  it('goes on from a jump, inside the points', () => {
    const clip = { startMs: 2000, endMs: 6000 };
    const seek = { at: 10_000, toMs: 5000 };
    expect(playbackPosition({ startedAt: 0, loop: true, clip, seek }, 10, 10_500)).toBe(5.5);
    expect(playbackPosition({ startedAt: 0, loop: true, clip, seek }, 10, 12_000)).toBe(3);
    expect(playbackPosition({ startedAt: 0, loop: false, seek: { at: 0, toMs: 99_000 } }, 10, 0)).toBe(10);
  });

  it('measures drift across a loop by the loop’s own length', () => {
    expect(playbackOffset(5.9, 2.1, 4, true)).toBeCloseTo(-0.2, 5);
    expect(playbackOffset(5.9, 2.1, 10, false)).toBeCloseTo(3.8, 5);
  });

  it('says where a file is in whole milliseconds, as every screen has it, and where a paused track waits (Session 50)', () => {
    const clip = { startMs: 2000, endMs: 6000 };
    expect(playbackSpanMs(clip, 10_000)).toEqual({ start: 2000, end: 6000 });
    expect(playbackSpanMs(undefined, 10_000)).toEqual({ start: 0, end: 10_000 });
    expect(playbackSpanMs({ startMs: 0, endMs: 99_000 }, 10_000)).toEqual({ start: 0, end: 10_000 });
    // The same places as playbackPosition, in ms: playing on, held at the end, going round, after a jump.
    for (const [clock, now] of [
      [{ startedAt: 0, loop: false }, 4000],
      [{ startedAt: 0, loop: false }, 14_000],
      [{ startedAt: 0, loop: true }, 14_000],
      [{ startedAt: 0, loop: true, clip }, 5000],
      [{ startedAt: 0, loop: false, clip }, 9000],
      [{ startedAt: 0, loop: true, clip, seek: { at: 10_000, toMs: 5000 } }, 12_000],
    ] as const)
      expect(playbackAtMs(clock, 10_000, now)).toBe(playbackPosition(clock, 10, now) * 1000);
    // Paused: played this far since its start point, whatever the time.
    expect(playbackAtMs({ startedAt: 0, loop: false, clip, pausedAtMs: 1500 }, 10_000, 99_000)).toBe(3500);
    expect(playbackAtMs({ startedAt: 0, loop: false, clip, pausedAtMs: 9000 }, 10_000, 0)).toBe(6000);
    // What is left: to the end point, or to the end of this time round.
    expect(playbackLeftMs({ startedAt: 0, loop: false, clip }, 10_000, 1000)).toBe(3000);
    expect(playbackLeftMs({ startedAt: 0, loop: true }, 10_000, 14_000)).toBe(6000);
    expect(playbackLeftMs({ startedAt: 0, loop: false, seek: { at: 1000, toMs: 8000 } }, 10_000, 2000)).toBe(
      1000,
    );
    expect(playbackLeftMs({ startedAt: 0, loop: false }, 10_000, 99_000)).toBe(0);
  });

  it('waits where a pause put it, whatever the time, inside the points; played on, it goes on from there (Session 54)', () => {
    const clip = { startMs: 2000, endMs: 6000 };
    const paused = { at: 10_000, toMs: 5000, paused: true };
    for (const loop of [false, true]) {
      expect(playbackPosition({ startedAt: 0, loop, clip, seek: paused }, 10, 10_000)).toBe(5);
      expect(playbackPosition({ startedAt: 0, loop, clip, seek: paused }, 10, 99_000)).toBe(5);
      expect(playbackAtMs({ startedAt: 0, loop, clip, seek: paused }, 10_000, 99_000)).toBe(5000);
      expect(playbackLeftMs({ startedAt: 0, loop, clip, seek: paused }, 10_000, 99_000)).toBe(1000);
    }
    // Paused past its end point: at the end point (or, going round, its start), never past it.
    const late = { at: 10_000, toMs: 9000, paused: true };
    expect(playbackPosition({ startedAt: 0, loop: false, clip, seek: late }, 10, 50_000)).toBe(6);
    expect(playbackAtMs({ startedAt: 0, loop: true, clip, seek: late }, 10_000, 50_000)).toBe(2000);
    // Played on: a new jump from where it waited.
    const played = { at: 20_000, toMs: 5000 };
    expect(playbackPosition({ startedAt: 0, loop: true, clip, seek: played }, 10, 20_500)).toBe(5.5);
    expect(playbackAtMs({ startedAt: 0, loop: false, clip, seek: played }, 10_000, 30_000)).toBe(6000);
  });

  it('writes and reads marker times', () => {
    expect(markerTime(65_300)).toBe('1:05.3');
    expect(parseMarkerTime('1:05.3')).toBe(65_300);
    expect(parseMarkerTime('65.3')).toBe(65_300);
    expect(parseMarkerTime('abc')).toBeNull();
  });
});
