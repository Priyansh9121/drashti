import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIRST_FRAME_MS } from '../../../shared/no-picture';
import { tellCannotPlay, watchFirstFrame } from './no-picture';

/*
 * A page that said a showing could not play, drawing it after all (alpha.23, a22-halldrop's review, MUST-2): its first
 * frame is said to Main once, so LIVE no longer names that screen for it; a showing never said to fail says nothing.
 * Each case its own placeholder file: the page keeps what it said for as long as it is open.
 */

/** A video element as the watch reads it. */
class FakeVideo extends EventTarget {
  readyState = 0;
  buffered = { length: 0, end: () => 0 };
}

const drawn = (v: FakeVideo) => {
  v.readyState = 2;
  v.dispatchEvent(new Event('loadeddata'));
};

describe('a page’s first frame after it said a showing could not play (alpha.23, a22-halldrop)', () => {
  const said: [string, number][] = [];
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    vi.stubGlobal('HTMLMediaElement', { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 });
    vi.stubGlobal('drashti', {
      media: {
        cannotPlay: () => Promise.resolve(null),
        served: () => Promise.resolve(0),
        playsHere: (mediaId: string, startedAt: number) => {
          said.push([mediaId, startedAt]);
          return Promise.resolve(null);
        },
      },
    });
    said.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('says it once after its word, and again on a later try (one loaded again after a GPU process stopped) after another word', () => {
    const v = new FakeVideo();
    const stop = watchFirstFrame(v as unknown as HTMLVideoElement, 'clip-a', 1000, 0);
    tellCannotPlay('clip-a', 1000, 0, { code: 3, message: '' });
    drawn(v);
    expect(said).toEqual([['clip-a', 1000]]);
    v.dispatchEvent(new Event('loadeddata'));
    expect(said).toHaveLength(1);
    stop();
    // The next try fails too, then loads; already drawn as it is watched.
    tellCannotPlay('clip-a', 1000, 1, { code: 3, message: '' });
    const again = new FakeVideo();
    again.readyState = 2;
    watchFirstFrame(again as unknown as HTMLVideoElement, 'clip-a', 1000, 1)();
    expect(said).toEqual([
      ['clip-a', 1000],
      ['clip-a', 1000],
    ]);
  });

  it('says nothing for a showing it never said could not play, nor for one taken down before it drew', () => {
    const v = new FakeVideo();
    watchFirstFrame(v as unknown as HTMLVideoElement, 'clip-b', 2000, 0);
    drawn(v);
    const w = new FakeVideo();
    const stop = watchFirstFrame(w as unknown as HTMLVideoElement, 'clip-c', 3000, 0);
    tellCannotPlay('clip-c', 3000, 0, { code: 3, message: '' });
    stop();
    drawn(w);
    expect(said).toEqual([]);
  });

  it('after the watch’s own word (no progress for 10 s), a first frame that comes later is still said', () => {
    const v = new FakeVideo();
    watchFirstFrame(v as unknown as HTMLVideoElement, 'clip-d', 4000, 0);
    vi.advanceTimersByTime(FIRST_FRAME_MS + 1000);
    expect(said).toEqual([]);
    drawn(v);
    expect(said).toEqual([['clip-d', 4000]]);
  });
});
