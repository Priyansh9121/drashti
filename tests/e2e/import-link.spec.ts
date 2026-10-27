import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestPdf } from '../../src/main/import/testing/make-pdf';
import { makeTestPptx } from '../../src/main/import/testing/make-pptx';
import { makeDropboxLikeZip, makeZip } from '../../src/main/import/testing/zip-writer';
import { expectNoSeriousA11yIssues } from './a11y';
import { dropboxStandIn, fileLink, folderLink, type StandIn, type StandInFile } from './dropbox-stand-in';
import {
  chooseMenuItem,
  holdStill,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  type PageGlobals,
} from './helpers';
import { testFfmpeg } from './stream-helpers';
import { makeTestImage } from './test-media';

/*
 * Import from a Link (Session 25b), Dropbox: a local stand-in serves made-up
 * links (no test contacts the internet: the guard refuses anything but
 * 127.0.0.1), with FFmpeg-made placeholder videos and a placeholder
 * PowerPoint file.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');
/** Cmd on a Mac, Ctrl on Windows: a click with it only marks a playlist's card (a plain one puts a video up). */
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

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

  // File > Import from a Link…: which kind first (YouTube's own test is import-youtube.spec.ts).
  await chooseMenuItem(app, 'import-from-link');
  const dialog = win.getByTestId('link-dialog');
  await expect(dialog).toBeVisible();
  await expect(win.getByTestId('link-kind-youtube-hint')).toContainText('only the mandir’s own');
  await expect(win.getByTestId('link-text')).toHaveCount(0);
  await win.getByTestId('link-kind-dropbox').click();
  await expect(win.getByTestId('link-kind-dropbox')).toHaveAttribute('aria-checked', 'true');

  // A link that is not Dropbox's is refused plainly, its help said once (Session 25b's report: it was twice).
  const help = dialog.getByText('In Dropbox, use Share, then Copy link.', { exact: true });
  await expect(help).toBeVisible();
  await win.getByTestId('link-text').fill('https://example.net/scl/fi/abc/x.mp4');
  await expect(dialog).toContainText('not a Dropbox link');
  await expect(dialog).toContainText('use Share, then Copy link, and paste that here');
  await expect(help).toHaveCount(0);

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
  await holdStill(
    () => standIn?.requests.length === asked,
    2500,
    'with the dialog closed, nothing more is fetched on air',
  );
  await status.click();
  await expect(dialog).toBeVisible();
  await setOnAir(app, false);

  // Off air: it downloads, saves under Dropbox's name, and imports.
  await expect(win.getByTestId('link-saved')).toBeVisible({ timeout: 60_000 });
  await expect(win.getByTestId('link-saved-folder')).toHaveText(chosen);
  expect(readFileSync(join(chosen, 'Placeholder clip.mp4')).equals(clip)).toBe(true);
  // With the dialog open, the report waits to be asked for: it never opens over the dialog.
  const report = win.getByTestId('import-report');
  await expect(win.getByTestId('link-open-report')).toBeVisible({ timeout: 60_000 });
  await expect(report).toHaveCount(0);
  await win.getByTestId('link-open-report').click();
  await expect(report).toBeVisible();
  await expect(dialog).toHaveCount(0);
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
  // Held on air until the dialog is closed, so it is closed while it goes (a quick runner could finish
  // the import first, and then the dialog, not the report, offers it: CI run 38600932674).
  await setOnAir(app, true);
  await win.getByTestId('link-download').click();
  await expect(win.getByTestId('link-going')).toHaveAttribute('data-phase', 'waiting');
  // Closed while it goes: then the report comes up by itself when the import ends, as an import's does.
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await setOnAir(app, false);
  await expect(report).toBeVisible({ timeout: 60_000 });
  await report.getByRole('button', { name: 'Close', exact: true }).first().click();
  await chooseMenuItem(app, 'import-from-link');
  await expect(win.getByTestId('link-saved')).toBeVisible({ timeout: 60_000 });
  const folder = join(chosen, 'Placeholder folder');
  await expect(win.getByTestId('link-saved-folder')).toHaveText(folder);
  expect(filesIn(folder)).toEqual(['Placeholder deck.pptx', 'Read me.txt', 'Videos/Placeholder 1080p.mp4']);
  expect(readFileSync(join(folder, 'Videos', 'Placeholder 1080p.mp4')).equals(full)).toBe(true);
  // The .txt is saved but not taken, with the reason.
  await expect(win.getByTestId('link-not-taken-item')).toHaveCount(1);
  await expect(win.getByTestId('link-not-taken-item')).toContainText('Read me.txt');
  await expect(win.getByTestId('link-not-taken-item')).toContainText('not imported');
  await expectNoSeriousA11yIssues(win, 'the Import from a Link dialog, done', '[data-testid="link-dialog"]');
  // The PowerPoint went through the PowerPoint route (which says so plainly with no Keynote or PowerPoint
  // here), and the video into the library.
  await win.getByTestId('link-open-report').click();
  await expect(report).toBeVisible();
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

test('Dropbox: a folder zipped as Dropbox zips it (a "/" entry, loose parts, data descriptors) is unpacked with its subfolders and imported', async () => {
  test.setTimeout(240_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-link-e2e-'));
  const media = join(work, 'made');
  mkdirSync(media);
  const clip = makeVideo(join(media, 'clip.mp4'), '640x360');
  // Another video (the library shares a file's row with any other of the same bytes).
  const opening = makeVideo(join(media, 'opening.mp4'), '320x180');
  // Placeholder names with spaces, Gujarati and Hindi, three folders deep (PLAN §6).
  const zip = makeDropboxLikeZip([
    { path: 'Opening video.mp4', data: opening },
    {
      path: 'Week 1/Decks/Placeholder katha.pptx',
      data: makeTestPptx([{ color: '7C2D12', text: 'Placeholder slide', notes: '' }]),
    },
    { path: 'Week 1/Videos/Deep folder/પ્રવચન ભાગ 1.mp4', data: clip },
    { path: 'Week 2/सभा नोट्स.txt', data: 'placeholder words' },
  ]);
  standIn = await dropboxStandIn(
    {},
    { foldBBBBBBBBBBB: { name: 'Placeholder Dropbox folder.zip', body: zip, type: 'application/zip' } },
  );
  const chosen = join(work, 'Chosen folder');
  const { app } = await launchApp({
    DRASHTI_TEST_LINK_ORIGIN: standIn.origin,
    DRASHTI_TEST_DOWNLOADS_DIR: join(work, 'Videos'),
    DRASHTI_TEST_NO_CONVERTER: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, chosen);
  await chooseMenuItem(app, 'import-from-link');
  await win.getByTestId('link-kind-dropbox').click();
  await win.getByTestId('link-text').fill(folderLink('foldBBBBBBBBBBB'));
  await expect(win.getByTestId('link-holds')).toContainText('A folder');
  await win.getByTestId('link-choose-folder').click();
  await win.getByTestId('link-download').click();

  // Unpacked (alpha.3 refused it: "would leave the folder"), every subfolder kept.
  await expect(win.getByTestId('link-saved')).toBeVisible({ timeout: 120_000 });
  await expect(win.getByTestId('link-dialog')).not.toContainText('would leave the folder');
  const folder = join(chosen, 'Placeholder Dropbox folder');
  expect(filesIn(folder)).toEqual(
    [
      'Opening video.mp4',
      'Week 1/Decks/Placeholder katha.pptx',
      'Week 1/Videos/Deep folder/પ્રવચન ભાગ 1.mp4',
      'Week 2/सभा नोट्स.txt',
    ].sort(),
  );
  expect(readFileSync(join(folder, 'Week 1', 'Videos', 'Deep folder', 'પ્રવચન ભાગ 1.mp4')).equals(clip)).toBe(
    true,
  );
  await expect(win.getByTestId('link-not-taken-item')).toHaveCount(1);
  // Both videos reach the library, and the deck goes through the import (no converter here, so it says so).
  await expect
    .poll(async () => (await listMedia(win)).map((m) => m.name).sort(), { timeout: 60_000 })
    .toEqual(expect.arrayContaining(['Opening video.mp4', 'પ્રવચન ભાગ 1.mp4']));
  await win.getByTestId('link-open-report').click({ timeout: 60_000 });
  const report = win.getByTestId('import-report');
  await expect(report.getByTestId('report-item')).toHaveCount(3);
  await expect(report.getByTestId('report-item').filter({ hasText: 'Placeholder katha' })).toContainText(
    'no Keynote or PowerPoint',
  );
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
  await openLibrary(win);
  await win.getByRole('button', { name: 'Import…' }).click();
  await win.getByRole('menuitem', { name: 'From a Link…' }).click();
  await win.getByTestId('link-kind-dropbox').click();
  await win.getByTestId('link-text').fill(fileLink('bigAAAAAAAAAAAA', 'Placeholder 2160p.mp4'));
  await expect(win.getByTestId('link-name')).toHaveText('Placeholder 2160p.mp4');
  await win.getByTestId('link-choose-folder').click();
  await expect(win.getByTestId('link-folder')).toHaveText(chosen);
  await win.getByTestId('link-download').click();

  // Saved; made 1080p for the library; imported.
  await expect(win.getByTestId('link-fitted-item')).toHaveText('Placeholder 2160p.mp4', { timeout: 120_000 });
  const report = win.getByTestId('import-report');
  await win.getByTestId('link-open-report').click();
  await expect(report).toBeVisible({ timeout: 60_000 });
  await expect(report.getByTestId('report-item').first()).toHaveAttribute('data-outcome', 'imported');
  // The report says which video is a copy made 1080p (Session 25b's report: it did not).
  await expect(report.getByTestId('report-fitted')).toContainText('1080p copy');
  await expect(report.getByTestId('report-fitted')).toContainText('Placeholder 2160p.mp4');
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

test('Dropbox: with the highest video quality at 2160p, a 2160p video is imported as it is, with no copy', async () => {
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
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, chosen);

  // The admin's setting, in the dialog: 1080p to begin with, then 2160p (4K).
  await chooseMenuItem(app, 'import-from-link');
  const quality = win.getByTestId('link-max-height');
  await expect(quality).toHaveValue('1080');
  await expect(quality.locator('option')).toHaveText(['1080p', '1440p', '2160p (4K)', '4320p (8K)']);
  await quality.selectOption('2160');
  await expect(quality).toHaveValue('2160');
  await win.getByTestId('link-kind-dropbox').click();
  await win.getByTestId('link-text').fill(fileLink('bigAAAAAAAAAAAA', 'Placeholder 2160p.mp4'));
  await expect(win.getByTestId('link-holds')).toContainText('videos at 2160p (4K) at most');
  await win.getByTestId('link-choose-folder').click();
  await win.getByTestId('link-download').click();

  // Saved and imported as it came: nothing made smaller.
  await expect(win.getByTestId('link-saved')).toBeVisible({ timeout: 120_000 });
  const report = win.getByTestId('import-report');
  await expect(win.getByTestId('link-fitted')).toHaveCount(0);
  await win.getByTestId('link-open-report').click({ timeout: 60_000 });
  await expect(report).toBeVisible({ timeout: 60_000 });
  await expect(report.getByTestId('report-fitted')).toHaveCount(0);
  await expect(report.getByTestId('report-item').first()).toHaveAttribute('data-outcome', 'imported');
  await expect(win.getByTestId('link-fitted')).toHaveCount(0);
  const db = new Database(join(userData, 'drashti.sqlite'), { readonly: true });
  const row = db.prepare('SELECT path FROM media WHERE name = ?').get('Placeholder 2160p.mp4') as
    { path: string } | undefined;
  // Kept with the library's settings, so a backup keeps it.
  const setting = db.prepare("SELECT value FROM app_meta WHERE key = 'setting.links.maxHeight'").get() as
    { value: string } | undefined;
  db.close();
  expect(setting?.value).toBe('2160');
  expect(row).toBeDefined();
  expect(readFileSync(join(userData, 'Media', row?.path ?? '')).equals(big)).toBe(true);
  await app.close();
});

test('Dropbox: a folder link becomes one playlist, folder by folder, with headers; its PDFs and pictures wait for one button (Session 26c)', async () => {
  test.setTimeout(300_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-link-e2e-'));
  const media = join(work, 'made');
  mkdirSync(media);
  // Every video different (the library shares the rows of files with the same bytes).
  const video = (name: string, size: string) => makeVideo(join(media, name), size);
  const deck = (text: string) => makeTestPptx([{ color: '1E3A8A', text, notes: '' }]);
  // Served once the zip is made (it holds a picture, which needs the window to draw it).
  const folders: Record<string, StandInFile> = {};
  standIn = await dropboxStandIn({}, folders);
  const chosen = join(work, 'Chosen folder');
  const { app } = await launchApp({
    DRASHTI_TEST_LINK_ORIGIN: standIn.origin,
    DRASHTI_TEST_DOWNLOADS_DIR: join(work, 'Videos'),
    // The stand-in saves the .pptx files as PDF, as PowerPoint would (CI has no PowerPoint).
    DRASHTI_TEST_DECK_CONVERTER: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, chosen);
  const picture = await makeTestImage(win, join(media, 'Darshan.png'), { color: '#7c2d12' });
  const zip = makeDropboxLikeZip([
    { path: 'Opening video.mp4', data: video('a.mp4', '320x180') },
    { path: 'Welcome.pptx', data: deck('Placeholder welcome') },
    { path: 'Read me.txt', data: 'placeholder words' },
    {
      path: 'Notice.pdf',
      data: makeTestPdf([{ width: 960, height: 540, color: [20, 83, 45], text: 'Notice' }]),
    },
    { path: 'Week 1/Katha 10.pptx', data: deck('Placeholder katha ten') },
    { path: 'Week 1/Katha 2.pptx', data: deck('Placeholder katha two') },
    {
      path: 'Week 1/Handout.pdf',
      data: makeTestPdf([{ width: 960, height: 540, color: [88, 28, 135], text: 'Handout' }]),
    },
    { path: 'Week 1/Videos/Clip b.mp4', data: video('b.mp4', '352x198') },
    { path: 'Week 1/Videos/Clip A.mp4', data: video('c.mp4', '384x216') },
    { path: 'Week 1/Videos/Deep/Third.mp4', data: video('d.mp4', '416x234') },
    // A folder with only a picture: it gets a part, and its header, when the button adds it.
    { path: 'Week 2/Darshan.png', data: readFileSync(picture) },
  ]);
  folders['foldCCCCCCCCCCC'] = { name: 'Placeholder Sabha folder.zip', body: zip, type: 'application/zip' };
  // A playlist already named like the folder: the new one is "… (2)".
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.playlists.create('Placeholder Sabha folder', null, false),
  );
  await chooseMenuItem(app, 'import-from-link');
  await win.getByTestId('link-kind-dropbox').click();
  await win.getByTestId('link-text').fill(folderLink('foldCCCCCCCCCCC'));
  await expect(win.getByTestId('link-holds')).toContainText('A folder');
  await expect(win.getByTestId('link-folder-playlist')).toContainText('a playlist of its own');
  await win.getByTestId('link-choose-folder').click();
  await win.getByTestId('link-download').click();

  // Made at the top of the list, and opened, in the folders' order with a header for each subfolder.
  const title = win.getByTestId('open-playlist').getByTestId('playlist-title');
  await expect(title).toHaveText('Placeholder Sabha folder (2)', { timeout: 180_000 });
  await expect(win.getByTestId('playlist-node').first()).toContainText('Placeholder Sabha folder (2)');
  const items = win.getByTestId('open-playlist').getByTestId('playlist-item');
  // The playlist's whole order, as kept (Session 44: the window shows it a folder at a time).
  const shown = () =>
    win.evaluate(async () => {
      const open = document.querySelector('[data-testid="playlist-node"][data-open="true"]');
      const all = await (globalThis as PageGlobals).drashti.playlists.items(
        open?.getAttribute('data-node-id') ?? '',
      );
      return all.map((i) => (i.kind === 'header' ? `# ${i.label}` : i.label));
    });
  await expect
    .poll(shown, { timeout: 60_000 })
    .toEqual([
      'Opening video.mp4',
      'Welcome',
      '# Week 1',
      'Katha 2',
      'Katha 10',
      '# Week 1 › Videos',
      'Clip A.mp4',
      'Clip b.mp4',
      '# Week 1 › Videos › Deep',
      'Third.mp4',
    ]);
  // The PDFs and pictures wait (the .txt is not taken), until the one button.
  await expect(win.getByTestId('link-waiting-item')).toHaveText([
    'Notice.pdf',
    'Week 1/Handout.pdf',
    'Week 2/Darshan.png',
  ]);
  await expect(win.getByTestId('link-not-taken-item')).toHaveCount(1);
  await expect(win.getByTestId('link-not-taken-item')).toContainText('Read me.txt');
  await expectNoSeriousA11yIssues(
    win,
    'the link dialog with its waiting PDFs',
    '[data-testid="link-dialog"]',
  );
  await win.getByTestId('link-add-waiting').click();
  await expect(win.getByTestId('link-waiting-added')).toContainText('Added 3 PDFs and pictures', {
    timeout: 120_000,
  });
  // Each at the end of its folder's part.
  await expect
    .poll(shown, { timeout: 30_000 })
    .toEqual([
      'Opening video.mp4',
      'Welcome',
      'Notice',
      '# Week 1',
      'Katha 2',
      'Katha 10',
      'Handout',
      '# Week 1 › Videos',
      'Clip A.mp4',
      'Clip b.mp4',
      '# Week 1 › Videos › Deep',
      'Third.mp4',
      '# Week 2',
      'Darshan.png',
    ]);
  const report = win.getByTestId('import-report');
  if (await report.isVisible())
    await report.getByRole('button', { name: 'Close', exact: true }).first().click();
  await win.getByTestId('link-dialog').getByRole('button', { name: 'Close', exact: true }).click();

  // Shown a folder at a time (Session 44): the top folder's own items, its folders in the bottom left, as on
  // the computer; an item moves within its folder (Alt+↑).
  await expect(items.locator('[data-label]')).toHaveText(['Opening video.mp4', 'Welcome', 'Notice']);
  const folder = win.getByTestId('playlist-folder');
  await expect
    .poll(() => folder.evaluateAll((els) => els.map((e) => e.getAttribute('data-path'))))
    .toEqual(['Week 1', 'Week 2']);
  await folder.filter({ hasText: 'Week 1' }).click();
  await folder.filter({ hasText: 'Videos' }).click();
  await expect(items.locator('[data-label]')).toHaveText(['Clip A.mp4', 'Clip b.mp4']);
  // Chosen with Cmd/Ctrl, which only marks it: a plain click puts a video up (Session 54).
  await items.filter({ hasText: 'Clip b.mp4' }).click({ modifiers: [mod] });
  await win.keyboard.press('Alt+ArrowUp');
  await expect.poll(async () => (await shown()).indexOf('Clip b.mp4')).toBe(8);
  await expect(items.locator('[data-label]')).toHaveText(['Clip b.mp4', 'Clip A.mp4']);
  await app.close();
});
