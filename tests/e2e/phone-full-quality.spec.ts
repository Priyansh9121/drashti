import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { ffmpeg as deckFfmpeg, makeDeckFiles, standInDecks, writeDeck } from './deck-stand-in';
import { device, type Engine, NETWORK_ENV, networkOn, pairByQr, pairingCode, PHONE, TABLET } from './devices';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  outputReady,
  type PageGlobals,
  setUpScreen,
} from './helpers';
import { KIRTAN, setUpPlaceholderShow, VIDEO } from './placeholder-show';

/*
 * Phones and tablets as a full Drashti (Session 54). D1, full quality: a picture on a phone or tablet is as sharp
 * as its screen allows, up to the original (never the 320-pixel preview again), larger still when it is looked at
 * closer and zoomed with two fingers, on the device only; a video plays on the device at its original quality, in
 * pieces as it plays. D2: while the zoomed picture is the one on the screens, a large button at the side puts that
 * zoom on the screens (the live zoom, Session 26e), and Back to Whole undoes it; on anything not live, neither is
 * there. At 375 × 812 and 768 × 1024, in Safari's engine and Chrome's, with axe and every target 44 px or more.
 * Pictures and the video are generated here; placeholder words only.
 */

const PICTURE_WIDTH = 3200;

/** A detailed picture, wider than any phone draws it whole: fine stripes and squares, drawn in the page. */
async function finePicture(win: Page, file: string): Promise<string> {
  const base64 = await win.evaluate((width) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.round((width * 9) / 16);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#1d4e89';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f5f5f7';
    for (let x = 0; x < canvas.width; x += 8) ctx.fillRect(x, 0, 2, canvas.height);
    ctx.fillStyle = '#c03030';
    for (let y = 0; y < canvas.height; y += 200)
      for (let x = 0; x < canvas.width; x += 200) ctx.fillRect(x, y, 100, 100);
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  }, PICTURE_WIDTH);
  writeFileSync(file, Buffer.from(base64, 'base64'));
  return file;
}

const snapshot = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

const dispatch = (win: Page, command: unknown) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

const showBackground = (win: Page, mediaId: string) =>
  dispatch(win, {
    type: 'setBackground',
    background: { kind: 'media', mediaId, media: 'image', fit: 'fit', loop: false },
  });

/** How a screen draws its background picture's zoom (its transform; none while it is plain). */
const screenZoom = (output: Page, layer: 'background' | 'slide' = 'background') =>
  output
    .locator(`[data-layer="${layer}"] [data-look-picture]`)
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).style.transform).join(' '));

/** How many pixels wide the picture a place draws is, as the device has it. */
const naturalWidth = (page: Page, within: string, mediaId: string) =>
  page
    .locator(`${within} img[data-preview="shown"][data-media-id="${mediaId}"]`)
    .first()
    .evaluate((img: HTMLImageElement) => img.naturalWidth)
    .catch(() => 0);

/** Every visible control under 44 × 44 CSS pixels (as phone-pages.spec.ts measures them). */
const tooSmall = (page: Page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        'button, a[href], input:not([type="hidden"]), select, textarea, [role="tab"], [role="button"], [role="slider"]',
      ),
    ]
      .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          name: (el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 30),
          w: r.width,
          h: r.height,
        };
      })
      .filter(({ w, h }) => w < 44 || h < 44),
  );

/**
 * Two fingers on the viewer's picture, spread from `from` to `to` pixels apart about its middle: the pointer
 * events a phone's touches make (Playwright has no second finger of its own).
 */
async function pinch(page: Page, from: number, to: number): Promise<void> {
  await page.getByTestId('viewer-surface').evaluate(
    (el, { from, to }) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const touch = (type: string, id: number, apart: number) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: 'touch',
            isPrimary: id === 1,
            clientX: id === 1 ? x - apart / 2 : x + apart / 2,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      touch('pointerdown', 1, from);
      touch('pointerdown', 2, from);
      for (let step = 1; step <= 6; step++) {
        const apart = from + ((to - from) * step) / 6;
        touch('pointermove', 1, apart);
        touch('pointermove', 2, apart);
      }
      touch('pointerup', 1, to);
      touch('pointerup', 2, to);
    },
    { from, to },
  );
}

const SIZES = [
  { name: 'a phone', width: 375, height: 812, device: PHONE },
  { name: 'a tablet', width: 768, height: 1024, device: { webkit: TABLET, chromium: 'Galaxy Tab S4' } },
] as const satisfies readonly {
  name: string;
  width: number;
  height: number;
  device: Record<Engine, string>;
}[];

for (const engine of ['chromium', 'webkit'] as const satisfies readonly Engine[])
  for (const size of SIZES)
    test(`pictures on ${size.name} (${String(size.width)} × ${String(size.height)}, ${engine === 'webkit' ? 'Safari’s' : 'Chrome’s'} engine) are as sharp as its screen allows, up to the original, and sharper zoomed (Session 54, D1)`, async () => {
      test.setTimeout(240_000);
      const { app } = await launchApp(NETWORK_ENV);
      const win = await operatorPage(app);
      await operatorReady(win);
      const dir = mkdtempSync(join(tmpdir(), 'drashti-full-quality-'));
      const [pictureId = ''] = await importAndGetIds(win, [
        await finePicture(win, join(dir, 'Placeholder fine lines.png')),
      ]);
      await showBackground(win, pictureId);
      const { base } = await networkOn(win);
      const code = await pairingCode(win, 'remote', 'Placeholder phone');
      const phone = await device(engine, size.device[engine]);
      const p = phone.page;
      await p.setViewportSize({ width: size.width, height: size.height });
      const asked: string[] = [];
      p.on('request', (r) => {
        const url = new URL(r.url());
        if (url.pathname.startsWith('/api/v1/media/')) asked.push(url.pathname);
      });
      const at = `${String(size.width)} × ${String(size.height)} (${engine})`;
      try {
        await pairByQr(p, base, code, '/remote');
        await expect(p.getByTestId('connection')).toHaveText('Connected');
        // The live picture: as many pixels wide as it is drawn on this screen (its device pixels), far past 320.
        const drawn = await p
          .getByTestId('remote-live')
          .evaluate((el) => Math.floor(el.getBoundingClientRect().width * devicePixelRatio));
        expect(drawn).toBeGreaterThan(320);
        await expect
          .poll(() => naturalWidth(p, '[data-testid="remote-live"]', pictureId), { timeout: 60_000 })
          .toBeGreaterThanOrEqual(Math.min(PICTURE_WIDTH, drawn));
        // Pictures at a width, never the small preview, never a file in pieces.
        expect(asked.filter((path) => !path.endsWith('/picture'))).toEqual([]);

        // Looked at closer: the screens' picture, full screen; zoomed in as far as it goes, it is the picture
        // itself (narrower than the screen's pixels at 400 %).
        await p.getByTestId('remote-look-closer').click();
        const viewer = p.getByTestId('viewer');
        await expect(viewer).toBeVisible();
        await expect(viewer).toHaveAttribute('data-live', 'true');
        for (let i = 0; i < 4; i++) await p.getByTestId('viewer-zoom-in').click();
        await expect(p.getByTestId('viewer-zoom-level')).toHaveText('400%');
        const wanted = await p
          .getByTestId('viewer-surface')
          .evaluate((el) => Math.floor(el.getBoundingClientRect().width * devicePixelRatio * 4));
        await expect
          .poll(() => naturalWidth(p, '[data-testid="viewer"]', pictureId), { timeout: 60_000 })
          .toBeGreaterThanOrEqual(Math.min(PICTURE_WIDTH, wanted));
        // The device's own zoom: the screens are as they were.
        expect((await snapshot(win)).liveZoom).toBeNull();
        // Its buttons, the side's among them (the picture is the one live): axe, and 44 px each.
        await expect(p.getByTestId('viewer-show-zoom')).toBeVisible();
        await expectNoSeriousA11yIssues(p, `the viewer, zoomed, at ${at}`);
        expect.soft(await tooSmall(p), `targets under 44 px: the viewer at ${at}`).toEqual([]);
        await p.getByTestId('viewer-close').click();
        await expect(viewer).toHaveCount(0);
      } finally {
        await phone.close();
      }
      await app.close();
    });

for (const engine of ['chromium', 'webkit'] as const satisfies readonly Engine[])
  test(`two fingers zoom on the phone only; the side button, only while it is the one live, puts that zoom on the screens, and Back to Whole undoes it (Session 54, D1 and D2; ${engine})`, async () => {
    test.setTimeout(240_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    const show = await setUpPlaceholderShow(win);
    await setUpScreen(win);
    const output = await outputPage(app);
    await outputReady(output);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-phone-zoom-'));
    const [pictureId = ''] = await importAndGetIds(win, [
      await finePicture(win, join(dir, 'Placeholder fine lines.png')),
    ]);
    await showBackground(win, pictureId);
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    const phone = await device(engine);
    const p = phone.page;
    await p.setViewportSize({ width: 375, height: 812 });
    try {
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');

      // A tap on the live picture opens it too. Two fingers spread: zoomed here, and only here.
      await p.getByTestId('remote-live-look').click();
      const surface = p.getByTestId('viewer-surface');
      await expect(surface).toBeVisible();
      await expect(p.getByTestId('viewer-show-zoom')).toHaveCount(0);
      await pinch(p, 60, 120);
      await expect.poll(async () => Number(await surface.getAttribute('data-zoom'))).toBeCloseTo(2, 1);
      expect((await snapshot(win)).liveZoom).toBeNull();
      expect(await screenZoom(output)).toBe('');

      // The picture is the one on the screens: the button at the side puts this zoom there, in step.
      const showZoom = p.getByTestId('viewer-show-zoom');
      await expect(showZoom).toHaveText('Show this zoom on the screens');
      await showZoom.click();
      await expect.poll(async () => (await snapshot(win)).liveZoom?.zoom ?? 0).toBeCloseTo(2, 1);
      await expect.poll(() => screenZoom(output)).toMatch(/scale\(2(\.\d+)?\)/u);
      await expect(showZoom).toHaveText('This zoom is on the screens');
      await expect(showZoom).toHaveAttribute('data-variant', 'live');

      // Back to Whole: the screens glide back to the picture as kept, and the phone to the whole of it.
      await p.getByTestId('viewer-whole').click();
      await expect.poll(async () => (await snapshot(win)).liveZoom?.zoom ?? 1).toBe(1);
      await expect.poll(() => screenZoom(output)).toBe('');
      await expect(p.getByTestId('viewer-zoom-level')).toHaveText('100%');
      await expect(p.getByTestId('viewer-screens')).toHaveCount(0);
      await p.getByTestId('viewer-close').click();

      // A presentation that is not on the screens, looked through: zoomed, and no button at the side.
      await p.getByTestId('remote-tab-library').click();
      await p.getByTestId('remote-library-item').filter({ hasText: KIRTAN }).click();
      await p.getByTestId('remote-look-through').click();
      await expect(p.getByTestId('viewer')).not.toHaveAttribute('data-live', 'true');
      await p.getByTestId('viewer-zoom-in').click();
      await expect(p.getByTestId('viewer-zoom-level')).toHaveText('150%');
      await expect(p.getByTestId('viewer-show-zoom')).toHaveCount(0);
      await expect(p.getByTestId('viewer-screens')).toHaveCount(0);
      await p.getByTestId('viewer-close').click();

      // A kirtan's slide of words on the screens, over the picture: looked through from there it is the one live,
      // but the screens would zoom the picture behind its words, which the phone does not show as the picture: no
      // button (D2 review), on its page, the next or the hall's picture while those words are up.
      await dispatch(win, { type: 'goLive', presentationId: show.kirtanId, slideIndex: 1 });
      await expect.poll(async () => (await snapshot(win)).layers.slide?.slideIndex).toBe(1);
      await p.getByTestId('remote-look-through').click();
      await expect(p.getByTestId('viewer')).toHaveAttribute('data-live', 'true');
      await p.getByTestId('viewer-zoom-in').click();
      await expect(p.getByTestId('viewer-zoom-level')).toHaveText('150%');
      await expect(p.getByTestId('viewer-show-zoom')).toHaveCount(0);
      await p.getByTestId('viewer-next').click();
      await expect(p.getByTestId('viewer')).not.toHaveAttribute('data-live', 'true');
      await p.getByTestId('viewer-zoom-in').click();
      await expect(p.getByTestId('viewer-show-zoom')).toHaveCount(0);
      // Turning pages on the phone never moved the screens.
      expect((await snapshot(win)).layers.slide?.slideIndex).toBe(1);
      await expectNoSeriousA11yIssues(p, `the viewer looking through a presentation (${engine})`);
      await p.getByTestId('viewer-close').click();
      await p.getByTestId('remote-look-closer').click();
      await expect(p.getByTestId('viewer')).toHaveAttribute('data-live', 'true');
      await p.getByTestId('viewer-zoom-in').click();
      await expect(p.getByTestId('viewer-show-zoom')).toHaveCount(0);
      expect((await snapshot(win)).liveZoom?.zoom ?? 1).toBe(1);
    } finally {
      await phone.close();
    }
    await app.close();
  });

test('a video plays on the phone at its original quality, in pieces as it plays, B’s time bar moving it there alone, never on the screens (Session 54, D1)', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win, { video: true });
  expect(show.videoMediaId).not.toBeNull();
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  const p = phone.page;
  const pieces: number[] = [];
  p.on('response', (r) => {
    if (new URL(r.url()).pathname.endsWith('/original')) pieces.push(r.status());
  });
  try {
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await p.getByTestId('remote-tab-playlist').click();
    await p.getByTestId('remote-playlist').selectOption(show.playlistId);
    const row = p.getByTestId('remote-items').locator('li').filter({ hasText: VIDEO });
    await row.getByTestId('remote-item-look').click();
    const video = p.getByTestId('viewer-video');
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
    await p.getByTestId('viewer-play').click();
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.3);
    // The file itself, by the link made for this phone, in pieces (206) as it plays.
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.every((status) => status === 206 || status === 200)).toBe(true);
    expect(pieces).toContain(206);
    // Its time bar here; nothing of it on the screens.
    await expect(p.getByTestId('viewer-time-bar')).toBeVisible();
    expect((await snapshot(win)).layers.background).toBeNull();
    // The bar is B's, at a finger's size: the time gone before it and the time left after it. Once the clip has
    // played to its end, a tap three quarters along moves it there, on this phone only.
    const track = p.getByTestId('viewer-track');
    await expect(track).toHaveAttribute('role', 'slider');
    await expect(p.getByTestId('viewer-track-left')).toHaveText(/^-\d+:\d{2}$/u);
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.ended), { timeout: 20_000 }).toBe(true);
    await expect(p.getByTestId('viewer-play')).toHaveText('Play');
    const box = await track.boundingBox();
    if (!box) throw new Error('The time bar has no box');
    await track.click({ position: { x: box.width * 0.75, y: box.height / 2 } });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(1.2);
    expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(1.8);
    await expect(p.getByTestId('viewer-track-elapsed')).toHaveText('0:01');
    expect((await snapshot(win)).layers.background).toBeNull();
    await expectNoSeriousA11yIssues(p, 'the viewer playing a video (chromium)');
    expect.soft(await tooSmall(p), 'targets under 44 px: the viewer playing a video').toEqual([]);
  } finally {
    await phone.close();
  }
  await app.close();
});

test('a deck’s slide on the screens, zoomed from a phone: the screens zoom the step drawn in its picture’s place, and Back to Whole undoes it (Session 54, D2 review)', async () => {
  test.skip(deckFfmpeg === null, 'needs the bundled FFmpeg (pnpm fetch-ffmpeg)');
  test.setTimeout(240_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const deckId = await writeDeck(win, 'Placeholder deck', standInDecks(await makeDeckFiles(win)));
  await setUpScreen(win);
  const output = await outputPage(app);
  await outputReady(output);
  await dispatch(win, { type: 'goLive', presentationId: deckId, slideIndex: 0 });
  await expect.poll(async () => (await snapshot(win)).layers.slide?.presentationId).toBe(deckId);
  await expect(output.locator('[data-layer="slide"] [data-deck-step="0"]')).toHaveCount(1);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  const p = phone.page;
  await p.setViewportSize({ width: 375, height: 812 });
  try {
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    // The deck's picture is the slide's own: zoomed on the phone, the side button offers it.
    await p.getByTestId('remote-look-closer').click();
    await expect(p.getByTestId('viewer')).toHaveAttribute('data-live', 'true');
    await pinch(p, 60, 120);
    const showZoom = p.getByTestId('viewer-show-zoom');
    await expect(showZoom).toBeVisible();
    await showZoom.click();
    await expect.poll(async () => (await snapshot(win)).liveZoom?.zoom ?? 0).toBeCloseTo(2, 1);
    // The step drawn in the picture's place zooms on the screens, as the picture itself would.
    await expect.poll(() => screenZoom(output, 'slide')).toMatch(/scale\(2(\.\d+)?\)/u);
    await expect(output.locator('[data-layer="slide"] [data-look-picture] [data-deck-step="0"]')).toHaveCount(
      1,
    );
    await p.getByTestId('viewer-whole').click();
    await expect.poll(async () => (await snapshot(win)).liveZoom?.zoom ?? 1).toBe(1);
    await expect.poll(() => screenZoom(output, 'slide')).toBe('');
  } finally {
    await phone.close();
  }
  await app.close();
});
