import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPEAT_REFUSES } from '../../src/shared/repeat';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, operatorPage, operatorReady } from './helpers';
import { makeTestImage, makeTestVideo } from './test-media';

/*
 * Repeat Slides (Session 26d): a playlist whose pictures and slides go
 * round by themselves. + New › Repeat Slides, its settings, Start, Esc,
 * Stop, another slide going up, black-out over it while it goes on, a
 * slide of its own put up, and Simple Mode starting and stopping it.
 * Generated pictures and placeholder words only; the shortest time each
 * (3 s), so a turn is quick.
 */

const snapshot = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** The step on the screens: its slide's id (an item's id, then its place). */
const stepUp = async (win: Page) => (await snapshot(win)).layers.slide?.slide.id ?? null;

/** A Repeat Slides playlist of two pictures and a presentation of two slides, made in the window. */
async function makeRepeat(win: Page) {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-repeat-'));
  const one = await makeTestImage(win, join(dir, 'Placeholder one.png'), { color: '#1d4e89' });
  const two = await makeTestImage(win, join(dir, 'Placeholder two.png'), { color: '#7c2d12' });
  const words = join(dir, 'Placeholder Repeat Words.txt');
  writeFileSync(words, 'Placeholder first words\n\nPlaceholder second words\n');
  const clip = await makeTestVideo(win, join(dir, 'Placeholder clip.webm'), { seconds: 1, hue: 120 });
  const [oneId = '', twoId = '', wordsId = '', clipId = ''] = await importAndGetIds(win, [
    one,
    two,
    words,
    clip,
  ]);
  return { oneId, twoId, wordsId, clipId };
}

test('Repeat Slides goes round by itself; Esc and Stop leave its slide up; black-out covers it as it goes on; anything else stops it', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  const { oneId, twoId, wordsId, clipId } = await makeRepeat(win);

  // + New › Repeat Slides: made, named at once, opened.
  await win.getByRole('button', { name: 'New playlist or folder' }).click();
  await win.getByRole('menuitem', { name: 'Repeat Slides' }).click();
  await win.getByRole('textbox', { name: 'Playlist name' }).fill('Placeholder Lobby');
  await win.keyboard.press('Enter');
  const node = win.getByTestId('playlist-node').filter({ hasText: 'Placeholder Lobby' });
  await expect(node).toHaveAttribute('data-playlist-kind', 'repeat');
  const playlistId = (await node.getAttribute('data-node-id')) ?? '';
  await node.click();
  await expect(win.getByTestId('repeat-bar')).toBeVisible();
  await expect(win.getByTestId('repeat-seconds')).toHaveValue('15');
  await expect(win.getByTestId('repeat-transition')).toHaveValue('dissolve');
  await expect(win.getByTestId('repeat-transition-seconds')).toHaveValue('1');

  // Pictures and a presentation go in; a video is refused, saying why.
  const add = (items: unknown[]) =>
    win.evaluate(
      ({ id, items }) => (globalThis as PageGlobals).drashti.playlists.addItems(id, null, items as never),
      { id: playlistId, items },
    );
  expect(await add([{ kind: 'media', mediaId: clipId }])).toEqual({ ok: false, message: REPEAT_REFUSES });
  expect(
    await add([
      { kind: 'media', mediaId: oneId },
      { kind: 'presentation', presentationId: wordsId },
      { kind: 'media', mediaId: twoId },
    ]),
  ).toMatchObject({ ok: true });
  await expect(win.getByTestId('open-playlist').getByTestId('playlist-item')).toHaveCount(3);

  // Its settings: 3 s each, a fade through black of half a second.
  await win.getByTestId('repeat-seconds').fill('3');
  await win.getByTestId('repeat-transition').selectOption('fade-black');
  await win.getByTestId('repeat-transition-seconds').fill('0.5');
  await expect
    .poll(async () => {
      const tree = await win.evaluate(() => (globalThis as PageGlobals).drashti.playlists.tree());
      return tree.find((n) => n.id === playlistId)?.repeat;
    })
    .toEqual({ secondsEach: 3, transition: { kind: 'fade-black', durationMs: 500 } });
  await expectNoSeriousA11yIssues(win, 'a Repeat Slides playlist', '[data-testid="open-playlist"]');

  // Start: the first picture, then on by itself, the last back to the first.
  await win.getByTestId('repeat-start').click();
  await expect.poll(() => stepUp(win)).toMatch(/\/picture$/u);
  const first = await stepUp(win);
  await expect(win.getByTestId('live-repeating')).toContainText('Repeating · Placeholder Lobby');
  await expect(win.getByTestId('repeat-row-stop')).toBeVisible();
  const state = await snapshot(win);
  expect(state.repeat).toEqual({ playlistId, name: 'Placeholder Lobby' });
  // Each slide comes on by its transition, the first too.
  expect(state.layers.slide?.transition).toEqual({ kind: 'fade-black', durationMs: 500 });
  await expect.poll(() => stepUp(win), { timeout: 10_000 }).toMatch(/\/0$/u);
  expect((await snapshot(win)).layers.slide?.transition).toEqual({ kind: 'fade-black', durationMs: 500 });
  await expect.poll(() => stepUp(win), { timeout: 10_000 }).toMatch(/\/1$/u);
  await expect.poll(() => stepUp(win), { timeout: 10_000 }).not.toMatch(/\/1$/u);
  await expect.poll(() => stepUp(win), { timeout: 10_000 }).toBe(first);

  // Esc stops it: the slide stays on the screens, and nothing moves on.
  await win.locator('body').focus();
  await win.keyboard.press('Escape');
  await expect.poll(async () => (await snapshot(win)).repeat).toBeNull();
  const kept = await stepUp(win);
  expect(kept).not.toBeNull();
  await expect(win.getByTestId('live-repeating')).toHaveCount(0);
  await win.waitForTimeout(4000);
  expect(await stepUp(win)).toBe(kept);
  expect((await snapshot(win)).autoAdvance).toBeNull();

  // Black-out covers it while it goes round underneath.
  await win.getByTestId('repeat-start').click();
  await expect.poll(async () => (await snapshot(win)).repeat?.playlistId).toBe(playlistId);
  const before = await stepUp(win);
  await win.keyboard.press('b');
  await expect.poll(async () => (await snapshot(win)).blackout).toBe(true);
  await expect.poll(() => stepUp(win), { timeout: 10_000 }).not.toBe(before);
  expect((await snapshot(win)).repeat).not.toBeNull();
  await win.keyboard.press('b');

  // LIVE's Stop does what Esc does.
  await win.getByTestId('live-repeat-stop').click();
  await expect.poll(async () => (await snapshot(win)).repeat).toBeNull();

  // A slide of its own put up starts it from there: its card shows its steps, a click on one goes.
  await win.getByTestId('open-playlist').getByTestId('playlist-item').nth(1).click();
  await expect(win.getByTestId('slide-grid')).toHaveAttribute('data-presentation-id', `repeat:${playlistId}`);
  await expect(win.getByTestId('repeat-note')).toBeVisible();
  await expect(win.getByTestId('slide-grid').getByTestId('slide-thumb')).toHaveCount(4);
  await win.getByTestId('slide-grid').getByTestId('slide-thumb').nth(2).click();
  await expect.poll(() => stepUp(win)).toMatch(/\/1$/u);
  expect((await snapshot(win)).repeat?.playlistId).toBe(playlistId);

  // Anything else going up stops it.
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'goLive',
        presentationId: id,
        slideIndex: 0,
      }),
    wordsId,
  );
  await expect.poll(async () => (await snapshot(win)).repeat).toBeNull();
  await expect(win.getByTestId('repeat-row-start')).toBeVisible();
  await app.close();
});

test('Simple Mode starts and stops Repeat Slides, and changes none of its settings', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const { oneId, twoId } = await makeRepeat(win);
  const playlistId = await win.evaluate(
    async ({ oneId, twoId }) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.playlists.createRepeat(null);
      const id = made.ok ? (made.ids[0] ?? '') : '';
      await d.playlists.rename(id, 'Placeholder Hall Pictures');
      await d.playlists.addItems(id, null, [
        { kind: 'media', mediaId: oneId },
        { kind: 'media', mediaId: twoId },
      ]);
      await d.playlists.setRepeat(id, { secondsEach: 3, transition: { kind: 'dissolve', durationMs: 500 } });
      return id;
    },
    { oneId, twoId },
  );
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await win.getByTestId('simple-playlist').selectOption(playlistId);
  await expect(win.getByTestId('simple-repeat-start')).toBeVisible();
  // Next with nothing up starts it going round, as its Start does.
  await win.locator('body').focus();
  await win.keyboard.press('Space');
  await expect.poll(async () => (await snapshot(win)).repeat?.playlistId).toBe(playlistId);
  const first = await stepUp(win);
  await expect.poll(() => stepUp(win), { timeout: 10_000 }).not.toBe(first);
  await expect(win.getByTestId('simple-items').locator('[data-live="true"]')).toHaveCount(1);
  await win.keyboard.press('Escape');
  await expect.poll(async () => (await snapshot(win)).repeat).toBeNull();
  await win.getByTestId('simple-repeat-start').click();
  await expect.poll(async () => (await snapshot(win)).repeat?.playlistId).toBe(playlistId);
  await win.getByTestId('simple-repeat-stop').click();
  await expect.poll(async () => (await snapshot(win)).repeat).toBeNull();
  // Its settings stay as they are.
  const changed = await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.playlists.setRepeat(id, {
        secondsEach: 10,
        transition: { kind: 'cut', durationMs: 0 },
      }),
    playlistId,
  );
  expect(changed).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
  await app.close();
});
