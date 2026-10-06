import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackClip, PlaybackSeek } from '../../../shared/media';
import { startPlayback } from './playback';

/*
 * A file played once with an end point stops there (Session 15): within two
 * frames of it, whatever the quarter-second checks are doing. A stand-in
 * media element plays on the test's clock (fake timers drive Date.now,
 * performance.now and the timers alike).
 */

const FRAME = 1 / 60;

class FakeMedia extends EventTarget {
  duration = NaN;
  paused = true;
  seeking = false;
  readyState = 0;
  loop = false;
  muted = false;
  ended = false;
  private rate = 1;
  /** Where it was at `since` (Date.now()). */
  private base = 0;
  private since = 0;

  constructor(private readonly length: number) {
    super();
  }

  get currentTime(): number {
    if (this.paused || this.seeking) return this.base;
    return Math.min(this.length, this.base + ((Date.now() - this.since) / 1000) * this.rate);
  }

  set currentTime(value: number) {
    this.base = Math.max(0, Math.min(this.length, value));
    this.seeking = true;
    setTimeout(() => {
      this.seeking = false;
      this.since = Date.now();
      this.dispatchEvent(new Event('seeked'));
    }, 5);
  }

  get playbackRate(): number {
    return this.rate;
  }

  set playbackRate(value: number) {
    this.base = this.currentTime;
    this.since = Date.now();
    this.rate = value;
    this.dispatchEvent(new Event('ratechange'));
  }

  set src(_url: string) {
    setTimeout(() => {
      this.duration = this.length;
      this.readyState = 4;
      this.dispatchEvent(new Event('loadedmetadata'));
      this.dispatchEvent(new Event('loadeddata'));
    }, 10);
  }

  play(): Promise<void> {
    if (this.paused) {
      this.since = Date.now();
      this.paused = false;
      setTimeout(() => this.dispatchEvent(new Event('playing')), 0);
    }
    return Promise.resolve();
  }

  pause(): void {
    if (this.paused) return;
    this.base = this.currentTime;
    this.paused = true;
  }

  /** Letting go of the file: nothing to let go of here. */
  load(): void {
    this.readyState = 0;
  }

  removeAttribute(): void {
    this.duration = NaN;
  }
}

/** Run the clock on in 1 ms steps, noting the furthest the file got. */
function runFor(v: FakeMedia, ms: number): number {
  let furthest = 0;
  for (let i = 0; i < ms; i++) {
    vi.advanceTimersByTime(1);
    furthest = Math.max(furthest, v.currentTime);
  }
  return furthest;
}

describe('a file played once to an end point', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
    });
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2 });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const play = (v: FakeMedia, timing: { clip: PlaybackClip; seek?: PlaybackSeek }) =>
    startPlayback(v as unknown as HTMLMediaElement, {
      mediaId: 'clip',
      startedAt: Date.now(),
      timing: () => ({ loop: false, ...timing }),
    });

  it('stops within a frame of its end point, between the checks', () => {
    // 2.137 s falls between two quarter-second checks: the next one would come 0.11 s past it.
    const v = new FakeMedia(6);
    const stop = play(v, { clip: { startMs: 0, endMs: 2137 } });
    const furthest = runFor(v, 3000);
    expect(furthest).toBeLessThanOrEqual(2.137 + 2 * FRAME);
    expect(v.paused).toBe(true);
    expect(Math.abs(v.currentTime - 2.137)).toBeLessThanOrEqual(FRAME);
    stop();
  });

  it('holds there while the clock catches up, and plays again after a jump back', () => {
    const v = new FakeMedia(6);
    const timing: { clip: PlaybackClip; seek?: PlaybackSeek } = { clip: { startMs: 0, endMs: 1630 } };
    const stop = play(v, timing);
    expect(runFor(v, 2500)).toBeLessThanOrEqual(1.63 + 2 * FRAME);
    expect(v.paused).toBe(true);
    // A jump to a marker at 1.0 s: it plays from there and stops at the end point again.
    timing.seek = { at: Date.now(), toMs: 1000 };
    stop.resync();
    runFor(v, 300);
    expect(v.paused).toBe(false);
    expect(v.currentTime).toBeGreaterThan(1.0);
    expect(v.currentTime).toBeLessThan(1.5);
    expect(runFor(v, 1500)).toBeLessThanOrEqual(1.63 + 2 * FRAME);
    expect(v.paused).toBe(true);
    expect(Math.abs(v.currentTime - 1.63)).toBeLessThanOrEqual(FRAME);
    stop();
  });

  it('starts held when it joins after the end point', () => {
    const v = new FakeMedia(6);
    const stop = startPlayback(v as unknown as HTMLMediaElement, {
      mediaId: 'clip',
      startedAt: Date.now() - 4000,
      timing: () => ({ loop: false, clip: { startMs: 0, endMs: 1500 } }),
    });
    expect(runFor(v, 600)).toBeLessThanOrEqual(1.5 + FRAME);
    expect(v.paused).toBe(true);
    expect(Math.abs(v.currentTime - 1.5)).toBeLessThanOrEqual(FRAME);
    stop();
  });
});
