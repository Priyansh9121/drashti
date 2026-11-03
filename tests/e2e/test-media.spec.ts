import { expect, test } from '@playwright/test';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, operatorPage, operatorReady } from './helpers';
import { makeTestVideo } from './test-media';

/*
 * The generated test video itself (alpha.14's gate on CI's Mac, 3 Nov 2026): the page's recorder there began only
 * when it was stopped (its start event 0.4–1.5 ms after stop()), so twenty recordings in a row came out empty and the
 * wallpapers' tests failed before they began. A recorder that starts late still gives a whole clip.
 */

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
  await app.close();
});
