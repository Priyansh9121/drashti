import { describe, expect, it } from 'vitest';
import { heardFrom, NO_PICTURE_MS, PictureWatch } from './picture-watch';

/* The stream's picture (Session 18): no picture from the stream's page while wanted, and the page is given a new port. */

const status = (now: number, more: Partial<Parameters<PictureWatch['heard']>[0]> = {}) => ({
  wanted: true,
  encoderChosen: true,
  encoding: false,
  failed: false,
  now,
  ...more,
});

describe('the stream’s picture', () => {
  it('gives the page a new port after 5 s with no picture, then waits longer each time, to a minute', () => {
    const watch = new PictureWatch();
    watch.newWorker();
    watch.paired(0);
    // The worker's first status, the moment it has its encoder (known from the last time, so at once).
    expect(watch.heard(status(0))).toBeNull();
    expect(watch.heard(status(1000))).toBeNull();
    expect(watch.heard(status(NO_PICTURE_MS - 1))).toBeNull();
    expect(watch.heard(status(NO_PICTURE_MS))).toBe(5000);
    const waits: number[] = [];
    let at = NO_PICTURE_MS;
    for (let i = 0; i < 6; i++) {
      watch.paired(at);
      for (;;) {
        at += 1000;
        const wait = watch.heard(status(at));
        if (wait !== null) {
          waits.push(wait);
          break;
        }
      }
    }
    expect(waits).toEqual([10_000, 20_000, 40_000, 60_000, 60_000, 60_000]);
  });

  it('a picture resets the wait; nothing is done while not wanted, before the encoder is chosen, or when it failed', () => {
    const watch = new PictureWatch();
    watch.newWorker();
    watch.paired(0);
    expect(watch.heard(status(0))).toBeNull();
    expect(watch.heard(status(6000))).toBe(5000);
    watch.paired(6000);
    expect(watch.heard(status(7000, { encoding: true }))).toBeNull();
    watch.paired(30_000);
    expect(watch.heard(status(35_000))).toBe(5000);
    watch.paired(100_000);
    expect(watch.heard(status(200_000, { wanted: false }))).toBeNull();
    expect(watch.heard(status(200_000, { encoderChosen: false }))).toBeNull();
    expect(watch.heard(status(200_000, { failed: true }))).toBeNull();
  });

  it('an encoder starting again is no lasting fault: the page is still given a new port after the wait (x71’s take)', () => {
    // x71: an encoder that stops or cannot start puts its words in the worker's error at once, and another starts. If
    // the page's capture or port went with it (a graphics process restarting can take both), only a new port brings
    // its pictures back, so the watch goes on as it did before those words.
    const encoder = { name: 'libx264', label: 'x264', hardware: false };
    const restarting = { encoder, encoding: false, error: 'The encoder stopped. Trying to start it again.' };
    const watch = new PictureWatch();
    watch.newWorker();
    watch.paired(0);
    expect(watch.heard(heardFrom(restarting, true, 0))).toBeNull();
    expect(watch.heard(heardFrom(restarting, true, NO_PICTURE_MS - 1))).toBeNull();
    expect(watch.heard(heardFrom(restarting, true, NO_PICTURE_MS))).toBe(5000);
    // No H.264 encoder works on this computer: that lasts, and no port is given for it.
    const none = {
      encoder: null,
      encoding: false,
      error: 'No H.264 encoder works on this computer, so it cannot stream or record.',
    };
    watch.paired(100_000);
    expect(watch.heard(heardFrom(none, true, 200_000))).toBeNull();
    expect(heardFrom(none, true, 200_000).failed).toBe(true);
  });

  it('the time the worker takes to choose its encoder is not counted as no picture (alpha.14’s gate on CI’s Mac)', () => {
    // CI's Mac, 3 Nov 2026 (run 41633894725): the page was given the encoder's port at once and sent its first frame;
    // the worker took 15 s to choose its encoder (VideoToolbox's test encode hung until its 15 s limit, then x264); its
    // first status with the encoder came 15 s after the port, and the page was given a new one at once.
    const watch = new PictureWatch();
    watch.newWorker();
    watch.paired(0);
    for (let at = 1000; at < 15_000; at += 1000)
      expect(watch.heard(status(at, { encoderChosen: false }))).toBeNull();
    expect(watch.heard(status(15_100))).toBeNull();
    // Still no picture 5 s after the encoder was chosen: then the page is given a new port.
    expect(watch.heard(status(20_099))).toBeNull();
    expect(watch.heard(status(20_100))).toBe(5000);
  });

  it('a new worker chooses its encoder afresh: its search is not counted either', () => {
    const watch = new PictureWatch();
    watch.newWorker();
    watch.paired(0);
    expect(watch.heard(status(500))).toBeNull();
    // The worker stopped by itself and a new one started 60 s later, its port given at once.
    watch.newWorker();
    watch.paired(60_000);
    expect(watch.heard(status(70_000, { encoderChosen: false }))).toBeNull();
    expect(watch.heard(status(75_000))).toBeNull();
    expect(watch.heard(status(80_000))).toBe(5000);
  });
});
