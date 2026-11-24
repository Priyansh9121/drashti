import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cuePresentation } from './cue-presentation';

class Video {
  currentTime = 1;
  decodedTimestamp = 1_000_000;
  seeking = false;
  /** Chromium's compositor has this element's frame (a VideoFrame can be read from it): only once one is presented. */
  framed = true;
  /** A refusal that is not about the moment (a picture that may not be read): its DOMException name. */
  refuse: string | null = null;
  private next = 0;
  private callbacks = new Map<number, VideoFrameRequestCallback>();
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
  afterEach(() => vi.unstubAllGlobals());
  it('matches the actual decoded frame timestamp when a trim falls between frames of a 24 fps file', () => {
    const video = new Video(),
      ready = vi.fn();
    video.currentTime = 1.04;
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
