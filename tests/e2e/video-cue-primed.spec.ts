import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { decodePng } from './png-decode';
import { dispatch } from './time-bar-helpers';
import { cueReady, setupVideoCue } from './video-cue-helpers';

test('Cue ready includes a native trimmed frame on every picture page while the audience picture stays unchanged', async () => {
  const { app, win, hall, stream, ids } = await setupVideoCue();
  try {
    const id = ids[1] ?? '';
    await win.evaluate(
      (id) =>
        (globalThis as PageGlobals).drashti.media.setMarkers(id, {
          startMs: 1000,
          endMs: 7000,
          markers: [],
        }),
      id,
    );
    await dispatch(win, { type: 'setBackground', background: { kind: 'color', color: '#205020' } });
    for (const page of [hall, win, stream])
      await page.evaluate((id) => {
        document.addEventListener(
          'loadeddata',
          (event) => {
            const v = event.target;
            if (!(v instanceof HTMLVideoElement) || v.dataset['mediaId'] !== id) return;
            const presented: VideoFrameRequestCallback = (_now, frame) => {
              if (Math.abs(frame.mediaTime - 1) < 0.001)
                v.dataset['privateNativeFrame'] = String(frame.mediaTime);
              else v.requestVideoFrameCallback(presented);
            };
            v.requestVideoFrameCallback(presented);
          },
          true,
        );
      }, id);
    expect((await dispatch(win, { type: 'cueVideo', mediaId: id })).ok).toBe(true);
    await cueReady(win);
    for (const page of [hall, win, stream]) {
      const v = page.locator(`video[data-media-id="${id}"]`).first();
      await expect(
        v,
        'ready must include a native frame before Go, rather than decoding behind opacity zero',
      ).toHaveAttribute('data-private-native-frame', '1');
      await expect(v).toHaveJSProperty('paused', true);
    }
    const picture = decodePng(await hall.screenshot());
    const at = (Math.floor(picture.height / 2) * picture.width + Math.floor(picture.width / 2)) * 4;
    expect(
      [...picture.rgba.subarray(at, at + 3)],
      'the audience keeps its exact current colour while Cue prepares',
    ).toEqual([32, 80, 32]);
  } finally {
    await app.close();
  }
});
