import { describe, expect, it } from 'vitest';
import {
  cannotStartInTimeNotice,
  FIRST_FRAME_MS,
  SLOW_START_MS,
  type StartSample,
  startVerdict,
  startWatch,
  startWatched,
} from './no-picture';

/*
 * Slow is not "cannot play" (Q60-51, the owner's "Yes, A"): a video whose first frame has not come is said to be
 * unplayable only after FIRST_FRAME_MS (10 s) with no progress at all; one still loading or decoding gets up to
 * SLOW_START_MS (30 s) from going up, and is then said not to have started in time, never "damaged".
 */

const sample = (at: number, loadedMs: number, more: Partial<StartSample> = {}): StartSample => ({
  at,
  loadedMs,
  readyState: 1,
  decoded: 0,
  progressEvents: 0,
  served: 0,
  ...more,
});

describe('a video’s start, as a page watches it', () => {
  it('a video loading steadily is never stalled; with no first frame by 30 s it could not start in time', () => {
    let w = startWatch(0);
    for (let at = 0; at <= 29_000; at += 1000) {
      w = startWatched(w, sample(at, at / 10));
      expect(startVerdict(w, at), `at ${String(at)} ms`).toBe('wait');
    }
    w = startWatched(w, sample(SLOW_START_MS, 3000));
    expect(startVerdict(w, SLOW_START_MS)).toBe('slow');
  });

  it('one with no progress at all is stalled after 10 s, as before; any progress starts that count again', () => {
    let w = startWatch(0);
    w = startWatched(w, sample(0, 0));
    w = startWatched(w, sample(5000, 0));
    expect(startVerdict(w, 9999)).toBe('wait');
    expect(startVerdict(w, FIRST_FRAME_MS)).toBe('stalled');
    // Decoding (or a step in readiness, or the element's own 'progress') is progress too.
    for (const more of [{ decoded: 1 }, { readyState: 2 }, { progressEvents: 1 }]) {
      let v = startWatched(startWatch(0), sample(0, 0));
      v = startWatched(v, sample(8000, 0, more));
      expect(startVerdict(v, 17_999), JSON.stringify(more)).toBe('wait');
      expect(startVerdict(v, 18_000), JSON.stringify(more)).toBe('stalled');
    }
  });

  it('bytes Main still sends are progress too: on CI’s Mac a slow file told the page nothing else (x47-1120-205802-554)', () => {
    let w = startWatched(startWatch(0), sample(0, 0));
    for (let at = 1000; at <= 29_000; at += 1000) {
      w = startWatched(w, sample(at, 0, { served: at * 100 }));
      expect(startVerdict(w, at), `at ${String(at)} ms`).toBe('wait');
    }
    expect(
      startVerdict(startWatched(w, sample(SLOW_START_MS, 0, { served: 3_000_000 })), SLOW_START_MS),
    ).toBe('slow');
  });

  it('says a slow start in words: not in time, never damaged', () => {
    const words = cannotStartInTimeNotice('Placeholder katha.mp4', 'the screen “Main Hall”');
    expect(words).toBe(
      '“Placeholder katha.mp4” could not start in time on the screen “Main Hall”, so it came off the screens with its sound: this computer was too busy to start it in 30 seconds. Put it up again when less is playing.',
    );
    expect(words).not.toContain('damaged');
  });
});
