import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackClip, PlaybackSeek } from '../../../shared/media';
import { playbackOffset, SOUND_LIMITS } from '../../../shared/media';
import { startPlayback } from './playback';

/*
 * A file played once with an end point stops there (Session 15): within two
 * frames of it, whatever the quarter-second checks are doing. A file that
 * loops goes round in step, and a sound that starts late is brought into step
 * at once (Sessions 31–36). A stand-in media element plays on the test's clock
 * (fake timers drive Date.now, performance.now and the timers alike).
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

  /**
   * `restart`: its own loop comes round this late (seconds), as a real element's does. `startLate`: it
   * plays this long (ms) after play() is called, as a busy computer's sound device does. `landOff`: each
   * seek in turn lands this far from where it was aimed (seconds, + ahead), as CI's Mac's sometimes do.
   */
  constructor(
    private readonly length: number,
    private readonly lags: { restart?: number; startLate?: number; landOff?: number[] } = {},
  ) {
    super();
  }

  get currentTime(): number {
    if (this.paused || this.seeking) return this.base;
    const at = this.base + (Math.max(0, Date.now() - this.since) / 1000) * this.rate;
    if (!this.loop || at < this.length) return Math.min(this.length, at);
    // Its own loop: back to the start, `restart` late each time round.
    const late = this.lags.restart ?? 0;
    const lap = this.length + late;
    const into = (at - this.length) % lap;
    return into < late ? 0 : into - late;
  }

  set currentTime(value: number) {
    this.base = Math.max(0, Math.min(this.length, value + (this.lags.landOff?.shift() ?? 0)));
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
      this.since = Date.now() + (this.lags.startLate ?? 0);
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

describe('a file that loops, and a sound that starts late', () => {
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

  /** How far it is from where the clock says (seconds, + ahead), a loop's end and start being near. */
  const offset = (v: FakeMedia, startedAt: number, length: number, loop: boolean) =>
    playbackOffset(
      v.currentTime,
      loop ? ((Date.now() - startedAt) / 1000) % length : (Date.now() - startedAt) / 1000,
      length,
      loop,
    );

  it('a looping sound goes round in step each time: by a jump aimed from the clock, not its own loop, which comes round late', () => {
    // A 2 s file whose element's own loop comes round 0.25 s late (a sound, on a Mac: 0.2 to 0.3 s).
    const v = new FakeMedia(2, { restart: 0.25 });
    v.loop = true;
    const startedAt = Date.now();
    const stop = startPlayback(v as unknown as HTMLMediaElement, {
      mediaId: 'loop',
      startedAt,
      audible: true,
      limits: SOUND_LIMITS,
      timing: () => ({ loop: true }),
    });
    runFor(v, 1000);
    // Half a second after each of three times round: within two frames of the clock.
    const seen: number[] = [];
    for (let turn = 0; turn < 3; turn++) {
      runFor(v, 2000);
      seen.push(offset(v, startedAt, 2, true));
    }
    expect(
      seen.every((o) => Math.abs(o) < 2 / 30),
      `offsets after each loop: ${seen.map((o) => o.toFixed(3)).join(' ')}`,
    ).toBe(true);
    stop();
  });

  it('a loop that lands off is aimed again, whatever the landings before it used up', () => {
    // A 2 s sound already 0.5 s in: its first landing and the two aimed again after it all land 0.2 s ahead,
    // and the loop comes round before the last of them is measured; that loop's landing is 0.2 s ahead too.
    const v = new FakeMedia(2, { landOff: [0.2, 0.2, 0.2, 0.2] });
    v.loop = true;
    const startedAt = Date.now() - 500;
    const stop = startPlayback(v as unknown as HTMLMediaElement, {
      mediaId: 'lands-off',
      startedAt,
      audible: true,
      limits: SOUND_LIMITS,
      timing: () => ({ loop: true }),
    });
    runFor(v, 2600);
    // About 1.3 s after it went round: in step, not left 0.2 s off to come back at 2% a second.
    const off = offset(v, startedAt, 2, true);
    expect(Math.abs(off), `${off.toFixed(3)} s off the clock after the loop`).toBeLessThan(2 / 30);
    stop();
  });

  it('a sound that starts 0.3 s late is in step within a second, not left to catch up at 2% a second', () => {
    const v = new FakeMedia(30, { startLate: 300 });
    const startedAt = Date.now();
    const stop = startPlayback(v as unknown as HTMLMediaElement, {
      mediaId: 'late',
      startedAt,
      audible: true,
      limits: SOUND_LIMITS,
      timing: () => ({ loop: false }),
    });
    runFor(v, 1500);
    const off = offset(v, startedAt, 30, false);
    expect(Math.abs(off), `${off.toFixed(3)} s off the clock`).toBeLessThan(2 / 30);
    stop();
  });
});
