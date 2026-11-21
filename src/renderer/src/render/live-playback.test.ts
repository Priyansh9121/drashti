import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLivePlayback } from './live-playback';

/*
 * A stream link's player on a page (alpha.20, the playback set's slice 8): joined where the main process says, it plays
 * at normal speed from its moment by the engine's time. Chromium's player for a live stream fails as it begins (code 4,
 * "source not supported") when it was held paused for a while after it loaded without ever playing (CI
 * x54-1120-223559-2185), so a player always plays first and is held, paused, only once it has played a frame or two.
 * A stand-in element on the test's clock (fake timers drive Date.now and the timers alike): it loads after `loadMs`,
 * its time starting at `startsAt` (a live player starts where the stream had got to as it loaded: one that loads
 * slowly starts later in it than the segment it joined, CI's Mac), and fails as Chromium's does when first played more
 * than a second after it loaded.
 */

const LINK = '00000000-0000-4000-8000-000000000001';

class FakeLive extends EventTarget {
  muted = false;
  autoplay = true;
  preload = 'none';
  readonly dataset: Record<string, string> = {};
  readyState = 0;
  paused = true;
  error: { code: number; message: string } | null = null;
  src = '';
  /** How many times it began to play. */
  played = 0;
  private base: number;
  private since = 0;
  private running = false;
  private loadedAt: number | null = null;

  constructor(
    private readonly startsAt: number,
    private readonly loadMs: number,
  ) {
    super();
    this.base = startsAt;
  }

  get currentTime(): number {
    return this.running ? this.base + (Date.now() - this.since) / 1000 : this.base;
  }

  load(): void {
    if (this.src === '') return;
    setTimeout(() => {
      this.readyState = 4;
      this.base = this.startsAt;
      this.loadedAt = Date.now();
      this.dispatchEvent(new Event('loadeddata'));
    }, this.loadMs);
  }

  play(): Promise<void> {
    if (this.error) return Promise.resolve();
    if (this.played === 0 && this.loadedAt !== null && Date.now() - this.loadedAt > 1000) {
      this.error = { code: 4, message: 'held paused before it ever played' };
      this.dispatchEvent(new Event('error'));
      return Promise.resolve();
    }
    if (!this.running) {
      this.played++;
      this.since = Date.now();
      this.running = true;
      this.paused = false;
      this.dispatchEvent(new Event('playing'));
    }
    return Promise.resolve();
  }

  pause(): void {
    if (this.running) {
      this.base = this.currentTime;
      this.running = false;
    }
    if (!this.paused) {
      this.paused = true;
      this.dispatchEvent(new Event('pause'));
    }
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }
}

describe('a stream link’s player on a page', () => {
  let joinAt: { segment: number; startAt: number };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-11-21T01:00:00Z'));
    vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2, HAVE_FUTURE_DATA: 3 });
    vi.stubGlobal('drashti', { liveLink: { join: () => Promise.resolve(joinAt) } });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loaded after its moment and ahead of it (it started later in the stream), it plays at once and is held, paused, only once it has played; then it plays on in step (CI x54-1121-004746-1596: the hall’s sound silent on the Mac)', async () => {
    joinAt = { segment: 5, startAt: Date.now() + 500 };
    const el = new FakeLive(2.3, 1500);
    const failed = vi.fn();
    const rejoin = vi.fn();
    const stop = startLivePlayback(el as unknown as HTMLMediaElement, {
      linkId: LINK,
      audible: true,
      onError: failed,
      onBehind: rejoin,
    });
    try {
      await vi.advanceTimersByTimeAsync(1600);
      // Loaded 1 s after its moment, 1.3 s ahead of it: it played at once, and is held there.
      expect(el.played).toBe(1);
      await vi.advanceTimersByTimeAsync(300);
      expect(el.paused).toBe(true);
      // Its time comes: it plays on, in step, and never failed.
      await vi.advanceTimersByTimeAsync(2000);
      expect(failed).not.toHaveBeenCalled();
      expect(rejoin).not.toHaveBeenCalled();
      expect(el.error).toBeNull();
      expect(el.paused).toBe(false);
      const expected = (Date.now() - joinAt.startAt) / 1000;
      expect(Math.abs(el.currentTime - expected)).toBeLessThan(0.2);
    } finally {
      stop();
    }
  });

  it('rejoins when a held sound timeline jumps ahead instead of holding that native HLS jump forever', async () => {
    joinAt = { segment: 5, startAt: Date.now() + 2500 };
    const el = new FakeLive(0, 500);
    const pause = el.pause.bind(el);
    let jumped = false;
    el.pause = () => {
      const from = el.currentTime;
      pause();
      if (jumped) return;
      jumped = true;
      const at = Date.now();
      Object.defineProperty(el, 'currentTime', {
        get: () => from + 2 + (Date.now() - at) / 1000,
      });
    };
    const rejoin = vi.fn();
    const stop = startLivePlayback(el as unknown as HTMLMediaElement, {
      linkId: LINK,
      audible: true,
      onBehind: rejoin,
    });
    try {
      await vi.advanceTimersByTimeAsync(1000);
      expect(jumped).toBe(true);
      expect(el.paused).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(rejoin).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it('rejoins when resuming a held sound jumps its native HLS timeline ahead again', async () => {
    joinAt = { segment: 5, startAt: Date.now() + 2500 };
    const el = new FakeLive(0, 500);
    const play = el.play.bind(el);
    let jumped = false;
    el.play = () => {
      const before = el.played;
      const result = play();
      if (before === 1 && el.played === 2) {
        const from = el.currentTime;
        const at = Date.now();
        jumped = true;
        Object.defineProperty(el, 'currentTime', {
          get: () => from + 2 + (Date.now() - at) / 1000,
        });
      }
      return result;
    };
    const rejoin = vi.fn();
    const stop = startLivePlayback(el as unknown as HTMLMediaElement, {
      linkId: LINK,
      audible: true,
      onBehind: rejoin,
    });
    try {
      await vi.advanceTimersByTimeAsync(4000);
      expect(jumped).toBe(true);
      expect(el.played).toBe(2);
      expect(rejoin).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it('a recovering picture loads at its joined moment and plays as data arrives, without another early hold', async () => {
    joinAt = { segment: 5, startAt: Date.now() + 2500 };
    const el = new FakeLive(0, 100);
    const failed = vi.fn();
    const rejoin = vi.fn();
    const framed = vi.fn();
    const stop = startLivePlayback(el as unknown as HTMLMediaElement, {
      linkId: LINK,
      audible: false,
      joinAtMoment: true,
      onError: failed,
      onBehind: rejoin,
      onFrame: framed,
    });
    try {
      await vi.advanceTimersByTimeAsync(2000);
      expect(el.src).toBe('');
      expect(el.played).toBe(0);
      expect(framed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1500);
      expect(el.played).toBe(1);
      expect(el.paused).toBe(false);
      el.dispatchEvent(new Event('timeupdate'));
      expect(framed).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5000);
      expect(failed).not.toHaveBeenCalled();
      expect(rejoin).not.toHaveBeenCalled();
      expect(el.error).toBeNull();
      expect(el.paused).toBe(false);
    } finally {
      stop();
    }
  });

  it('loaded before its moment, it plays at once, is held on its first frames until its moment, then plays in step', async () => {
    joinAt = { segment: 5, startAt: Date.now() + 2500 };
    const el = new FakeLive(0, 500);
    const failed = vi.fn();
    const stop = startLivePlayback(el as unknown as HTMLMediaElement, {
      linkId: LINK,
      audible: false,
      onError: failed,
    });
    try {
      await vi.advanceTimersByTimeAsync(600);
      expect(el.played).toBe(1);
      await vi.advanceTimersByTimeAsync(400);
      expect(el.paused).toBe(true);
      const held = el.currentTime;
      await vi.advanceTimersByTimeAsync(1000);
      expect(el.currentTime).toBe(held);
      await vi.advanceTimersByTimeAsync(2000);
      expect(failed).not.toHaveBeenCalled();
      expect(el.paused).toBe(false);
      const expected = (Date.now() - joinAt.startAt) / 1000;
      expect(Math.abs(el.currentTime - expected)).toBeLessThan(0.35);
    } finally {
      stop();
    }
  });
});
