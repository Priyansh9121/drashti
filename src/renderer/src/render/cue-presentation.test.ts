import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cuePresentation, RESEEK_STEP_S, STALE_FRAME_MS } from './cue-presentation';

class Video {
  /** Where the element is (s); a seek sets it through currentTime, recorded in seeks. */
  position = 1;
  seeks: number[] = [];
  decodedTimestamp = 1_000_000;
  seeking = false;
  /** Chromium's compositor has this element's frame (a VideoFrame can be read from it): only once one is presented. */
  framed = true;
  /** A refusal that is not about the moment (a picture that may not be read): its DOMException name. */
  refuse: string | null = null;
  private next = 0;
  private callbacks = new Map<number, VideoFrameRequestCallback>();
  private seekedListeners = new Set<() => void>();
  get currentTime(): number {
    return this.position;
  }
  set currentTime(to: number) {
    this.seeks.push(to);
    this.position = to;
    this.seeking = true;
  }
  addEventListener(type: string, listener: () => void): void {
    if (type === 'seeked') this.seekedListeners.add(listener);
  }
  removeEventListener(type: string, listener: () => void): void {
    if (type === 'seeked') this.seekedListeners.delete(listener);
  }
  /** Its seek lands: 'seeked'. */
  land(): void {
    this.seeking = false;
    for (const listener of [...this.seekedListeners]) listener();
  }
  requestVideoFrameCallback(callback: VideoFrameRequestCallback): number {
    const id = ++this.next;
    this.callbacks.set(id, callback);
    return id;
  }
  cancelVideoFrameCallback(id: number): void {
    this.callbacks.delete(id);
  }
  present(mediaTime: number): void {
    this.framed = true;
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback(0, { mediaTime } as VideoFrameCallbackMetadata);
  }
  element(): HTMLVideoElement {
    return this as unknown as HTMLVideoElement;
  }
}

describe('a private Cue first frame', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'VideoFrame',
      class {
        readonly timestamp: number;
        constructor(video: Video) {
          if (video.refuse) throw new DOMException('Generated refusal', video.refuse);
          if (!video.framed) throw new DOMException('Invalid source state.', 'InvalidStateError');
          this.timestamp = video.decodedTimestamp;
        }
        close(): void {
          /* A generated native frame handle. */
        }
      },
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('matches the actual decoded frame timestamp when a trim falls between frames of a 24 fps file', () => {
    const video = new Video(),
      ready = vi.fn();
    video.position = 1.04;
    video.decodedTimestamp = 1_000_000;
    const gate = cuePresentation(video.element(), ready);
    gate.decoded();
    expect(ready).not.toHaveBeenCalled();
    video.present(1);
    expect(ready).toHaveBeenCalledTimes(1);
    gate.stop();
  });
  it('cannot acknowledge decoded data until that trimmed frame reaches native presentation', () => {
    const video = new Video(),
      ready = vi.fn();
    const gate = cuePresentation(video.element(), ready);
    gate.decoded();
    expect(ready).not.toHaveBeenCalled();
    video.present(1);
    expect(ready).toHaveBeenCalledTimes(1);
    gate.stop();
  });
  it('also waits for decoding when native presentation is reported first', () => {
    const video = new Video(),
      ready = vi.fn();
    const gate = cuePresentation(video.element(), ready);
    video.present(1);
    expect(ready).not.toHaveBeenCalled();
    gate.decoded();
    expect(ready).toHaveBeenCalledTimes(1);
    gate.decoded();
    expect(ready).toHaveBeenCalledTimes(1);
    gate.stop();
  });
  it('does not count the file start before its trim seek lands, and accepts the actual trimmed frame', () => {
    const video = new Video(),
      ready = vi.fn();
    const gate = cuePresentation(video.element(), ready);
    video.present(0);
    gate.decoded();
    expect(ready).not.toHaveBeenCalled();
    video.present(1);
    expect(ready).toHaveBeenCalledTimes(1);
    gate.stop();
  });
  it("reads the decoded frame once it is presented when the decoder's word comes before the compositor has it", () => {
    // a21-s5b-1123-124303-84026: on a loaded two-core Windows the hall's loadeddata came at +223 ms while its
    // compositor had no frame yet, so reading it then threw and the whole cue failed before any page was ready.
    const video = new Video(),
      ready = vi.fn(),
      failed = vi.fn();
    video.framed = false;
    const gate = cuePresentation(video.element(), ready, failed);
    gate.decoded();
    expect(failed).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
    video.present(1);
    expect(failed).not.toHaveBeenCalled();
    expect(ready).toHaveBeenCalledTimes(1);
    gate.stop();
  });
  it("reads the frame again as the trimmed frame is presented, when the decoder's word read the frame from before the trim seek", () => {
    // a22-cue-1124-113329-24953 (CI's Mac, LIVE's player): its file's start was still the compositor's frame when the
    // decoder's word came, and was read then; the trimmed frame presented next never matched it, so no first frame
    // was acknowledged for 10 s and the whole cue failed ("could not load its first frame").
    const video = new Video(),
      ready = vi.fn(),
      failed = vi.fn();
    const gate = cuePresentation(video.element(), ready, failed);
    video.decodedTimestamp = 0;
    gate.decoded();
    expect(ready).not.toHaveBeenCalled();
    // The compositor takes the trimmed frame and presents it: the element's frame is that one now.
    video.decodedTimestamp = 1_000_000;
    video.present(1);
    expect(failed).not.toHaveBeenCalled();
    expect(ready).toHaveBeenCalledTimes(1);
    gate.stop();
  });
  it('still fails a frame that may not be read, at once, and one that cannot be read even once presented', () => {
    const refused = new Video(),
      failedAtOnce = vi.fn();
    refused.refuse = 'SecurityError';
    cuePresentation(refused.element(), vi.fn(), failedAtOnce).decoded();
    expect(failedAtOnce).toHaveBeenCalledTimes(1);
    const unreadable = new Video(),
      ready = vi.fn(),
      failed = vi.fn();
    unreadable.framed = false;
    const gate = cuePresentation(unreadable.element(), ready, failed);
    gate.decoded();
    unreadable.refuse = 'InvalidStateError';
    unreadable.present(1);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(ready).not.toHaveBeenCalled();
  });
  it('seeks its held video once more, to the same frame, when its trim seek landed and nothing replaced the frame from before it for half a second', () => {
    // a22-cue-1125-175229-57052 (CI's Windows, the hall's output window): its file's start was presented during the
    // trim seek, the decoder's word read the trimmed frame, and Chromium presented nothing more for 20 s, so the whole
    // cue failed ("could not load its first frame").
    vi.useFakeTimers();
    const video = new Video(),
      ready = vi.fn(),
      failed = vi.fn();
    const gate = cuePresentation(video.element(), ready, failed);
    video.present(0);
    gate.decoded();
    vi.advanceTimersByTime(STALE_FRAME_MS - 1);
    expect(video.seeks).toEqual([]);
    vi.advanceTimersByTime(1);
    // Chromium skips a seek to a paused video's own place, so it goes RESEEK_STEP_S on: the same trimmed frame.
    expect(video.seeks).toEqual([1 + RESEEK_STEP_S]);
    expect(RESEEK_STEP_S).toBeLessThanOrEqual(0.000_002);
    video.land();
    expect(ready).not.toHaveBeenCalled();
    video.present(1);
    expect(failed).not.toHaveBeenCalled();
    expect(ready).toHaveBeenCalledTimes(1);
    gate.stop();
  });
  it('seeks once more at most once a cue, and confirms the trimmed frame presented before that seek lands', () => {
    vi.useFakeTimers();
    const stuck = new Video(),
      stuckReady = vi.fn();
    const stuckGate = cuePresentation(stuck.element(), stuckReady, vi.fn());
    stuck.present(0);
    stuckGate.decoded();
    vi.advanceTimersByTime(STALE_FRAME_MS);
    stuck.land();
    vi.advanceTimersByTime(60_000);
    expect(stuck.seeks).toHaveLength(1);
    expect(stuckReady).not.toHaveBeenCalled();
    stuckGate.stop();
    // Its frame presented while the seek still lands: confirmed as it lands.
    const early = new Video(),
      earlyReady = vi.fn();
    const earlyGate = cuePresentation(early.element(), earlyReady, vi.fn());
    early.present(0);
    earlyGate.decoded();
    vi.advanceTimersByTime(STALE_FRAME_MS);
    early.present(1);
    expect(earlyReady).not.toHaveBeenCalled();
    early.land();
    expect(earlyReady).toHaveBeenCalledTimes(1);
    earlyGate.stop();
  });
  it('seeks no held video whose trimmed frame comes, whose seek still lands, whose frame was not read, or whose cue was cancelled', () => {
    vi.useFakeTimers();
    // The trimmed frame comes (as on every page, every other try).
    const usual = new Video(),
      usualReady = vi.fn();
    const usualGate = cuePresentation(usual.element(), usualReady);
    usual.present(0);
    usualGate.decoded();
    vi.advanceTimersByTime(STALE_FRAME_MS - 100);
    usual.present(1);
    vi.advanceTimersByTime(60_000);
    expect(usualReady).toHaveBeenCalledTimes(1);
    expect(usual.seeks).toEqual([]);
    usualGate.stop();
    // Another seek still landing: its own frame comes as it lands.
    const landing = new Video();
    const landingGate = cuePresentation(landing.element(), vi.fn());
    landing.present(0);
    landingGate.decoded();
    landing.seeking = true;
    vi.advanceTimersByTime(60_000);
    expect(landing.seeks).toEqual([]);
    landingGate.stop();
    // No frame read yet (its decoder's word not come).
    const unread = new Video();
    const unreadGate = cuePresentation(unread.element(), vi.fn());
    unread.present(0);
    vi.advanceTimersByTime(60_000);
    expect(unread.seeks).toEqual([]);
    unreadGate.stop();
    // Cancelled.
    const cancelled = new Video();
    const cancelledGate = cuePresentation(cancelled.element(), vi.fn());
    cancelled.present(0);
    cancelledGate.decoded();
    cancelledGate.stop();
    vi.advanceTimersByTime(60_000);
    expect(cancelled.seeks).toEqual([]);
  });
  it('never acknowledges a cancelled cue even if its decoder callback arrives later', () => {
    const video = new Video(),
      ready = vi.fn();
    const gate = cuePresentation(video.element(), ready);
    gate.stop();
    gate.decoded();
    video.present(1);
    expect(ready).not.toHaveBeenCalled();
  });
});
