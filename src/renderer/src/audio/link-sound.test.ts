import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLinkSound } from './link-sound';

/*
 * A stream link's sound in the hall (alpha.20, the playback set's slice 8): if its player gives up (Chromium's player for
 * a live stream can fail as it begins, code 4, and has nothing to play after), it joins again a moment later, as a
 * screen's picture does (render/LinkView.tsx), rather than leaving the hall silent while the link plays on. A stand-in
 * element on the test's clock: its first load fails as it is played, as Chromium's did on CI's Mac
 * (x54-1121-004746-1596: the hall's sound silent for 20 s while the pictures moved); a load after that plays.
 */

const LINK = '00000000-0000-4000-8000-000000000001';

class FailsOnce extends EventTarget {
  muted = false;
  autoplay = true;
  preload = 'none';
  readonly dataset: Record<string, string> = {};
  readyState = 0;
  paused = true;
  error: { code: number; message: string } | null = null;
  src = '';
  loads = 0;
  private since: number | null = null;

  /** Its time: 0 as it loads, moving on while it plays. */
  get currentTime(): number {
    return this.since === null ? 0 : (Date.now() - this.since) / 1000;
  }

  load(): void {
    this.error = null;
    this.readyState = 0;
    this.paused = true;
    this.since = null;
    if (this.src === '') return;
    this.loads++;
    setTimeout(() => {
      this.readyState = 4;
      this.dispatchEvent(new Event('loadeddata'));
    }, 100);
  }

  play(): Promise<void> {
    if (this.error) return Promise.resolve();
    if (this.loads === 1) {
      // It gives up as it begins, and has nothing to play after (its ready state gone).
      this.error = { code: 4, message: 'source not supported' };
      this.readyState = 0;
      this.dispatchEvent(new Event('error'));
      return Promise.resolve();
    }
    if (this.paused) {
      this.paused = false;
      this.since = Date.now();
      this.dispatchEvent(new Event('playing'));
    }
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }
}

describe('a stream link’s sound in the hall', () => {
  let joins = 0;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-11-21T01:00:00Z'));
    vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2, HAVE_FUTURE_DATA: 3 });
    joins = 0;
    vi.stubGlobal('drashti', {
      liveLink: {
        join: () => {
          joins++;
          return Promise.resolve({ segment: 5, startAt: Date.now() + 50 });
        },
      },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('joins again a moment after its player gives up, and plays (CI x54-1121-004746-1596)', async () => {
    const el = new FailsOnce();
    const linked = startLinkSound(el as unknown as HTMLMediaElement, LINK);
    try {
      await vi.advanceTimersByTimeAsync(600);
      expect(el.error?.code).toBe(4);
      expect(joins).toBe(1);
      await vi.advanceTimersByTimeAsync(1500);
      expect(joins).toBe(2);
      expect(el.error).toBeNull();
      expect(el.paused).toBe(false);
      // Playing, it never joins again by itself.
      await vi.advanceTimersByTimeAsync(5000);
      expect(joins).toBe(2);
    } finally {
      linked.stop();
    }
  });

  it('stopped, it never joins again', async () => {
    const el = new FailsOnce();
    const linked = startLinkSound(el as unknown as HTMLMediaElement, LINK);
    await vi.advanceTimersByTimeAsync(600);
    expect(el.error?.code).toBe(4);
    linked.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(joins).toBe(1);
  });
});
