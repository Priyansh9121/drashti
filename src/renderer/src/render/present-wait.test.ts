import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIRST_FRAME_MS, SLOW_START_MS } from '../../../shared/no-picture';
import { watchStart } from './no-picture';
import { type EndOfWait, PRESENT_WAIT_MS, quietEndOfWait, untilPresented } from './present-wait';

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

/** A stand-in for the slot's no-first-frame watch (render/no-picture.ts watchStart): the test says when it gives up. */
class FakeWatch {
  private end: (() => void) | null = null;
  started = 0;
  stopped = 0;
  readonly start: EndOfWait = (end) => {
    this.started++;
    this.end = end;
    return () => {
      this.stopped++;
    };
  };

  giveUp(): void {
    this.end?.();
  }
}

/** The wait, as BackgroundMedia.tsx's slot starts it once the video is drawn over the picture before. */
const wait = (video: FakeVideo, presented: () => void, watch = new FakeWatch()): (() => void) =>
  untilPresented(video, presented, watch.start);

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

  it('ends the wait when the no-first-frame watch gives up: the picture before is never kept for ever', () => {
    const video = new FakeVideo();
    const presented = vi.fn();
    const watch = new FakeWatch();
    wait(video, presented, watch);
    expect(watch.started).toBe(1);
    vi.advanceTimersByTime(PRESENT_WAIT_MS * 10);
    expect(presented).not.toHaveBeenCalled();
    watch.giveUp();
    expect(presented).toHaveBeenCalledTimes(1);
    expect(watch.stopped).toBe(1);
    expect(video.asked).toBe(0);
    video.present();
    watch.giveUp();
    expect(presented).toHaveBeenCalledTimes(1);
  });

  it('stops the watch with the wait: at the first presented frame, and as the slot changes', () => {
    const video = new FakeVideo();
    const watch = new FakeWatch();
    wait(video, vi.fn(), watch);
    video.present();
    expect(watch.stopped).toBe(1);
    const other = new FakeWatch();
    const stop = wait(new FakeVideo(), vi.fn(), other);
    stop();
    expect(other.stopped).toBe(1);
  });

  it('lets go PRESENT_WAIT_MS after a playing video comes to hold still meanwhile (paused, or at its end)', () => {
    for (const how of ['pause', 'ended'] as const) {
      const video = new FakeVideo();
      const presented = vi.fn();
      wait(video, presented);
      vi.advanceTimersByTime(PRESENT_WAIT_MS * 2);
      expect(presented).not.toHaveBeenCalled();
      video.paused = true;
      if (how === 'ended') video.ended = true;
      video.dispatchEvent(new Event(how));
      vi.advanceTimersByTime(PRESENT_WAIT_MS - 1);
      expect(presented, how).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(presented, how).toHaveBeenCalledTimes(1);
    }
  });

  it('waits on for its frame when a paused video is played before the timer comes', () => {
    const video = new FakeVideo();
    video.paused = true;
    const presented = vi.fn();
    wait(video, presented);
    vi.advanceTimersByTime(PRESENT_WAIT_MS / 2);
    video.paused = false;
    video.dispatchEvent(new Event('play'));
    vi.advanceTimersByTime(PRESENT_WAIT_MS * 10);
    expect(presented).not.toHaveBeenCalled();
    video.present();
    expect(presented).toHaveBeenCalledTimes(1);
  });

  it('takes a video held at rate 0 (a cue’s Go lead) as holding still; sent on at its Go, it waits for its frame', () => {
    const held = new FakeVideo();
    held.playbackRate = 0;
    const heldDone = vi.fn();
    wait(held, heldDone);
    vi.advanceTimersByTime(PRESENT_WAIT_MS);
    expect(heldDone).toHaveBeenCalledTimes(1);
    const going = new FakeVideo();
    going.playbackRate = 0;
    const goingDone = vi.fn();
    wait(going, goingDone);
    vi.advanceTimersByTime(PRESENT_WAIT_MS / 2);
    going.playbackRate = 1;
    going.dispatchEvent(new Event('ratechange'));
    vi.advanceTimersByTime(PRESENT_WAIT_MS * 10);
    expect(goingDone).not.toHaveBeenCalled();
    going.present();
    expect(goingDone).toHaveBeenCalledTimes(1);
  });

  it('lets a paused video go PRESENT_WAIT_MS after its seek lands, should no frame callback come for it', () => {
    const video = new FakeVideo();
    video.paused = true;
    video.seeking = true;
    video.readyState = HAVE_METADATA;
    const presented = vi.fn();
    wait(video, presented);
    vi.advanceTimersByTime(PRESENT_WAIT_MS * 3);
    video.seeking = false;
    video.readyState = HAVE_ENOUGH_DATA;
    video.dispatchEvent(new Event('seeked'));
    vi.advanceTimersByTime(PRESENT_WAIT_MS - 1);
    expect(presented).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(presented).toHaveBeenCalledTimes(1);
  });

  it('with the real no-first-frame watch: a playing video that never presents a frame is let go after FIRST_FRAME_MS with no progress', () => {
    // As BackgroundMedia.tsx starts it: no showing given (no words to Main), no bridge here (nothing sent asked).
    const video = Object.assign(new FakeVideo(), {
      buffered: { length: 0, start: () => 0, end: () => 0 },
      webkitDecodedFrameCount: 1,
    });
    const presented = vi.fn();
    untilPresented(video, presented, (end) =>
      watchStart(video as unknown as HTMLVideoElement, 'placeholder-media', () => end()),
    );
    vi.advanceTimersByTime(FIRST_FRAME_MS - 1);
    expect(presented).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(presented).toHaveBeenCalledTimes(1);
  });
  it('keeps the picture before while a paused video seeks with its frame still in (readyState unchanged): its seek alone keeps it', () => {
    // a24-review-bgblack SHOULD-1: Chromium can leave readyState where it was for a seek to where a paused video is.
    const video = new FakeVideo();
    video.paused = true;
    video.seeking = true;
    const presented = vi.fn();
    wait(video, presented);
    vi.advanceTimersByTime(PRESENT_WAIT_MS * 10);
    expect(presented, 'seeking: nothing new drawn yet').not.toHaveBeenCalled();
    video.land();
    expect(presented).toHaveBeenCalledTimes(1);
  });

  it('keeps the picture before while a paused video has no frame where it is (not seeking); its data in, let go PRESENT_WAIT_MS after', () => {
    // a24-review-bgblack SHOULD-1: the frame guard alone; its data coming in arms the timer ('loadeddata' or 'canplay').
    for (const event of ['loadeddata', 'canplay'] as const) {
      const video = new FakeVideo();
      video.paused = true;
      video.readyState = HAVE_METADATA;
      const presented = vi.fn();
      wait(video, presented);
      vi.advanceTimersByTime(PRESENT_WAIT_MS * 10);
      expect(presented, `${event}: no frame where it is`).not.toHaveBeenCalled();
      video.readyState = HAVE_ENOUGH_DATA;
      video.dispatchEvent(new Event(event));
      vi.advanceTimersByTime(PRESENT_WAIT_MS - 1);
      expect(presented, event).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(presented, event).toHaveBeenCalledTimes(1);
    }
  });
});

/*
 * The end of the wait as BackgroundMedia.tsx gives it (a24-review-bgblack SHOULD-2): the no-first-frame watch, which
 * says nothing to Main when it gives up, whichever way. A stand-in bridge records every word a page could send.
 */
describe('the quiet end of a background video’s wait (render/present-wait.ts quietEndOfWait)', () => {
  const g = globalThis as { drashti?: unknown };
  let media: Record<
    'served' | 'cannotPlay' | 'starting' | 'playsHere' | 'noPicture',
    ReturnType<typeof vi.fn>
  >;
  beforeEach(() => {
    vi.useFakeTimers();
    media = {
      served: vi.fn(() => Promise.resolve(0)),
      cannotPlay: vi.fn(() => Promise.resolve()),
      starting: vi.fn(() => Promise.resolve()),
      playsHere: vi.fn(() => Promise.resolve()),
      noPicture: vi.fn(() => Promise.resolve()),
    };
    g.drashti = { media };
  });
  afterEach(() => {
    delete g.drashti;
    vi.useRealTimers();
  });

  /** A playing video that never presents a frame: `decoding`, whether it decodes on meanwhile (progress). */
  const never = (decoding: boolean) => {
    const video = Object.assign(new FakeVideo(), {
      buffered: { length: 0, start: () => 0, end: () => 0 },
      webkitDecodedFrameCount: 1,
    });
    const presented = vi.fn();
    untilPresented(
      video,
      presented,
      quietEndOfWait(video as unknown as HTMLVideoElement, 'placeholder-media'),
    );
    const step = (ms: number) => {
      for (let t = 0; t < ms; t += 500) {
        if (decoding) video.webkitDecodedFrameCount++;
        vi.advanceTimersByTime(Math.min(500, ms - t));
      }
    };
    return { presented, step };
  };

  const onlyServedAsked = () => {
    expect(media.served).toHaveBeenCalled();
    for (const word of ['cannotPlay', 'starting', 'playsHere', 'noPicture'] as const)
      expect(media[word], `${word}: nothing said to Main`).not.toHaveBeenCalled();
  };

  it('gives up when it makes no progress for FIRST_FRAME_MS (stalled), saying nothing to Main', async () => {
    const { presented, step } = never(false);
    step(FIRST_FRAME_MS - 500);
    expect(presented).not.toHaveBeenCalled();
    step(500);
    expect(presented).toHaveBeenCalledTimes(1);
    await vi.runOnlyPendingTimersAsync();
    onlyServedAsked();
  });

  it('gives up SLOW_START_MS after it began while it still decodes (slow), saying nothing to Main', async () => {
    const { presented, step } = never(true);
    step(SLOW_START_MS - 500);
    expect(presented).not.toHaveBeenCalled();
    step(500);
    expect(presented).toHaveBeenCalledTimes(1);
    await vi.runOnlyPendingTimersAsync();
    onlyServedAsked();
  });
});
