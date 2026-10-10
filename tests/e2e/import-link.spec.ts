import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestPptx } from '../../src/main/import/testing/make-pptx';
import { makeZip } from '../../src/main/import/testing/zip-writer';
import { expectNoSeriousA11yIssues } from './a11y';
import { dropboxStandIn, fileLink, folderLink, type StandIn } from './dropbox-stand-in';
import { chooseMenuItem, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { testFfmpeg } from './stream-helpers';

/*
 * Import from a Link (Session 25b), Dropbox: a local stand-in serves made-up
 * links (no test contacts the internet: the guard refuses anything but
 * 127.0.0.1), with FFmpeg-made placeholder videos and a placeholder
 * PowerPoint file.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

function makeVideo(path: string, size: string): Buffer {
  const r = spawnSync(ffmpeg ?? '', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=s=${size}:r=25`,
    '-f',
    'lavfi',
    '-i',
    'sine=r=48000',
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    path,
  ]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return readFileSync(path);
}

const setOnAir = (app: ElectronApplication, on: boolean) =>
  app.evaluate((_electron, value) => {
    (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(value);
  }, on);

const listMedia = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia());

/** Every file under a folder, as paths inside it. */
const filesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) =>
      join(e.parentPath, e.name)
        .slice(dir.length + 1)
        .split(/[\\/]/u)
        .join('/'),
    )
    .sort();

let standIn: StandIn | null = null;
test.afterEach(async () => {
  await standIn?.close();
  standIn = null;
});

test('Dropbox: a file link and a folder link are saved in the chosen folder, then imported; on air holds it back', async () => {
  test.setTimeout(240_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-link-e2e-'));
  const media = join(work, 'made');
  mkdirSync(media);
  const clip = makeVideo(join(media, 'clip.mp4'), '640x360');
  const full = makeVideo(join(media, 'full.mp4'), '1920x1080');
  const zip = makeZip([
    {
      name: 'Placeholder deck.pptx',
      data: makeTestPptx([{ color: '1E3A8A', text: 'Placeholder slide', notes: 'Placeholder note' }]),
    },
    { name: 'Videos/Placeholder 1080p.mp4', data: full },
    { name: 'Read me.txt', data: 'placeholder words' },
  ]);
  standIn = await dropboxStandIn(
    { clipAAAAAAAAAAA: { name: 'Placeholder clip.mp4', body: clip, type: 'video/mp4' } },
    { foldAAAAAAAAAAA: { name: 'Placeholder folder.zip', body: zip, type: 'application/zip' } },
  );
  const downloads = join(work, 'Videos');
  const chosen = join(work, 'Chosen folder');
  const { app } = await launchApp({
    DRASHTI_TEST_LINK_ORIGIN: standIn.origin,
    DRASHTI_TEST_DOWNLOADS_DIR: downloads,
    DRASHTI_TEST_ON_AIR_HOOK: '1',
    // As if this computer had no Keynote or PowerPoint (CI's have neither), so the report says so.
    DRASHTI_TEST_NO_CONVERTER: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);

  // File > Import from a Link…: which kind first; YouTube shows, but cannot be picked yet, and says why.
  await chooseMenuItem(app, 'import-from-link');
  const dialog = win.getByTestId('link-dialog');
  await expect(dialog).toBeVisible();
  await expect(win.getByTestId('link-kind-youtube')).toBeDisabled();
  await expect(win.getByTestId('link-kind-youtube-hint')).toContainText('YouTube Studio');
  await expect(win.getByTestId('link-text')).toHaveCount(0);
  await win.getByTestId('link-kind-dropbox').click();
  await expect(win.getByTestId('link-kind-dropbox')).toHaveAttribute('aria-checked', 'true');

  // A link that is not Dropbox's is refused plainly.
  await win.getByTestId('link-text').fill('https://example.net/scl/fi/abc/x.mp4');
  await expect(dialog).toContainText('not a Dropbox link');

  // The file link: what it holds, before anything is downloaded.
  await win.getByTestId('link-text').fill(fileLink('clipAAAAAAAAAAA', 'Placeholder clip.mp4'));
  await expect(win.getByTestId('link-name')).toHaveText('Placeholder clip.mp4');
  await expect(win.getByTestId('link-holds')).toContainText('A file');
  // The first time, it saves in "Drashti downloads" in Videos (Movies on a Mac); then where it is told.
  await expect(win.getByTestId('link-folder')).toHaveText(join(downloads, 'Drashti downloads'));
  await app.evaluate(({ dialog: d }, folder) => {
    d.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, chosen);
  await win.getByTestId('link-choose-folder').click();
  await expect(win.getByTestId('link-folder')).toHaveText(chosen);
  await expectNoSeriousA11yIssues(win, 'the Import from a Link dialog', '[data-testid="link-dialog"]');

  // On air: the download waits, asking nothing of Dropbox, and says so.
  await setOnAir(app, true);
  const asked = standIn.requests.length;
  await win.getByTestId('link-download').click();
  await expect(win.getByTestId('link-going')).toHaveAttribute('data-phase', 'waiting');
  await expect(win.getByTestId('link-going-words')).toContainText('the stream is on air or recording');
  // Closing the dialog never stops it: the status bar shows it, and opens the dialog again.
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const status = win.getByTestId('link-status');
  await expect(status).toHaveAttribute('data-phase', 'waiting');
  await win.waitForTimeout(2500);
  expect(standIn.requests.length).toBe(asked);
  await status.click();
  await expect(dialog).toBeVisible();
  await setOnAir(app, false);

  // Off air: it downloads, saves under Dropbox's name, and imports.
  await expect(win.getByTestId('link-saved')).toBeVisible({ timeout: 60_000 });
  await expect(win.getByTestId('link-saved-folder')).toHaveText(chosen);
  expect(readFileSync(join(chosen, 'Placeholder clip.mp4')).equals(clip)).toBe(true);
  const report = win.getByTestId('import-report');
  await expect(report).toBeVisible({ timeout: 60_000 });
  await expect(report.getByTestId('report-item').first()).toHaveAttribute('data-outcome', 'imported');
  await report.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect.poll(async () => (await listMedia(win)).map((m) => m.name)).toContain('Placeholder clip.mp4');

  // The folder link: one zip, unpacked into a folder of its own.
  await chooseMenuItem(app, 'import-from-link');
  await win.getByTestId('link-another').click();
  await win.getByTestId('link-kind-dropbox').click();
  await win.getByTestId('link-text').fill(folderLink('foldAAAAAAAAAAA'));
  await expect(win.getByTestId('link-name')).toHaveText('Placeholder folder');
  await expect(win.getByTestId('link-holds')).toContainText('A folder');
  await win.getByTestId('link-download').click();
  await expect(win.getByTestId('link-saved')).toBeVisible({ timeout: 60_000 });
  const folder = join(chosen, 'Placeholder folder');
  await expect(win.getByTestId('link-saved-folder')).toHaveText(folder);
  expect(filesIn(folder)).toEqual(['Placeholder deck.pptx', 'Read me.txt', 'Videos/Placeholder 1080p.mp4']);
  expect(readFileSync(join(folder, 'Videos', 'Placeholder 1080p.mp4')).equals(full)).toBe(true);
  // The .txt is saved but not taken, with the reason.
  await expect(win.getByTestId('link-not-taken-item')).toHaveCount(1);
  await expect(win.getByTestId('link-not-taken-item')).toContainText('Read me.txt');
  await expect(win.getByTestId('link-not-taken-item')).toContainText('not imported');
  // The PowerPoint went through the PowerPoint route (which says so plainly with no Keynote or PowerPoint
  // here), and the video into the library.
  await expect(report).toBeVisible({ timeout: 60_000 });
  const items = report.getByTestId('report-item');
  await expect(items).toHaveCount(2);
  await expect(items.filter({ hasText: 'Placeholder deck' })).toContainText('no Keynote or PowerPoint');
  await expect(items.filter({ hasText: 'Placeholder 1080p' })).toHaveAttribute('data-outcome', 'imported');
  await expect.poll(async () => (await listMedia(win)).map((m) => m.name)).toContain('Placeholder 1080p.mp4');

  // Nothing of the downloads is left behind (no part-file, no work folder), and nothing was ever asked of
  // anything but Dropbox's own addresses (the stand-in, through the guard).
  expect(readdirSync(chosen).sort()).toEqual(['Placeholder clip.mp4', 'Placeholder folder']);
  for (const r of standIn.requests)
    expect(r.host).toMatch(/^(www\.dropbox\.com|uc\w+\.dl\.dropboxusercontent\.com)$/u);
  expect(existsSync(join(downloads, 'Drashti downloads'))).toBe(false);
  await app.close();
});

test('Dropbox: a video above 1080p ends as a 1080p copy in the library, the original untouched in the folder', async () => {
  test.setTimeout(240_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-link-e2e-'));
  const media = join(work, 'made');
  mkdirSync(media);
  const big = makeVideo(join(media, 'big.mp4'), '3840x2160');
  standIn = await dropboxStandIn(
    { bigAAAAAAAAAAAA: { name: 'Placeholder 2160p.mp4', body: big, type: 'video/mp4' } },
    {},
  );
  const chosen = join(work, 'Chosen folder');
  const { app, userData } = await launchApp({
    DRASHTI_TEST_LINK_ORIGIN: standIn.origin,
    DRASHTI_TEST_DOWNLOADS_DIR: join(work, 'Videos'),
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await app.evaluate(({ dialog, shell }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
    // Show in Finder (Explorer): what it would show.
    shell.showItemInFolder = (path) => {
      (globalThis as { shown?: string[] }).shown = [
        ...((globalThis as { shown?: string[] }).shown ?? []),
        path,
      ];
    };
  }, chosen);

  // From the library's Import menu this time.
  await win.getByRole('button', { name: 'Import…' }).click();
  await win.getByRole('menuitem', { name: 'From a link…' }).click();
  await win.getByTestId('link-kind-dropbox').click();
  await win.getByTestId('link-text').fill(fileLink('bigAAAAAAAAAAAA', 'Placeholder 2160p.mp4'));
  await expect(win.getByTestId('link-name')).toHaveText('Placeholder 2160p.mp4');
  await win.getByTestId('link-choose-folder').click();
  await expect(win.getByTestId('link-folder')).toHaveText(chosen);
  await win.getByTestId('link-download').click();

  // Saved; made 1080p for the library; imported.
  await expect(win.getByTestId('link-fitted-item')).toHaveText('Placeholder 2160p.mp4', { timeout: 120_000 });
  const report = win.getByTestId('import-report');
  await expect(report).toBeVisible({ timeout: 60_000 });
  await expect(report.getByTestId('report-item').first()).toHaveAttribute('data-outcome', 'imported');
  // The report says where the files were saved, and shows them.
  await expect(report.getByTestId('report-saved-in')).toContainText(chosen);
  await report.getByTestId('report-show-saved').click();
  await expect
    .poll(() => app.evaluate(() => (globalThis as { shown?: string[] }).shown ?? []))
    .toEqual([join(chosen, 'Placeholder 2160p.mp4')]);

  // The original, 2160p, is in the folder as it came.
  expect(readdirSync(chosen)).toEqual(['Placeholder 2160p.mp4']);
  expect(readFileSync(join(chosen, 'Placeholder 2160p.mp4')).equals(big)).toBe(true);
  // The library's copy is 1080p (H.264), and no copy is left in Drashti's work folder.
  const db = new Database(join(userData, 'drashti.sqlite'), { readonly: true });
  const row = db.prepare('SELECT path FROM media WHERE name = ?').get('Placeholder 2160p.mp4') as
    { path: string } | undefined;
  db.close();
  expect(row).toBeDefined();
  const stored = spawnSync(ffmpeg ?? '', [
    '-hide_banner',
    '-i',
    join(userData, 'Media', row?.path ?? ''),
  ]).stderr.toString();
  expect(stored).toMatch(/Video: h264/u);
  expect(stored).toMatch(/1920x1080/u);
  expect(
    existsSync(join(userData, 'Link downloads')) ? readdirSync(join(userData, 'Link downloads')) : [],
  ).toEqual([]);
  await app.close();
});
