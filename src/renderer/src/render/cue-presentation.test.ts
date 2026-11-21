import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cuePresentation } from './cue-presentation';

class Video {
  currentTime = 1;
  decodedTimestamp = 1_000_000;
  seeking = false;
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
