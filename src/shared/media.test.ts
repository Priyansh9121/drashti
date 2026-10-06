import { describe, expect, it } from 'vitest';
import { parseMarkerTime, markerTime } from './markers';
import { playbackBounds, playbackOffset, playbackPosition } from './media';

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

  it('writes and reads marker times', () => {
    expect(markerTime(65_300)).toBe('1:05.3');
    expect(parseMarkerTime('1:05.3')).toBe(65_300);
    expect(parseMarkerTime('65.3')).toBe(65_300);
    expect(parseMarkerTime('abc')).toBeNull();
  });
});
