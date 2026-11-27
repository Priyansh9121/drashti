import { expect, test } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, operatorPage, operatorReady } from './helpers';
import { PLAYLIST, setUpPlaceholderShow } from './placeholder-show';

/*
 * A new video's first thumbnail (alpha.24, a25 item 31). The operator window learns that a video has no still frame
 * yet by asking for it (render/SlideView.tsx's WindowVideoStill), and then makes one (render/stills.ts). Until
 * alpha.24 the media scheme answered that ask as a refusal, a 404, so every show launch with a new video put one
 * "Failed to load resource" in the operator window's console. A still not made yet is not a refusal: the scheme
 * answers 204 No Content (src/main/media/media-protocol.ts), the window makes the still exactly as before, and
 * nothing is said in the console.
 */

test('a new video in the open playlist: its still is made, with no failed load in the operator window', async () => {
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  // Every load the operator window's console says failed, from the start.
  const failed: string[] = [];
  win.on('console', (m) => {
    if (m.type() === 'error' && m.text().startsWith('Failed to load resource'))
      failed.push(`${m.text()} (${m.location().url})`);
  });
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win, { video: true });
  const videoId = show.videoMediaId ?? '';
  expect(videoId).not.toBe('');

  // The playlist open: the video's row shows its still, made now (data-still counts the stills made, 0 = none yet).
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  const thumb = win
    .getByTestId('open-playlist')
    .getByTestId('playlist-item')
    .locator(`img[data-media-id="${videoId}"]`);
  await expect(thumb).toHaveAttribute('data-still', /^[1-9]\d*$/u);
  await expect
    .poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  // One still for the one video file, kept in the media folder.
  expect(readdirSync(join(userData, 'Media', 'stills'))).toHaveLength(1);

  // Nothing asked for and not found: the still not made yet was no failed load.
  expect(failed).toEqual([]);
  await app.close();
});
