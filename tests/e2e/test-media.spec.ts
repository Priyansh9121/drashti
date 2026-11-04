import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, operatorPage, operatorReady } from './helpers';
import { makeTestVideo, webmDurationMs, webmLastFrameMs } from './test-media';

/*
 * The generated test video itself (alpha.14's gate on CI's Mac, 3 Nov 2026): the page's recorder there began only
 * when it was stopped (its start event 0.4–1.5 ms after stop()), so twenty recordings in a row came out empty and the
 * wallpapers' tests failed before they began. A recorder that starts late still gives a whole clip. And on 4 Nov
 * (alpha.14's gate again, CI's Mac): a recorder records from start(), its start event coming only with its first data,
 * 1.3–1.8 s late; the first picture held until then made a 2 s clip 3.4–3.8 s long. Each clip is the length asked.
 */

/** How long a test video plays (ms): its written duration, or its last frame's time, pictures or sound, if later. */
function lengthMs(file: string): number {
  const bytes = readFileSync(file);
  return Math.max(webmDurationMs(bytes), webmLastFrameMs(bytes));
}

test('a recorder that starts late still gives a whole test video', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  // As on CI's Mac: the page's recorder really starts 3 s after it is asked, or at once when it is stopped first.
  await win.evaluate(() => {
    const proto = MediaRecorder.prototype;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called on each recorder below, with call()
    const realStart = proto.start;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called on each recorder below, with call()
    const realStop = proto.stop;
    const late = new WeakMap<MediaRecorder, { timer: number; timeslice: number | undefined }>();
    proto.start = function (this: MediaRecorder, timeslice?: number) {
      const timer = window.setTimeout(() => {
        late.delete(this);
        realStart.call(this, timeslice);
      }, 3000);
      late.set(this, { timer, timeslice });
    };
    proto.stop = function (this: MediaRecorder) {
      const waiting = late.get(this);
      if (waiting) {
        window.clearTimeout(waiting.timer);
        late.delete(this);
        realStart.call(this, waiting.timeslice);
      }
      realStop.call(this);
    };
  });
  const dir = mkdtempSync(join(tmpdir(), 'drashti-test-media-'));
  // makeTestVideo checks the clip is whole (its frames run to its end), or throws after five tries.
  const file = await makeTestVideo(win, join(dir, 'Placeholder late clip.webm'), { seconds: 2 });
  expect(statSync(file).size).toBeGreaterThan(1000);
  const length = lengthMs(file);
  expect(length, 'the clip is the 2 s asked').toBeGreaterThan(1700);
  expect(length, 'the clip is the 2 s asked').toBeLessThan(2300);
  await app.close();
});

test('a recorder that says it has started only late still gives a test video the length asked', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  // As on CI's Mac on 4 Nov: the page's recorder records from start() on, but its start event comes 3 s later (or
  // when it is stopped first), later than the whole 2 s clip.
  await win.evaluate(() => {
    const proto = MediaRecorder.prototype;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called on each recorder below, with call()
    const realStart = proto.start;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called on each recorder below, with call()
    const realStop = proto.stop;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called on each recorder below, with call()
    const realListen = proto.addEventListener;
    const late = new WeakMap<MediaRecorder, number>();
    const startEvent = (recorder: MediaRecorder) => {
      late.delete(recorder);
      recorder.dispatchEvent(new Event('start'));
    };
    // The recorder's own start event never reaches the page's listeners (a listener's place in the order can't
    // stop it: at its target each runs in the order added); only this one, 3 s later.
    proto.addEventListener = function (
      this: MediaRecorder,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type !== 'start') {
        realListen.call(this, type, listener, options);
        return;
      }
      realListen.call(
        this,
        type,
        (event: Event) => {
          if (event.isTrusted) return;
          if (typeof listener === 'function') listener.call(this, event);
          else listener.handleEvent(event);
        },
        options,
      );
    } as typeof proto.addEventListener;
    proto.start = function (this: MediaRecorder, timeslice?: number) {
      late.set(
        this,
        window.setTimeout(() => startEvent(this), 3000),
      );
      realStart.call(this, timeslice);
    };
    proto.stop = function (this: MediaRecorder) {
      const timer = late.get(this);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        startEvent(this);
      }
      realStop.call(this);
    };
  });
  const dir = mkdtempSync(join(tmpdir(), 'drashti-test-media-'));
  // With a tone: its sound, too, ends with the clip.
  const file = await makeTestVideo(win, join(dir, 'Placeholder late start event clip.webm'), {
    seconds: 2,
    tone: 440,
  });
  const length = lengthMs(file);
  expect(length, 'the clip is the 2 s asked').toBeGreaterThan(1700);
  expect(length, 'the clip is the 2 s asked').toBeLessThan(2300);
  await app.close();
});
