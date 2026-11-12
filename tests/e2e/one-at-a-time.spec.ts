import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  setUpScreen,
} from './helpers';
import { makeTestVideo } from './test-media';
import { backgroundTiming, type Copy, heldAt, inStep, row, snapshot } from './time-bar-helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * LIVE shows one thing at a time (Session 56, the owner's words of 11 Nov 2026): "A video takes off the wallpaper and
 * black-out, and the other way round", in Pro Mode and Simple Mode; "Drag LIVE's time bar to move a video or sound
 * forward or back, like an ordinary player" (both modes); and Simple Mode's "Pause under LIVE for a video and for a
 * sound". Read where the audience sees it: the screen's own video element (its currentTime, paused or playing), and
 * LIVE's lines and buttons. A generated test video and placeholder words only; quiet; codes made at run time.
 */

const SECONDS = 20;

/** The screen's copy of the background video, by its file. */
const onScreen = (mediaId: string) => `[data-layer="background"] video[data-media-id="${mediaId}"]`;

/** A playlist of a presentation of words and the test video, open in the middle; its rows. */
async function sabha(win: Page): Promise<{ mediaId: string; words: Locator; video: Locator }> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-one-at-a-time-'));
  const text = join(dir, 'Placeholder One At A Time.txt');
  writeFileSync(text, '[Verse]\nPlaceholder words one\n\n[Verse]\nPlaceholder words two\n');
  const clip = await makeTestVideo(win, join(dir, 'Placeholder one at a time clip.webm'), {
    seconds: SECONDS,
    hue: 140,
    tone: 330,
  });
  const [presentationId = '', mediaId = ''] = await importAndGetIds(win, [text, clip]);
  await win.evaluate(
    async ({ presentationId, mediaId }) => {
      const d = (globalThis as PageGlobals).drashti;
      const list = await d.playlists.create('Placeholder one at a time', null, false);
      if (!list.ok) throw new Error(list.message);
      const added = await d.playlists.addItems(list.ids[0] ?? '', null, [
        { kind: 'presentation', presentationId },
        { kind: 'media', mediaId },
      ]);
      if (!added.ok) throw new Error(added.message);
    },
    { presentationId, mediaId },
  );
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder one at a time' }).click();
  const rows = win.getByTestId('open-playlist');
  await expect(rows.getByTestId('playlist-item')).toHaveCount(2);
  return {
    mediaId,
    words: rows.getByTestId('slide-thumb').filter({ hasText: 'Placeholder words one' }),
    video: rows.getByTestId('playlist-item').filter({ hasText: 'Placeholder one at a time clip' }),
  };
}

/** One screen, its page and the copies of the video there (the screen and the audio player). */
async function oneScreen(win: Page, app: Parameters<typeof outputPages>[0]): Promise<Page> {
  await setUpScreen(win, 'Main Hall', 0);
  await expect.poll(() => outputPages(app).length).toBe(1);
  const [hall] = outputPages(app) as [Page];
  await outputReady(hall);
  return hall;
}

/** The screen's video is there and playing (not paused), or gone. */
const playingThere = (page: Page, mediaId: string) =>
  page.evaluate((selector) => {
    const v = document.querySelector<HTMLVideoElement>(selector);
    return v === null ? 'gone' : v.paused ? 'paused' : 'playing';
  }, onScreen(mediaId));

/** What the engine has up: the covers and the background's file. */
async function up(win: Page): Promise<{ blackout: boolean; wallpaper: boolean; background: string | null }> {
  const s = await snapshot(win);
  const bg = s.layers.background;
  return {
    blackout: s.blackout,
    wallpaper: s.wallpaper,
    background: bg?.kind === 'media' ? bg.mediaId : null,
  };
}

/**
 * The covers and the video, both ways, through these buttons (Pro Mode's or Simple Mode's): Black-out and the
 * Wallpaper take the playing video off the screen, and do not bring it back as they come off; the video's row put up
 * takes them off; a slide stays under a cover and comes back as it was. LIVE's line, its time bar and the bar of clears
 * never show the video beside a cover. Each cover replaces the other, and Oops takes the cover off to show its slide.
 */
async function bothWays(
  win: Page,
  hall: Page,
  show: { mediaId: string; words: Locator; video: Locator },
  covers: { blackout: Locator; wallpaper: Locator },
  mode: string,
): Promise<void> {
  const { mediaId } = show;
  for (const [name, cover] of [
    ['Black-out', covers.blackout],
    ['Wallpaper', covers.wallpaper],
  ] as const) {
    await show.video.click();
    await expect.poll(() => playingThere(hall, mediaId), `${mode}: the video plays`).toBe('playing');
    await expect(row(win, 'background')).toHaveCount(1);
    await cover.click();
    await expect(cover).toHaveText(new RegExp(`^${name} is on`, 'u'));
    // Off the screen and out of the engine: nothing plays under the cover (its sound neither).
    await expect.poll(() => playingThere(hall, mediaId), `${mode}: ${name} took the video off`).toBe('gone');
    expect(await up(win)).toMatchObject({ background: null });
    // LIVE never shows it beside the cover: no time bar, the row's line not live.
    await expect(row(win, 'background')).toHaveCount(0);
    await expect(win.getByTestId('live-text')).toHaveText(/\(cleared\)$/u);
    // Off again: the video does not come back.
    await cover.click();
    await expect(cover).not.toHaveText(/is on/u);
    await expect.poll(() => playingThere(hall, mediaId)).toBe('gone');
    // On again, then the video's row: the cover comes off, and the video plays.
    await cover.click();
    await expect(cover).toHaveText(/is on/u);
    await show.video.click();
    await expect(cover).not.toHaveText(/is on/u);
    expect(await up(win)).toMatchObject({ blackout: false, wallpaper: false, background: mediaId });
    await expect.poll(() => playingThere(hall, mediaId), `${mode}: put up under ${name}`).toBe('playing');
    await expect(win.getByTestId('live-text')).not.toHaveText(/\(cleared\)/u);
  }
  // A slide stays under a cover and comes back as it was; put up under one, it takes it off.
  await show.words.click();
  await expect(win.getByTestId('live-text')).toContainText('slide 1 of 2');
  await covers.blackout.click();
  await expect.poll(async () => (await snapshot(win)).layers.slide?.slideIndex).toBe(0);
  await covers.blackout.click();
  await expect(win.getByTestId('live-text')).toContainText('slide 1 of 2');
  await covers.wallpaper.click();
  await expect(covers.wallpaper).toHaveText(/is on/u);
  await show.words.click();
  await expect(covers.wallpaper).not.toHaveText(/is on/u);

  // Each cover takes the other off. Turning the second one off reveals the slide.
  const blackout = hall.getByTestId('blackout');
  const wallpaper = hall.getByTestId('wallpaper');
  const slide = hall.locator('[data-layer="slide"]');
  await covers.wallpaper.click();
  await expect(wallpaper).toBeVisible();
  await win.keyboard.press('.');
  await expect(blackout).toBeVisible();
  await expect(wallpaper).toHaveCount(0);
  await expect(covers.wallpaper).not.toHaveText(/is on/u);
  expect(await up(win)).toMatchObject({ blackout: true, wallpaper: false });
  await win.keyboard.press('F12');
  await expect(wallpaper).toBeVisible();
  await expect(blackout).toHaveCount(0);
  await expect(covers.blackout).not.toHaveText(/is on/u);
  expect(await up(win)).toMatchObject({ blackout: false, wallpaper: true });
  await covers.wallpaper.click();
  await expect(wallpaper).toHaveCount(0);
  await expect(slide).toContainText('Placeholder words one');

  // Oops puts the previous slide back and takes off the cover.
  await win.keyboard.press('PageDown');
  await expect(slide).toContainText('Placeholder words two');
  await covers.wallpaper.click();
  await expect(wallpaper).toBeVisible();
  await win.keyboard.press('F9');
  await expect(wallpaper).toHaveCount(0);
  await expect(blackout).toHaveCount(0);
  await expect(slide).toContainText('Placeholder words one');
}

test('Pro Mode: Black-out and the Wallpaper take a playing video off the screen, and putting the video up takes them off; a slide stays under them', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const hall = await oneScreen(win, app);
  const show = await sabha(win);
  await bothWays(
    win,
    hall,
    show,
    { blackout: win.getByTestId('blackout-button'), wallpaper: win.getByTestId('wallpaper-button') },
    'Pro Mode',
  );
  // The bar of clears: with the video up, Background lit; under a cover, it went, and never lit beside the cover.
  await show.video.click();
  const background = win.getByRole('button', { name: /^Clear background/u });
  await expect(background).toHaveAttribute('data-lit', 'true');
  await win.getByTestId('blackout-button').click();
  await expect(background).not.toHaveAttribute('data-lit', 'true');
  await app.close();
});

/** Drag the bar from `from` to `to` (fractions of its width) and hold it there; returns where it is held (ms). */
async function dragAndHold(win: Page, bar: Locator, from: number, to: number): Promise<number> {
  const box = await bar.boundingBox();
  if (!box) throw new Error('the bar is not drawn');
  const y = box.y + box.height / 2;
  await win.mouse.move(box.x + box.width * from, y);
  await win.mouse.down();
  await win.mouse.move(box.x + box.width * to, y, { steps: 8 });
  await expect(bar).toHaveAttribute('data-held', /^\d+$/u);
  return Number(await bar.getAttribute('data-held'));
}

/**
 * Dragging the background video's bar, as an ordinary player: the picture on the screen follows the finger, waiting,
 * paused, at the time under it; let go, it plays on from there, in step with the engine's clock.
 */
async function dragsLikeAPlayer(win: Page, hall: Page, mediaId: string, mode: string): Promise<void> {
  const copies: Copy[] = [{ name: 'the screen', page: hall, selector: onScreen(mediaId) }];
  const bar = row(win, 'background').getByRole('slider', {
    name: 'Time of the background video',
    exact: true,
  });
  await expect(bar, `${mode}: the bar moves`).toBeVisible({ timeout: 15_000 });
  await inStep(copies, () => backgroundTiming(win), `${mode}: playing`);
  const held = await dragAndHold(win, bar, 0.15, 0.6);
  // Held: the screen's picture waits at the time under the finger.
  await expect
    .poll(async () => (await backgroundTiming(win)).seek, `${mode}: the picture follows the drag`)
    .toMatchObject({ toMs: held, paused: true });
  await heldAt(copies, held / 1000, `${mode}: held at three fifths`);
  // Further back while still held: it follows.
  const box = await bar.boundingBox();
  if (!box) throw new Error('the bar is not drawn');
  await win.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2, { steps: 6 });
  const back = Number(await bar.getAttribute('data-held'));
  expect(back).toBeLessThan(held);
  await expect.poll(async () => (await backgroundTiming(win)).seek?.toMs).toBe(back);
  await heldAt(copies, back / 1000, `${mode}: held at three tenths`);
  // Let go: it plays on from there.
  await win.mouse.up();
  await expect
    .poll(async () => (await backgroundTiming(win)).seek, `${mode}: let go, it plays on`)
    .toMatchObject({ toMs: back });
  expect((await backgroundTiming(win)).seek?.paused).toBeUndefined();
  await expect.poll(() => playingThere(hall, mediaId)).toBe('playing');
  await inStep(copies, () => backgroundTiming(win), `${mode}: played on from where it was let go`);
}

test('Pro Mode: dragging LIVE’s time bar moves the video like an ordinary player: the picture follows the finger, and plays on from where it is let go; Esc puts it back', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const hall = await oneScreen(win, app);
  const show = await sabha(win);
  await show.video.click();
  await dragsLikeAPlayer(win, hall, show.mediaId, 'Pro Mode');
  // Esc while dragging: back where it would be had it never moved, playing on.
  const bar = row(win, 'background').getByRole('slider');
  const before = await backgroundTiming(win);
  await dragAndHold(win, bar, 0.2, 0.9);
  await expect.poll(async () => (await backgroundTiming(win)).seek?.paused).toBe(true);
  await bar.press('Escape');
  await win.mouse.up();
  await expect.poll(async () => (await backgroundTiming(win)).seek?.paused).toBeUndefined();
  const after = await backgroundTiming(win);
  const expected = (before.seek?.toMs ?? 0) + ((after.seek?.at ?? 0) - (before.seek?.at ?? 0));
  expect(Math.abs((after.seek?.toMs ?? 0) - expected)).toBeLessThan(300);
  await app.close();
});

test('Simple Mode: the video and the covers one at a time; Pause and Play under LIVE; its time bar dragged like an ordinary player; at 1024 × 645', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const hall = await oneScreen(win, app);
  const show = await sabha(win);
  // CI's operator window, about 1024 × 645.
  await sizeOperatorWindow(app, win, CI_WINDOW);
  await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).dblclick();
  const simple = win.getByTestId('simple-mode');
  await expect(simple).toBeVisible();
  const middle = simple.getByTestId('column-middle');
  const inSimple = {
    mediaId: show.mediaId,
    words: middle.getByTestId('slide-thumb').filter({ hasText: 'Placeholder words one' }),
    video: middle.getByTestId('playlist-item').filter({ hasText: 'Placeholder one at a time clip' }),
  };
  await bothWays(
    win,
    hall,
    inSimple,
    { blackout: win.getByTestId('simple-blackout'), wallpaper: win.getByTestId('simple-wallpaper') },
    'Simple Mode',
  );

  // Pause and Play under LIVE, beside the bar, as Pro Mode has them.
  await inSimple.video.click();
  const bg = row(win, 'background');
  await expect(bg).toBeInViewport({ ratio: 1 });
  const pause = bg.getByRole('button', { name: 'Pause', exact: true });
  await expect(pause).toBeEnabled({ timeout: 15_000 });
  await pause.click();
  await expect.poll(async () => (await backgroundTiming(win)).seek?.paused).toBe(true);
  await expect.poll(() => playingThere(hall, show.mediaId)).toBe('paused');
  await expect(bg.getByTestId('time-bar-paused')).toBeVisible();
  await bg.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => (await backgroundTiming(win)).seek?.paused).toBeUndefined();
  await expect.poll(() => playingThere(hall, show.mediaId)).toBe('playing');
  await expect(bg.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

  // Dragged like an ordinary player, and moved by the arrow keys on the bar.
  await dragsLikeAPlayer(win, hall, show.mediaId, 'Simple Mode');
  const bar = bg.getByRole('slider');
  const at = (await backgroundTiming(win)).seek?.toMs ?? 0;
  await bar.focus();
  await bar.press('ArrowRight');
  await expect.poll(async () => (await backgroundTiming(win)).seek?.toMs ?? 0).toBeGreaterThan(at + 4000);
  await app.close();
});
