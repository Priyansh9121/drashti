import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importAndGetIds, launchApp } from './helpers';
import { makeTestImage, makeTestVideo } from './test-media';

const NOBODY = '00000000-0000-0000-0000-000000000000';

test('library media reaches the windows by id only, with byte ranges, and nothing else is served', async () => {
  const { app } = await launchApp();
  const win = await app.firstWindow();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-media-'));
  const image = await makeTestImage(win, join(dir, 'Placeholder image.png'), { width: 64, height: 36 });
  const video = await makeTestVideo(win, join(dir, 'Placeholder video.webm'), { seconds: 2 });
  const [imageId = '', videoId = ''] = await importAndGetIds(win, [image, video]);
  expect(imageId).not.toBe('');
  expect(videoId).not.toBe('');

  // An image loads by its id; an unknown id does not load.
  const loaded = await win.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  }, `drashti-media://media/${imageId}`);
  expect(loaded).toEqual([64, 36]);
  const unknown = await win.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    return img.decode().then(
      () => 'loaded',
      () => 'failed',
    );
  }, `drashti-media://media/${NOBODY}`);
  expect(unknown).toBe('failed');

  // A video streams in byte ranges, so the player knows it can seek, and does.
  const seeked = await win.evaluate(async (url) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = url;
    await new Promise((resolve, reject) => {
      v.onloadedmetadata = resolve;
      v.onerror = () => {
        reject(new Error(v.error?.message ?? 'video error'));
      };
    });
    const seekable = v.seekable.length > 0 ? v.seekable.end(0) : 0;
    v.currentTime = 1.5;
    await new Promise((resolve) => (v.onseeked = resolve));
    const out = { duration: v.duration, seekable, time: v.currentTime, width: v.videoWidth };
    v.removeAttribute('src');
    v.load();
    return out;
  }, `drashti-media://media/${videoId}`);
  expect(seeked.duration).toBeGreaterThan(1.8);
  expect(seeked.seekable).toBeGreaterThan(1.8);
  expect(seeked.time).toBeCloseTo(1.5, 1);
  expect(seeked.width).toBe(320);

  // The page may load the scheme as images and media only: fetching it is refused.
  const fetched = await win.evaluate(async (url) => {
    let violated = '';
    document.addEventListener(
      'securitypolicyviolation',
      (e) => {
        violated = e.effectiveDirective;
      },
      { once: true },
    );
    const outcome = await fetch(url).then(
      () => 'fetched',
      () => 'refused',
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { outcome, violated };
  }, `drashti-media://media/${imageId}`);
  expect(fetched).toEqual({ outcome: 'refused', violated: 'connect-src' });

  // What the main process answers (every refusal case is unit-tested).
  const answers = await app.evaluate(
    async ({ net }, ids) => {
      const status = async (url: string, init?: RequestInit) => (await net.fetch(url, init)).status;
      const range = await net.fetch(`drashti-media://media/${ids.videoId}`, {
        headers: { Range: 'bytes=0-99' },
      });
      return {
        whole: await status(`drashti-media://media/${ids.imageId}`),
        range: [range.status, range.headers.get('content-range')?.split('/')[0]],
        unknown: await status(`drashti-media://media/${ids.nobody}`),
        path: await status('drashti-media://media/..%2F..%2Fdrashti.sqlite'),
        post: await status(`drashti-media://media/${ids.imageId}`, { method: 'POST', body: 'x' }),
      };
    },
    { imageId, videoId, nobody: NOBODY },
  );
  expect(answers).toEqual({ whole: 200, range: [206, 'bytes 0-99'], unknown: 404, path: 404, post: 405 });

  await app.close();
});
