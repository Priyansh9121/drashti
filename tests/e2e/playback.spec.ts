import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, outputPage, setUpScreen } from './helpers';
import { makeTestImage, makeTestVideo } from './test-media';

/*
 * Media playback on real output windows, with media made while the test
 * runs. Presentations come in the way the mandir's will: as ProPresenter 6
 * files whose slides carry background cues.
 */

const line = (text: string) => ({ rtf: cocoaRtf([[text, 80, [255, 255, 255]]]) });

const backgroundOf = (scope: Page | Locator, mediaId: string) =>
  scope.locator(`[data-layer="background"] [data-media-id="${mediaId}"]`);

/** How far a background video plays in `ms` (wrapping at its end); -1 when it is not there. */
async function playedOver(page: Page, mediaId: string, ms: number): Promise<number> {
  return page.evaluate(
    async ({ mediaId, ms }) => {
      const v = document.querySelector<HTMLVideoElement>(
        `[data-layer="background"] video[data-media-id="${mediaId}"]`,
      );
      if (!v) return -1;
      const before = v.currentTime;
      await new Promise((resolve) => setTimeout(resolve, ms));
      const d = v.duration;
      return (((v.currentTime - before) % d) + d) % d;
    },
    { mediaId, ms },
  );
}

/**
 * Record, at every frame, which background pictures are showing (with a
 * decoded picture): the media ids, joined by '+', or '' for none. Stopping
 * waits a few more frames first.
 */
async function watchBackgroundFrames(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const g = globalThis as { bgFrames?: string[]; bgStopAt?: number };
    const frames: string[] = [];
    g.bgFrames = frames;
    g.bgStopAt = Infinity;
    const tick = () => {
      const showing: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(
        '[data-layer="background"] [data-state="ready"]',
      )) {
        const picture =
          el instanceof HTMLVideoElement
            ? el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
            : el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0;
        if (picture && getComputedStyle(el).opacity === '1') showing.push(el.dataset['mediaId'] ?? '?');
      }
      frames.push(showing.join('+'));
      if (frames.length < (g.bgStopAt ?? Infinity)) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return async () => {
    await page.evaluate(async () => {
      const g = globalThis as { bgFrames?: string[]; bgStopAt?: number };
      g.bgStopAt = (g.bgFrames?.length ?? 0) + 10;
      while ((g.bgFrames?.length ?? 0) < g.bgStopAt)
        await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    return page.evaluate(() => (globalThis as { bgFrames?: string[] }).bgFrames ?? []);
  };
}

test('slide backgrounds play on the background layer of a real output', async () => {
  // Media answers 300 ms late, as from a slow disk, so every change of background takes a while.
  const { app } = await launchApp({ DRASHTI_TEST_MEDIA_DELAY_MS: '300' });
  const win = await app.firstWindow();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-bg-'));
  // Media first, while nothing covers the operator window (it records in real time).
  const loop = await makeTestVideo(win, join(dir, 'Placeholder loop.webm'), { seconds: 4, hue: 210 });
  const once = await makeTestVideo(win, join(dir, 'Placeholder once.webm'), { seconds: 2, hue: 20 });
  const still = await makeTestImage(win, join(dir, 'Placeholder still.png'), { width: 160, height: 90 });
  const show = join(dir, 'Placeholder Backgrounds.pro6');
  writeFileSync(
    show,
    pp6Presentation({
      uuid: 'E2E-BACKGROUNDS',
      groups: [
        {
          name: 'Verse',
          slides: [
            { background: { path: loop, kind: 'video', loop: true }, text: [line('Placeholder line one')] },
            { text: [line('Placeholder line two')] },
            { background: { path: loop, kind: 'video', loop: true }, text: [line('Placeholder line three')] },
            { background: { path: once, kind: 'video', loop: false }, text: [line('Placeholder line four')] },
            { background: { path: still, kind: 'image' }, text: [line('Placeholder line five')] },
            {
              background: { path: join(dir, 'Placeholder gone.png'), kind: 'image' },
              text: [line('Placeholder line six')],
            },
          ],
        },
      ],
    }),
  );
  const [presentationId = ''] = await importAndGetIds(win, [show]);
  const cueMedia = await win.evaluate(async (id) => {
    const doc = await (globalThis as PageGlobals).drashti.library.getPresentation(id);
    return (doc?.groups[0]?.slides ?? []).map((s) => {
      for (const cue of s.cues) if (cue.kind === 'background') return cue.background.mediaId;
      return '';
    });
  }, presentationId);
  const [loopId = '', none, again, onceId = '', stillId = '', goneId = ''] = cueMedia;
  expect(none).toBe('');
  expect(again).toBe(loopId);

  await setUpScreen(win);
  const output = await outputPage(app);
  await expect(output.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  const go = (slideIndex: number) =>
    win.evaluate(
      ({ presentationId, slideIndex }) =>
        (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'goLive', presentationId, slideIndex }),
      { presentationId, slideIndex },
    );
  const slideText = output.locator('[data-layer="slide"]');

  // The first slide's video plays behind its text, looping as its cue says.
  await go(0);
  await expect(slideText).toContainText('Placeholder line one');
  await expect(backgroundOf(output, loopId)).toHaveAttribute('data-state', 'ready');
  const playback = await backgroundOf(output, loopId).getAttribute('data-bg-slot');
  expect(await backgroundOf(output, loopId).evaluate((v: HTMLVideoElement) => v.loop && v.muted)).toBe(true);

  // A text-only slide: the video stays and keeps playing (its time keeps increasing).
  await go(1);
  await expect(slideText).toContainText('Placeholder line two');
  expect(await playedOver(output, loopId, 500)).toBeGreaterThan(0.3);
  expect(await backgroundOf(output, loopId).getAttribute('data-bg-slot')).toBe(playback);

  // The same file on a later slide carries on instead of restarting.
  await go(2);
  await expect(slideText).toContainText('Placeholder line three');
  expect(await backgroundOf(output, loopId).getAttribute('data-bg-slot')).toBe(playback);
  expect(await playedOver(output, loopId, 500)).toBeGreaterThan(0.3);
  await expect(output.locator('[data-layer="background"] video')).toHaveCount(1);

  // A different video: the old one stays on screen until the new one has its first frame.
  const frames = await watchBackgroundFrames(output);
  await go(3);
  await expect(backgroundOf(output, onceId)).toHaveAttribute('data-state', 'ready');
  await expect(backgroundOf(output, loopId)).toHaveCount(0);
  const seen = await frames();
  // Every frame shows exactly one picture: the old video until the new one is ready, then the new one.
  const firstNew = seen.indexOf(onceId);
  expect(seen[0], seen.join(' ')).toBe(loopId);
  // The new file took at least 300 ms to arrive: the old one was up for all of those frames.
  expect(firstNew, seen.join(' ')).toBeGreaterThan(10);
  expect(
    seen.slice(0, firstNew).every((f) => f === loopId),
    seen.join(' '),
  ).toBe(true);
  expect(
    seen.slice(firstNew).every((f) => f === onceId),
    seen.join(' '),
  ).toBe(true);

  // This one plays once and holds its last frame.
  await expect
    .poll(() => backgroundOf(output, onceId).evaluate((v: HTMLVideoElement) => v.ended), { timeout: 8000 })
    .toBe(true);
  await expect(backgroundOf(output, onceId)).toHaveAttribute('data-state', 'ready');

  // Clear background (F3 in the operator window) removes it and leaves the text up.
  await win.keyboard.press('F3');
  await expect(output.locator('[data-layer="background"]')).toHaveCount(0);
  await expect(slideText).toContainText('Placeholder line four');

  // An image background, in the output and the operator's preview alike.
  await go(4);
  await expect(backgroundOf(output, stillId)).toHaveAttribute('data-state', 'ready');
  await expect(backgroundOf(win.getByTestId('live-preview'), stillId)).toHaveAttribute('data-state', 'ready');

  // A background whose file was never found shows nothing; the preview says why.
  await go(5);
  await expect(backgroundOf(output, goneId)).toHaveAttribute('data-state', 'failed');
  await expect(backgroundOf(output, stillId)).toHaveCount(0);
  await expect(slideText).toContainText('Placeholder line six');
  await expect(win.getByTestId('background-failed')).toBeVisible();
  await expect(output.getByTestId('background-failed')).toHaveCount(0);

  await app.close();
});

test('images and videos placed on slides draw on the outputs; thumbnails show still frames and never play', async () => {
  const { app, userData } = await launchApp();
  const win = await app.firstWindow();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-elements-'));
  const clip = await makeTestVideo(win, join(dir, 'Placeholder clip.webm'), { seconds: 3, hue: 280 });
  const logo = await makeTestImage(win, join(dir, 'Placeholder logo.png'), {
    width: 120,
    height: 60,
    color: '#c62828',
  });
  const show = join(dir, 'Placeholder Elements.pro6');
  writeFileSync(
    show,
    pp6Presentation({
      uuid: 'E2E-ELEMENTS',
      groups: [
        {
          name: 'Verse',
          slides: [
            { image: { path: logo, rect: [60, 60, 600, 300] }, text: [line('Placeholder with a logo')] },
            {
              video: { path: clip, rect: [960, 60, 800, 450], loop: true },
              text: [line('Placeholder with a clip')],
            },
            {
              background: { path: clip, kind: 'video', loop: true },
              text: [line('Placeholder over the clip')],
            },
          ],
        },
      ],
    }),
  );
  const [presentationId = ''] = await importAndGetIds(win, [show]);
  const list = win.getByTestId('presentation-list');
  await list.getByRole('button', { name: /Placeholder Elements/ }).click();
  const grid = win.getByTestId('slide-grid');
  await expect(grid.getByRole('heading', { level: 2 })).toHaveText('Placeholder Elements');
  const thumbs = grid.getByTestId('slide-thumb');
  const loaded = (scope: Locator) =>
    scope.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);

  // The logo draws itself; the video (on slide 2, and as slide 3's background) shows a still frame.
  await expect.poll(() => loaded(thumbs.nth(0).locator('img[data-media-id]'))).toBe(true);
  await expect.poll(() => loaded(thumbs.nth(1).locator('img[data-still]'))).toBe(true);
  await expect.poll(() => loaded(thumbs.nth(2).getByTestId('thumb-background').locator('img'))).toBe(true);
  await expect(grid.locator('video')).toHaveCount(0);
  // One still for the one video file, kept in the media folder.
  expect(readdirSync(join(userData, 'Media', 'stills'))).toHaveLength(1);

  // After a reload the still comes straight from the media folder: nothing is made again.
  await win.reload();
  await list.getByRole('button', { name: /Placeholder Elements/ }).click();
  await expect.poll(() => loaded(thumbs.nth(1).locator('img[data-still="0"]'))).toBe(true);
  await expect(grid.locator('video')).toHaveCount(0);

  await setUpScreen(win);
  const output = await outputPage(app);
  await expect(output.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  const go = (slideIndex: number) =>
    win.evaluate(
      ({ presentationId, slideIndex }) =>
        (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'goLive', presentationId, slideIndex }),
      { presentationId, slideIndex },
    );

  // On the output and in the live preview, the logo is drawn where the slide puts it.
  await go(0);
  const slideLayer = output.locator('[data-layer="slide"]');
  await expect(slideLayer).toContainText('Placeholder with a logo');
  await expect.poll(() => loaded(slideLayer.locator('img[data-element]'))).toBe(true);
  await expect
    .poll(() => loaded(win.getByTestId('live-preview').locator('[data-layer="slide"] img[data-element]')))
    .toBe(true);

  // The clip plays on the output, muted, looping as the slide says.
  await go(1);
  const video = slideLayer.locator('video[data-element]');
  await expect(video).toHaveCount(1);
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA))
    .toBe(true);
  const played = await video.evaluate(async (v: HTMLVideoElement) => {
    const before = v.currentTime;
    await new Promise((resolve) => setTimeout(resolve, 400));
    return { delta: v.currentTime - before, muted: v.muted, loop: v.loop };
  });
  expect(played.delta).toBeGreaterThan(0.2);
  expect(played).toMatchObject({ muted: true, loop: true });

  await app.close();
});
