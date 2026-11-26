import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESENT_WAIT_MS, untilPresented } from './present-wait';

/*
 * A background video drawn over the picture before (another background, the Wallpaper, black-out's cover) takes it
 * away only once a frame of it has been presented: never with nothing of its own to show (the owner's "never black").
 * CI's Mac (a22-cuelive-1127-024127-21311, video-cue-cost.spec.ts:104, 3 black encoded frames): the stream page drew
 * nothing for 222 ms while the new red background, playing but stalled, was sent on by its check's catch-up seek; the
 * 300 ms timer let the blue go mid-seek, with no frame of the red presented, and the stream was black until the seek
 * landed. A paused video presents no new frame, so it alone is let go by the timer (its frame is drawn already).
 * A stand-in element: its frame callbacks are called as the test presents a frame; fake timers drive the rest.
 */

/** HTMLMediaElement's readiness values (no DOM here). */
const HAVE_METADATA = 1;
const HAVE_ENOUGH_DATA = 4;

class FakeVideo extends EventTarget {
  paused = false;
  ended = false;
  seeking = false;
  playbackRate = 1;
  readyState = HAVE_ENOUGH_DATA;
  private next = 1;
  private readonly callbacks = new Map<number, VideoFrameRequestCallback>();

  requestVideoFrameCallback(callback: VideoFrameRequestCallback): number {
    const id = this.next++;
    this.callbacks.set(id, callback);
    return id;
  }

  cancelVideoFrameCallback(id: number): void {
    this.callbacks.delete(id);
  }

  /** How many frame callbacks are waiting. */
  get asked(): number {
    return this.callbacks.size;
  }

  /** Chromium presents a frame: the callbacks asked before it are called, once each. */
  present(): void {
    const called = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of called)
      callback(performance.now(), { mediaTime: 0, presentedFrames: 1 } as VideoFrameCallbackMetadata);
  }

  /** A seek lands, with its frame presented (as Chromium does for a paused video sent somewhere new too). */
  land(): void {
    this.seeking = false;
    this.readyState = HAVE_ENOUGH_DATA;
    this.dispatchEvent(new Event('seeked'));
    this.present();
  }
}

/** The wait, as BackgroundMedia.tsx's slot starts it once the video is drawn over the picture before. */
const wait = (video: FakeVideo, presented: () => void): (() => void) => untilPresented(video, presented);

describe('a background video drawn over the picture before (render/present-wait.ts)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lets the picture before go at its first presented frame, once', () => {
    const video = new FakeVideo();
    const presented = vi.fn();
    wait(video, presented);
    expect(presented).not.toHaveBeenCalled();
    video.present();
    expect(presented).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PRESENT_WAIT_MS * 10);
    video.present();
    expect(presented).toHaveBeenCalledTimes(1);
  });

  it('lets a paused video, its frame drawn already and no new one to come, take the picture before’s place after PRESENT_WAIT_MS', () => {
    const video = new FakeVideo();
    video.paused = true;
    const presented = vi.fn();
    wait(video, presented);
    vi.advanceTimersByTime(PRESENT_WAIT_MS - 1);
    expect(presented).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(presented).toHaveBeenCalledTimes(1);
  });

  it('keeps the picture before while a playing video has presented no frame (CI’s Mac: stalled, its page drawing nothing)', () => {
    const video = new FakeVideo();
    const presented = vi.fn();
    wait(video, presented);
    vi.advanceTimersByTime(PRESENT_WAIT_MS * 10);
    expect(
      presented,
      'no frame of the new video presented yet: the picture before stays',
    ).not.toHaveBeenCalled();
    video.present();
    expect(presented).toHaveBeenCalledTimes(1);
  });

  it('keeps the picture before while the new video is still seeking when the timer would let it go', () => {
    // CI's Mac: its check's catch-up seek ran from 11207 to 11386 ms, the timer came at about 11255.
    const video = new FakeVideo();
    const presented = vi.fn();
    wait(video, presented);
    vi.advanceTimersByTime(PRESENT_WAIT_MS - 50);
    video.seeking = true;
    video.readyState = HAVE_METADATA;
    video.dispatchEvent(new Event('seeking'));
    vi.advanceTimersByTime(PRESENT_WAIT_MS * 10);
    expect(
      presented,
      'mid-seek, nothing of the new video presented: the picture before stays',
    ).not.toHaveBeenCalled();
    video.land();
    expect(presented).toHaveBeenCalledTimes(1);
  });

  it('keeps the picture before while a paused video is seeking, until its seek lands with its frame', () => {
    // Paused, sent somewhere new (the time bar's move while paused): the timer is not its end while it seeks.
    const video = new FakeVideo();
    video.paused = true;
    video.seeking = true;
    video.readyState = HAVE_METADATA;
    const presented = vi.fn();
    wait(video, presented);
    vi.advanceTimersByTime(PRESENT_WAIT_MS * 10);
    expect(presented).not.toHaveBeenCalled();
    video.land();
    expect(presented).toHaveBeenCalledTimes(1);
  });

  it('stops waiting when the slot changes: nothing is said after', () => {
    const video = new FakeVideo();
    video.paused = true;
    const presented = vi.fn();
    const stop = wait(video, presented);
    stop();
    expect(video.asked).toBe(0);
    vi.advanceTimersByTime(PRESENT_WAIT_MS * 10);
    video.present();
    expect(presented).not.toHaveBeenCalled();
  });
});
