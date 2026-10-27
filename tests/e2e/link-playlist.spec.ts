import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, launchApp, operatorPage, operatorReady } from './helpers';
import { testFfmpeg } from './stream-helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Where a download from a link goes (Session 54, F1; Priyansh: "it should be added to the playlist which is
 * preferred by the user. if there's no playlist, ask the user to create a playlist … if the mp4 is downloaded, it
 * should be shown in the playlist, and 1 click means its live"): Import from a Link offers the playlist chosen
 * last first, kept with the library; with no playlist at all it asks for a new one's name before the download
 * and makes it; when the download is in, that playlist opens with the new item chosen, never up by itself, and
 * one click puts it up. In CI's window, 1024 × 645, through the fake yt-dlp (tests/e2e/fake-yt-dlp.cjs): a
 * made-up video and FFmpeg-made placeholders, never the internet.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

const FAKE = join(__dirname, 'fake-yt-dlp.cjs');
const LINK = 'https://youtu.be/AAAAAAAAAAA?si=placeholderShare';

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);
const tree = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.playlists.tree());
const view = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.links.view());
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
  const chosen = join(work, 'Chosen folder');
  const { app, userData } = await launchApp({
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
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, chosen);
  return { app, win, userData };
}

/** Import from a Link…, YouTube, the made-up link looked at. */
async function lookAtVideo(win: Page): Promise<void> {
  await win.getByTestId('link-kind-youtube').click();
  await win.getByTestId('link-text').fill(LINK);
  await expect(win.getByTestId('link-name')).toHaveText('Placeholder video', { timeout: 60_000 });
}

/** The permission tick, then Download; waits until what it saved is in. */
async function download(win: Page): Promise<void> {
  const tick = win.getByTestId('link-permission');
  await tick.click();
  await expect(tick).toBeChecked();
  await win.getByTestId('link-download').click();
  await expect(win.getByTestId('link-saved')).toBeVisible({ timeout: 120_000 });
}

const cards = (win: Page) => win.getByTestId('open-playlist').getByTestId('playlist-item');

test('with no playlist, it asks for one’s name before the download, makes it, and opens it with the new item shown; next time it offers that one first', async () => {
  test.setTimeout(240_000);
  const { app, win } = await open();
  expect(await tree(win)).toEqual([]);
  await chooseMenuItem(app, 'import-from-link');
  const dialog = win.getByTestId('link-dialog');
  await lookAtVideo(win);

  // No list to choose from (and no "No playlist"): a new playlist's name, asked before the download.
  await expect(win.getByTestId('link-add-to')).toHaveCount(0);
  const name = win.getByTestId('link-new-playlist');
  await expect(name).toHaveValue('Placeholder video');
  await expect(dialog.getByLabel('There are no playlists yet: name one for it')).toBeVisible();
  const tick = win.getByTestId('link-permission');
  await tick.click();
  await expect(tick).toBeChecked();
  const go = win.getByTestId('link-download');
  await expect(go).toBeEnabled();
  // Emptied, Download waits for a name, and says why.
  await name.fill('');
  await expect(go).toBeDisabled();
  await expect(dialog).toContainText('Name the playlist first: the download goes into it.');
  await name.fill('Placeholder Downloads');
  await expect(go).toBeEnabled();
  // In CI's window, its Download in reach and nothing serious for axe.
  await expect(go).toBeInViewport();
  await expectNoSeriousA11yIssues(
    win,
    'Import from a Link asking for a new playlist’s name',
    '[data-testid="link-dialog"]',
  );
  await go.click();
  await expect(win.getByTestId('link-saved')).toBeVisible({ timeout: 120_000 });

  // Made, and opened behind the dialog, the new item chosen and in view; nothing goes up by itself.
  const title = win.getByTestId('open-playlist').getByTestId('playlist-title');
  await expect(title).toHaveText('Placeholder Downloads', { timeout: 60_000 });
  const made = (await tree(win)).find((n) => n.name === 'Placeholder Downloads');
  expect(made?.itemCount).toBe(1);
  const card = cards(win).filter({ hasText: 'Placeholder video.mp4' });
  await expect(card).toHaveAttribute('data-marked', 'true');
  await expect(card).toBeInViewport();
  expect((await state(win)).live.playlist).toBeNull();
  // Remembered: the next download is offered it first, "No playlist" last.
  await expect.poll(async () => (await view(win)).lastPlaylist).toBe(made?.id);
  await win.getByTestId('link-another').click();
  await lookAtVideo(win);
  const target = win.getByTestId('link-add-to');
  await expect(target).toHaveValue(`playlist:${made?.id ?? ''}`);
  await expect(target.locator('option')).toHaveText([
    'Placeholder Downloads (open)',
    'A new playlist, “Placeholder video”',
    'No playlist',
  ]);
  await expect(win.getByTestId('link-new-playlist')).toHaveCount(0);
  await expectNoSeriousA11yIssues(
    win,
    'Import from a Link offering the playlist chosen last',
    '[data-testid="link-dialog"]',
  );
  await app.close();
});

test('it offers the playlist chosen last first, even with another open; the download lands there, which opens with it shown, and one click puts it up', async () => {
  test.setTimeout(300_000);
  const { app, win, userData } = await open();
  const [sunday = '', youth = ''] = await newPlaylists(win, ['Placeholder Sunday', 'Placeholder Youth']);
  const node = (name: string) => win.getByTestId('playlist-node').filter({ hasText: name });
  const title = win.getByTestId('open-playlist').getByTestId('playlist-title');
  await node('Placeholder Sunday').click();
  await expect(title).toHaveText('Placeholder Sunday');

  // Nothing chosen yet: the open playlist to begin with, never "No playlist". Youth is chosen, and the sound.
  await chooseMenuItem(app, 'import-from-link');
  await lookAtVideo(win);
  const target = win.getByTestId('link-add-to');
  await expect(target).toHaveValue(`playlist:${sunday}`);
  await target.selectOption(`playlist:${youth}`);
  await win.getByTestId('link-type-mp3').click();
  await download(win);
  // Youth opens, the sound in it chosen; nothing goes up by itself.
  await expect(title).toHaveText('Placeholder Youth', { timeout: 60_000 });
  await expect(cards(win).filter({ hasText: 'Placeholder video.mp3' })).toHaveAttribute(
    'data-marked',
    'true',
  );
  expect((await state(win)).live.playlist).toBeNull();

  // Sunday open again: the next download is still offered Youth first, the one chosen last.
  await win.getByTestId('link-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await node('Placeholder Sunday').click();
  await expect(title).toHaveText('Placeholder Sunday');
  await chooseMenuItem(app, 'import-from-link');
  await win.getByTestId('link-another').click();
  await lookAtVideo(win);
  await expect(target).toHaveValue(`playlist:${youth}`);
  await expect(target.locator('option')).toHaveText([
    'Placeholder Youth',
    'Placeholder Sunday (open)',
    'A new playlist, “Placeholder video”',
    'No playlist',
  ]);
  await download(win);
  await expect(title).toHaveText('Placeholder Youth', { timeout: 60_000 });
  const video = cards(win).filter({ hasText: 'Placeholder video.mp4' });
  await expect(video).toHaveAttribute('data-marked', 'true');
  await expect(cards(win).filter({ hasText: 'Placeholder video.mp3' })).not.toHaveAttribute(
    'data-marked',
    'true',
  );

  // Ready: with the dialog closed, one click puts it up.
  await win.getByTestId('link-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  const report = win.getByTestId('import-report');
  if (await report.isVisible())
    await report.getByRole('button', { name: 'Close', exact: true }).first().click();
  await video.click();
  const item = (
    await win.evaluate((id) => (globalThis as PageGlobals).drashti.playlists.items(id), youth)
  ).find((i) => i.label === 'Placeholder video.mp4');
  await expect.poll(async () => (await state(win)).live.playlist?.itemId).toBe(item?.id);
  await app.close();

  // Kept with the library's settings, so a backup keeps it.
  const db = new Database(join(userData, 'drashti.sqlite'), { readonly: true });
  const setting = db.prepare("SELECT value FROM app_meta WHERE key = 'setting.links.playlist'").get() as
    { value: string } | undefined;
  db.close();
  expect(setting?.value).toBe(JSON.stringify(youth));
});

test('a playlist’s own From a Link… is where the next download goes, after Another link too, though another went in last', async () => {
  test.setTimeout(300_000);
  const { app, win } = await open();
  const [a = '', b = ''] = await newPlaylists(win, ['Placeholder A', 'Placeholder B']);
  const node = (name: string) => win.getByTestId('playlist-node').filter({ hasText: name });
  const title = win.getByTestId('open-playlist').getByTestId('playlist-title');
  await node('Placeholder A').click();
  await expect(title).toHaveText('Placeholder A');

  // The sound into A, which is the playlist chosen last from then on.
  await chooseMenuItem(app, 'import-from-link');
  await lookAtVideo(win);
  await expect(win.getByTestId('link-add-to')).toHaveValue(`playlist:${a}`);
  await win.getByTestId('link-type-mp3').click();
  await download(win);
  await expect.poll(async () => (await view(win)).lastPlaylist).toBe(a);
  await win.getByTestId('link-dialog').getByRole('button', { name: 'Close', exact: true }).click();

  // B open, its own From a Link… ("add it at the end of this playlist"): the dialog still shows the last
  // download, and Another link keeps B, never the playlist chosen last.
  await node('Placeholder B').click();
  await expect(title).toHaveText('Placeholder B');
  await win.getByTestId('playlist-from-link').click();
  await expect(win.getByTestId('link-saved')).toBeVisible();
  await win.getByTestId('link-another').click();
  await lookAtVideo(win);
  await expect(win.getByTestId('link-add-to')).toHaveValue(`playlist:${b}`);
  await download(win);
  await expect(title).toHaveText('Placeholder B', { timeout: 60_000 });
  await expect(cards(win).filter({ hasText: 'Placeholder video.mp4' })).toHaveAttribute(
    'data-marked',
    'true',
  );
  await expect.poll(() => labels(win, b)).toEqual(['Placeholder video.mp4']);
  expect(await labels(win, a)).toEqual(['Placeholder video.mp3']);
  await expect.poll(async () => (await view(win)).lastPlaylist).toBe(b);
  await app.close();
});

test('with the playlists unread, it says so with Try again, never that there are no playlists, and offers them once read', async () => {
  test.setTimeout(180_000);
  // The playlists' read held failing (Session 39's test switch) until the test makes it readable.
  const { app, win } = await open({ DRASHTI_TEST_UNREADABLE: 'playlists' });
  const [sunday = ''] = await newPlaylists(win, ['Placeholder Sunday']);
  expect(sunday).not.toBe('');
  await chooseMenuItem(app, 'import-from-link');
  await lookAtVideo(win);
  const dialog = win.getByTestId('link-dialog');
  const unread = dialog.getByTestId('playlists-unread');
  await expect(unread).toBeVisible();
  await expect(unread).toContainText('Drashti couldn’t read the playlists');
  await expect(dialog).not.toContainText('There are no playlists yet');
  await expect(dialog.getByLabel('The new playlist’s name')).toHaveValue('Placeholder video');
  await expectNoSeriousA11yIssues(
    win,
    'Import from a Link with the playlists unread',
    '[data-testid="link-dialog"]',
  );
  // Readable again: Try again, in the dialog, brings them to choose from.
  await app.evaluate(() => {
    (globalThis as { drashtiTestReadable?: (name: string) => void }).drashtiTestReadable?.('playlists');
  });
  await dialog.getByTestId('playlists-try-again').click();
  await expect(unread).toHaveCount(0);
  await expect(win.getByTestId('link-add-to').locator('option')).toHaveText([
    'Placeholder Sunday',
    'A new playlist, “Placeholder video”',
    'No playlist',
  ]);
  await app.close();
});

test('the playlist chosen last, renamed, is offered under its new name; deleted, the open playlist is, or with none open a new one’s name', async () => {
  test.setTimeout(240_000);
  const { app, win } = await open();
  const [sunday = '', youth = ''] = await newPlaylists(win, ['Placeholder Sunday', 'Placeholder Youth']);
  const node = (name: string) => win.getByTestId('playlist-node').filter({ hasText: name });
  const title = win.getByTestId('open-playlist').getByTestId('playlist-title');
  const dialog = win.getByTestId('link-dialog');
  const target = win.getByTestId('link-add-to');
  const close = () => dialog.getByRole('button', { name: 'Close', exact: true }).click();

  // The sound into Youth, chosen from the list: the playlist chosen last from then on.
  await chooseMenuItem(app, 'import-from-link');
  await lookAtVideo(win);
  await target.selectOption(`playlist:${youth}`);
  await win.getByTestId('link-type-mp3').click();
  await download(win);
  await expect.poll(async () => (await view(win)).lastPlaylist).toBe(youth);
  await close();
  await node('Placeholder Sunday').click();
  await expect(title).toHaveText('Placeholder Sunday');

  // Renamed: still offered first, under its new name.
  await win.evaluate(
    (id) => (globalThis as PageGlobals).drashti.playlists.rename(id, 'Placeholder Youth renamed'),
    youth,
  );
  await expect(node('Placeholder Youth renamed')).toBeVisible();
  await chooseMenuItem(app, 'import-from-link');
  await win.getByTestId('link-another').click();
  await lookAtVideo(win);
  await expect(target).toHaveValue(`playlist:${youth}`);
  await expect(target.locator('option')).toHaveText([
    'Placeholder Youth renamed',
    'Placeholder Sunday (open)',
    'A new playlist, “Placeholder video”',
    'No playlist',
  ]);

  // Deleted: the open playlist to begin with.
  await win.evaluate((id) => (globalThis as PageGlobals).drashti.playlists.remove([id]), youth);
  await expect(target).toHaveValue(`playlist:${sunday}`);
  await expect(target.locator('option')).toHaveText([
    'Placeholder Sunday (open)',
    'A new playlist, “Placeholder video”',
    'No playlist',
  ]);
  // And with no playlist open, a new one, its name asked for.
  await close();
  await win.getByTestId('playlist-close').click();
  await chooseMenuItem(app, 'import-from-link');
  await expect(target).toHaveValue('new');
  await expect(win.getByTestId('link-new-playlist')).toHaveValue('Placeholder video');
  await expectNoSeriousA11yIssues(
    win,
    'Import from a Link, the playlist chosen last deleted',
    '[data-testid="link-dialog"]',
  );
  await app.close();
});
