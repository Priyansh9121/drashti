import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { clearOfShowControls, expectFits } from './fit';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, launchApp, operatorPage, operatorReady } from './helpers';
import { linkFinished, pasteLink } from './paste-link';
import { testFfmpeg } from './stream-helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The pasted link goes to the playlist open at paste time. With none, the link names its own playlist.
 * The fixture uses fake yt-dlp and generated media in the CI operator window.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

const FAKE = join(__dirname, 'fake-yt-dlp.cjs');
const LINK = 'https://youtu.be/AAAAAAAAAAA?si=placeholderShare';

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);
const tree = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.playlists.tree());
/** A playlist's items, by name, as kept. */
const labels = (win: Page, playlistId: string) =>
  win.evaluate(
    async (id) => (await (globalThis as PageGlobals).drashti.playlists.items(id)).map((i) => i.label),
    playlistId,
  );

/** New playlists, by name; their ids in the same order. */
const newPlaylists = (win: Page, names: string[]) =>
  win.evaluate(async (list) => {
    const d = (globalThis as PageGlobals).drashti;
    const ids: string[] = [];
    for (const name of list) {
      const made = await d.playlists.create(name, null, false);
      ids.push(made.ok ? (made.ids[0] ?? '') : '');
    }
    return ids;
  }, names);

/** Drashti with the fake yt-dlp, in CI's window, saving into a folder of the test's own. */
async function open(extra: Record<string, string> = {}) {
  const work = mkdtempSync(join(tmpdir(), 'drashti-link-playlist-'));
  const { app } = await launchApp({
    DRASHTI_TEST_FAKE_YT_DLP: FAKE,
    DRASHTI_TEST_FAKE_YT_DLP_CONFIG: JSON.stringify({
      log: join(work, 'fake.log'),
      title: 'Placeholder video',
      duration: 65,
    }),
    DRASHTI_TEST_DOWNLOADS_DIR: join(work, 'Videos'),
    ...extra,
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  return { app, win };
}

const cards = (win: Page) => win.getByTestId('open-playlist').getByTestId('playlist-item');

test('without an open playlist a paste makes and opens one, with its new item in view', async () => {
  test.setTimeout(240_000);
  const { app, win } = await open();
  expect(await tree(win)).toEqual([]);
  await chooseMenuItem(app, 'import-from-link');
  await expect(win.getByTestId('link-paste')).toBeInViewport();
  const field = win.getByTestId('link-paste');
  await expectFits(field, 'the link input at 1024 × 645');
  await clearOfShowControls(win, field);
  await expectNoSeriousA11yIssues(win, 'the link input', '[data-testid="link-paste"]');
  await pasteLink(win, LINK);
  await linkFinished(win);
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder video', { timeout: 60_000 });
  const made = (await tree(win)).find((node) => node.name === 'Placeholder video');
  expect(made?.itemCount).toBe(1);
  const card = cards(win).filter({ hasText: 'Placeholder video.mp4' });
  await expect(card).toHaveAttribute('data-marked', 'true');
  await expect(card).toBeInViewport();
  expect((await state(win)).live.playlist).toBeNull();
  await expect(win.getByTestId('import-report')).toHaveCount(0);
  await app.close();
});

test('the open playlist wins over the last-used setting and a click can put the new video up', async () => {
  test.setTimeout(240_000);
  const { app, win } = await open();
  const [sunday = '', youth = ''] = await newPlaylists(win, ['Placeholder Sunday', 'Placeholder Youth']);
  await win.evaluate((id) => (globalThis as PageGlobals).drashti.links.setPlaylist(id), youth);
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder Sunday' }).click();
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder Sunday');
  await chooseMenuItem(app, 'import-from-link');
  await pasteLink(win, LINK);
  await linkFinished(win);
  await expect.poll(() => labels(win, sunday)).toEqual(['Placeholder video.mp4']);
  expect(await labels(win, youth)).toEqual([]);
  expect((await state(win)).live.playlist).toBeNull();
  const video = cards(win).filter({ hasText: 'Placeholder video.mp4' });
  await expect(video).toHaveAttribute('data-marked', 'true');
  await video.click();
  const [item] = await win.evaluate((id) => (globalThis as PageGlobals).drashti.playlists.items(id), sunday);
  await expect.poll(async () => (await state(win)).live.playlist?.itemId).toBe(item?.id);
  await app.close();
});

test('pasting from the playlist targets the playlist open at that moment, even if another opens', async () => {
  test.setTimeout(240_000);
  const { app, win } = await open({ DRASHTI_TEST_ON_AIR_HOOK: '1' });
  const [a = '', b = ''] = await newPlaylists(win, ['Placeholder A', 'Placeholder B']);
  const node = (name: string) => win.getByTestId('playlist-node').filter({ hasText: name });
  const setOnAir = (on: boolean) =>
    app.evaluate((_electron, value) => {
      (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(value);
    }, on);
  await node('Placeholder B').click();
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder B');
  await setOnAir(true);
  await win.getByTestId('playlist-from-link').click();
  await pasteLink(win, LINK);
  await expect(win.getByTestId('link-status')).toContainText('Link check waits');
  await node('Placeholder A').click();
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder A');
  await setOnAir(false);
  await linkFinished(win);
  await expect.poll(() => labels(win, b)).toEqual(['Placeholder video.mp4']);
  expect(await labels(win, a)).toEqual([]);
  await app.close();
});

test('if playlists cannot be read, the download reaches the library and Try again adds it to a playlist', async () => {
  test.setTimeout(180_000);
  const { app, win } = await open({ DRASHTI_TEST_UNREADABLE: 'playlists' });
  await chooseMenuItem(app, 'import-from-link');
  await pasteLink(win, LINK);
  await linkFinished(win);
  const notice = win.getByTestId('import-notice').filter({ hasText: 'couldn’t read the playlists' });
  await expect(notice).toContainText('The download is in the library.');
  await expectNoSeriousA11yIssues(win, 'the notice for unread playlists');
  await app.evaluate(() => {
    (globalThis as { drashtiTestReadable?: (name: string) => void }).drashtiTestReadable?.('playlists');
  });
  await notice.getByRole('button', { name: 'Try again' }).click();
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder video');
  await expect(cards(win).filter({ hasText: 'Placeholder video.mp4' })).toBeInViewport();
  await expect(notice).toHaveCount(0);
  await app.close();
});

test('closing the playlist means the next paste names a new one, including when the old playlist was renamed', async () => {
  test.setTimeout(240_000);
  const { app, win } = await open();
  const [old = ''] = await newPlaylists(win, ['Placeholder Old']);
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder Old' }).click();
  await win.evaluate(
    (id) => (globalThis as PageGlobals).drashti.playlists.rename(id, 'Placeholder Renamed'),
    old,
  );
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder Renamed');
  await win.getByTestId('playlist-close').click();
  await chooseMenuItem(app, 'import-from-link');
  await pasteLink(win, LINK);
  await linkFinished(win);
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder video');
  expect(await labels(win, old)).toEqual([]);
  await expect(cards(win).filter({ hasText: 'Placeholder video.mp4' })).toHaveAttribute(
    'data-marked',
    'true',
  );
  await app.close();
});
