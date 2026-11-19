import { describe, expect, it } from 'vitest';
import { watchVideoClock } from './video-caption-clock';

class Video extends EventTarget {
  currentTime = 1;
  readyState = 2;
  seeking = false;
  ended = false;
  frame: VideoFrameRequestCallback | null = null;
  requests = 0;
  cancelled = 0;
  requestVideoFrameCallback(callback: VideoFrameRequestCallback) {
    this.frame = callback;
    return ++this.requests;
  }
  cancelVideoFrameCallback(_id: number) {
    this.cancelled++;
    this.frame = null;
  }
  present(mediaTime: number) {
    const frame = this.frame;
    this.frame = null;
    frame?.(123456, { mediaTime } as VideoFrameCallbackMetadata);
  }
  asElement() {
    return this as unknown as HTMLVideoElement;
  }
}

describe('captions read each output’s own decoded video clock', () => {
  it('uses that element’s presented frame, never wall time or another output', () => {
    const hall = new Video();
    const stream = new Video();
    const seen: (number | null)[] = [];
    const streamSeen: (number | null)[] = [];
    const stop = watchVideoClock(hall.asElement(), (ms) => seen.push(ms));
    const stopStream = watchVideoClock(stream.asElement(), (ms) => streamSeen.push(ms));
    hall.present(1.5);
    stream.present(1.25);
    expect(seen).toEqual([1000, 1500]);
    expect(streamSeen).toEqual([1000, 1250]);
    stop();
    stopStream();
  });
  it('reads pause, seeking, seeked and a loop from the element, and removes all listeners when stopped', () => {
    const video = new Video();
    const seen: (number | null)[] = [];
    const stop = watchVideoClock(video.asElement(), (ms) => seen.push(ms));
    video.currentTime = 2.5;
    video.dispatchEvent(new Event('pause'));
    expect(seen.at(-1)).toBe(2500);
    video.seeking = true;
    video.dispatchEvent(new Event('seeking'));
    expect(seen.at(-1)).toBeNull();
    video.seeking = false;
    video.currentTime = 4.5;
    video.dispatchEvent(new Event('seeked'));
    expect(seen.at(-1)).toBe(4500);
    video.present(1);
    expect(seen.at(-1)).toBe(1000);
    video.ended = true;
    video.dispatchEvent(new Event('ended'));
    expect(seen.at(-1)).toBeNull();
    const length = seen.length;
    stop();
    video.dispatchEvent(new Event('pause'));
    expect(seen).toHaveLength(length);
    expect(video.cancelled).toBe(1);
  });
});
