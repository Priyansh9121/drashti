import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestPptx } from '../../src/main/import/testing/make-pptx';
import { makeDropboxLikeZip } from '../../src/main/import/testing/zip-writer';
import { expectNoSeriousA11yIssues } from './a11y';
import { dropboxStandIn, folderLink, type StandIn, type StandInFile } from './dropbox-stand-in';
import { holdStill, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { testFfmpeg } from './stream-helpers';
import { makeTestImage, makeTestTone, makeTestVideo } from './test-media';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * From a Link…, whole, in Simple Mode (Session 56, the owner's item 11 of 11 Nov 2026: "Import from a Link, whole
 * (YouTube and Dropbox)"): Pro Mode's own dialog, every choice and word of it, through Simple Mode's guards on Main.
 * The highest video quality, a YouTube video's quality, the folder to save in and which playlist (or a new one) are
 * chosen there; a Dropbox folder becomes a playlist of its own, as in Pro Mode; Show in Finder (Explorer) and the
 * import report are there too. In CI's window, 1024 × 645, through the fake yt-dlp (tests/e2e/fake-yt-dlp.cjs) and a
 * local stand-in for Dropbox: never the internet, placeholder names and FFmpeg-made media only.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

const FAKE = join(__dirname, 'fake-yt-dlp.cjs');
const LINK = 'https://youtu.be/AAAAAAAAAAA?si=placeholderShare';

const view = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.links.view());
/** A playlist's rows as kept, a header as "# its words". */
const labels = (win: Page, playlistId: string) =>
  win.evaluate(
    async (id) =>
      (await (globalThis as PageGlobals).drashti.playlists.items(id)).map((i) =>
        i.kind === 'header' ? `# ${i.label}` : i.label,
      ),
    playlistId,
  );
/** What Show in Finder (Explorer) was asked to show, in order. */
const shownInFolder = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { shown?: string[] }).shown ?? []);

let standIn: StandIn | null = null;
test.afterEach(async () => {
  await standIn?.close();
  standIn = null;
});

/**
 * Drashti in CI's window, saving into a folder of the test's own: the system's folder dialog answers with it, and Show
 * in Finder (Explorer) says what it would show.
 */
async function open(env: Record<string, string>, chosen: string) {
  const { app } = await launchApp(env);
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  await app.evaluate(({ dialog, shell }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
    shell.showItemInFolder = (path) => {
      (globalThis as { shown?: string[] }).shown = [
        ...((globalThis as { shown?: string[] }).shown ?? []),
        path,
      ];
    };
  }, chosen);
  return { app, win };
}

/** Placeholder playlists made in Pro Mode, the first opened; then Simple Mode, which works on the one open. */
async function intoSimpleWith(win: Page, names: string[]): Promise<string[]> {
  const ids = await win.evaluate(async (list) => {
    const d = (globalThis as PageGlobals).drashti;
    const made: string[] = [];
    for (const name of list) {
      const one = await d.playlists.create(name, null, false);
      made.push(one.ok ? (one.ids[0] ?? '') : '');
    }
    return made;
  }, names);
  await win.getByTestId('playlist-node').filter({ hasText: names[0] }).click();
  await expect(win.getByTestId('playlist-title')).toHaveText(names[0] ?? '');
  await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).dblclick();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.app.simplePlaylist())).toBe(ids[0]);
  return ids;
}

/** The open playlist's own From a Link…, in Simple Mode's middle. */
async function fromALink(win: Page): Promise<void> {
  await win.getByTestId('simple-mode').getByTestId('column-middle').getByTestId('playlist-from-link').click();
  await expect(win.getByTestId('link-dialog')).toBeVisible();
}

test('YouTube in Simple Mode, as in Pro Mode: the highest video quality, a quality, the folder to save in and the playlist chosen; Show in Finder (Explorer) and the import report, which comes only when asked', async () => {
  test.setTimeout(300_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-simple-link-'));
  const chosen = join(work, 'Chosen folder');
  const log = join(work, 'fake.log');
  const { app, win } = await open(
    {
      DRASHTI_TEST_FAKE_YT_DLP: FAKE,
      // Slow enough (about 9 s) for the dialog to be closed while one goes.
      DRASHTI_TEST_FAKE_YT_DLP_CONFIG: JSON.stringify({
        log,
        title: 'Placeholder video',
        duration: 65,
        steps: 60,
        stepMs: 150,
      }),
      DRASHTI_TEST_DOWNLOADS_DIR: join(work, 'Videos'),
    },
    chosen,
  );
  const [sunday = '', youth = ''] = await intoSimpleWith(win, ['Placeholder Sunday', 'Placeholder Youth']);
  await fromALink(win);

  // The highest video quality, Pro Mode's setting, changed here: kept, and the qualities follow it.
  const highest = win.getByTestId('link-max-height');
  await expect(highest).toHaveValue('1080');
  await highest.selectOption('1440');
  await expect.poll(async () => (await view(win)).maxHeight).toBe(1440);
  await win.getByTestId('link-kind-youtube').click();
  await win.getByTestId('link-text').fill(LINK);
  await expect(win.getByTestId('link-name')).toHaveText('Placeholder video', { timeout: 60_000 });
  for (const h of [4320, 2160]) await expect(win.getByTestId(`link-quality-${String(h)}`)).toBeDisabled();
  await expect(win.getByTestId('link-quality-above')).toContainText('Above 1440p');
  // The tallest the setting allows to begin with; 720p chosen.
  await expect(win.getByTestId('link-quality-1440')).toHaveAttribute('aria-checked', 'true');
  await win.getByTestId('link-quality-720').click();
  await expect(win.getByTestId('link-quality-720')).toHaveAttribute('aria-checked', 'true');
  // Save in: the folder chosen in the system's dialog.
  await win.getByTestId('link-choose-folder').click();
  await expect(win.getByTestId('link-folder')).toHaveText(chosen);
  // Which playlist: the open one to begin with (its own From a Link…), another chosen instead.
  const target = win.getByTestId('link-add-to');
  await expect(target).toHaveValue(`playlist:${sunday}`);
  await expect(target.locator('option')).toHaveText([
    'Placeholder Sunday (open)',
    'Placeholder Youth',
    'A new playlist, “Placeholder video”',
    'No playlist',
  ]);
  await target.selectOption(`playlist:${youth}`);
  const download = win.getByTestId('link-download');
  await expect(download).toBeInViewport();
  await expectNoSeriousA11yIssues(
    win,
    'Import from a Link in Simple Mode, a YouTube video',
    '[data-testid="link-dialog"]',
  );
  await download.click();
  await expect(win.getByTestId('link-saved')).toBeVisible({ timeout: 120_000 });

  // Saved at 720p in the folder chosen, and into the playlist chosen, which is offered first next time; the open one
  // keeps what it had.
  expect(readdirSync(chosen)).toEqual(['Placeholder video.mp4']);
  expect(readFileSync(log, 'utf8')).toMatch(/^done mp4 720$/mu);
  await expect.poll(() => labels(win, youth), { timeout: 60_000 }).toEqual(['Placeholder video.mp4']);
  expect(await labels(win, sunday)).toEqual([]);
  await expect.poll(async () => (await view(win)).lastPlaylist).toBe(youth);

  // Show in Finder (Explorer on Windows): the main process lets it through, and shows the file saved.
  const show = win.getByTestId('link-show-saved');
  await expect(show).toHaveText(process.platform === 'darwin' ? 'Show in Finder' : 'Show in Explorer');
  await show.click();
  await expect.poll(() => shownInFolder(app)).toEqual([join(chosen, 'Placeholder video.mp4')]);

  // The import report, as in Pro Mode: the link dialog closes first; where the file was saved, with its own Show in
  // Finder (Explorer).
  await win.getByTestId('link-open-report').click();
  const report = win.getByTestId('import-report');
  await expect(report).toBeVisible();
  await expect(win.getByTestId('link-dialog')).toHaveCount(0);
  await expect(report.getByTestId('report-item').first()).toHaveAttribute('data-outcome', 'imported');
  await expect(report.getByTestId('report-saved-in')).toContainText('Chosen folder');
  await report.getByTestId('report-show-saved').click();
  await expect
    .poll(() => shownInFolder(app))
    .toEqual([join(chosen, 'Placeholder video.mp4'), join(chosen, 'Placeholder video.mp4')]);
  await expectNoSeriousA11yIssues(win, 'the import report in Simple Mode', '[data-testid="import-report"]');
  await report.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(report).toHaveCount(0);
  await expect(win.getByTestId('simple-mode')).toBeVisible();

  // Another, its sound only (MP3), the dialog closed while it downloads (the status bar says how it goes): it goes into
  // the playlist chosen, and its report comes only when asked, as for Simple Mode's other imports: the status bar's
  // Report opens it.
  await fromALink(win);
  await win.getByTestId('link-another').click();
  await win.getByTestId('link-kind-youtube').click();
  await win.getByTestId('link-text').fill(LINK);
  await expect(win.getByTestId('link-name')).toHaveText('Placeholder video', { timeout: 60_000 });
  await win.getByTestId('link-type-mp3').click();
  await target.selectOption(`playlist:${youth}`);
  await download.click();
  await expect(win.getByTestId('link-going')).toBeVisible();
  await win.getByTestId('link-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(win.getByTestId('link-dialog')).toHaveCount(0);
  await expect(win.getByTestId('link-status')).toBeVisible();
  await expect
    .poll(() => labels(win, youth), { timeout: 120_000 })
    .toEqual(['Placeholder video.mp4', 'Placeholder video.mp3']);
  await holdStill(
    async () => (await report.count()) === 0,
    1500,
    'in Simple Mode the report of a download comes only when asked',
  );
  await win.getByTestId('import-result').getByRole('button', { name: 'Report', exact: true }).click();
  await expect(report).toBeVisible();
  await expect(report.getByTestId('report-item').first()).toContainText('Placeholder video.mp3');
  await report.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(report).toHaveCount(0);
  await app.close();
});

test('a Dropbox folder link in Simple Mode becomes a playlist of its own, folder by folder, as in Pro Mode; the open playlist keeps what it had; its picture waits for one button; its report offers nothing Simple Mode has not', async () => {
  test.setTimeout(300_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-simple-link-folder-'));
  const made = join(work, 'made');
  mkdirSync(made);
  const chosen = join(work, 'Chosen folder');
  // Served once the zip is made (its picture and videos need the window and FFmpeg).
  const folders: Record<string, StandInFile> = {};
  standIn = await dropboxStandIn({}, folders);
  const { app, win } = await open(
    {
      DRASHTI_TEST_LINK_ORIGIN: standIn.origin,
      DRASHTI_TEST_DOWNLOADS_DIR: join(work, 'Videos'),
      // The stand-in saves the .pptx as PDF, as PowerPoint would (CI has no PowerPoint).
      DRASHTI_TEST_DECK_CONVERTER: '1',
    },
    chosen,
  );
  // Each video different (the library shares the rows of files with the same bytes).
  const video = async (name: string, hue: number) =>
    readFileSync(await makeTestVideo(win, join(made, name), { seconds: 1, h264: true, hue }));
  const picture = await makeTestImage(win, join(made, 'Placeholder picture.png'), { color: '#7c2d12' });
  const tone = makeTestTone(join(made, 'Placeholder tone.wav'), { seconds: 1, hz: 523 });
  folders['foldSSSSSSSSSSS'] = {
    name: 'Placeholder Sabha folder.zip',
    body: makeDropboxLikeZip([
      { path: 'Opening clip.mp4', data: await video('a.mp4', 30) },
      {
        path: 'Welcome.pptx',
        data: makeTestPptx([{ color: '1E3A8A', text: 'Placeholder welcome', notes: '' }]),
      },
      { path: 'Week 1/Second clip.mp4', data: await video('b.mp4', 200) },
      { path: 'Week 1/Placeholder tone.wav', data: readFileSync(tone) },
      { path: 'Week 1/Placeholder picture.png', data: readFileSync(picture) },
    ]),
    type: 'application/zip',
  };
  const [sunday = ''] = await intoSimpleWith(win, ['Placeholder Sunday']);
  await fromALink(win);
  await win.getByTestId('link-kind-dropbox').click();
  await win.getByTestId('link-text').fill(folderLink('foldSSSSSSSSSSS'));
  await expect(win.getByTestId('link-holds')).toContainText('A folder');
  // A folder becomes a playlist of its own, as Pro Mode says it: no playlist to choose for it.
  await expect(win.getByTestId('link-folder-playlist')).toContainText(
    'the folder becomes a playlist of its own, “Placeholder Sabha folder”',
  );
  await expect(win.getByTestId('link-add-to')).toHaveCount(0);
  await expect(win.getByTestId('link-max-height')).toBeVisible();
  await win.getByTestId('link-choose-folder').click();
  await expect(win.getByTestId('link-folder')).toHaveText(chosen);
  await win.getByTestId('link-download').click();

  // Made in the folders' order, a header before the folder inside; nothing went into the open playlist.
  await expect(win.getByTestId('link-playlist')).toContainText(
    'The folder is now the playlist Placeholder Sabha folder',
    { timeout: 180_000 },
  );
  const playlist = (await view(win)).playlist;
  expect(playlist?.name).toBe('Placeholder Sabha folder');
  const id = playlist?.id ?? '';
  expect(id).not.toBe(sunday);
  expect(
    (await win.evaluate(() => (globalThis as PageGlobals).drashti.playlists.tree())).find((n) => n.id === id)
      ?.isFolder,
  ).toBe(false);
  await expect
    .poll(() => labels(win, id), { timeout: 60_000 })
    .toEqual(['Opening clip.mp4', 'Welcome', '# Week 1', 'Second clip.mp4', 'Placeholder tone.wav']);
  expect(await labels(win, sunday)).toEqual([]);
  // Saved in a folder of its own in the folder chosen.
  await expect(win.getByTestId('link-saved-folder')).toHaveText(join(chosen, 'Placeholder Sabha folder'));
  expect(readdirSync(join(chosen, 'Placeholder Sabha folder')).sort()).toEqual([
    'Opening clip.mp4',
    'Week 1',
    'Welcome.pptx',
  ]);

  // Its picture waits for Add the PDFs and pictures, which puts it at the end of its folder's part.
  await expect(win.getByTestId('link-waiting-item')).toHaveText(['Week 1/Placeholder picture.png']);
  await win.getByTestId('link-add-waiting').click();
  await expect(win.getByTestId('link-waiting-added')).toContainText('Added 1 PDF or picture', {
    timeout: 120_000,
  });
  await expect
    .poll(() => labels(win, id), { timeout: 30_000 })
    .toEqual([
      'Opening clip.mp4',
      'Welcome',
      '# Week 1',
      'Second clip.mp4',
      'Placeholder tone.wav',
      'Placeholder picture.png',
    ]);
  expect(await labels(win, sunday)).toEqual([]);
  // Show in Finder (Explorer) and the import report, as in Pro Mode.
  await expect(win.getByTestId('link-show-saved')).toBeVisible();
  await expectNoSeriousA11yIssues(
    win,
    'Import from a Link in Simple Mode, a Dropbox folder done',
    '[data-testid="link-dialog"]',
  );
  await win.getByTestId('link-open-report').click();
  const report = win.getByTestId('import-report');
  await expect(report).toBeVisible();
  await expect(report.getByTestId('report-saved-in')).toContainText('Placeholder Sabha folder');
  // The folder's own import (its picture's came after it): the deck came in, and the report offers no Open for it, as
  // Simple Mode shows no presentation outside a playlist.
  const earlier = report.getByRole('combobox', { name: 'Earlier imports' });
  const folderRun = await earlier.locator('option', { hasText: 'presentation' }).getAttribute('value');
  await earlier.selectOption(folderRun ?? '');
  // Listed under Imported with notes and under Imported.
  const deck = report.getByTestId('report-item').filter({ hasText: 'Welcome' });
  await expect(deck).toHaveCount(2);
  await expect(deck.first()).toHaveAttribute('data-outcome', 'imported');
  await expect(report.getByRole('button', { name: 'Open', exact: true })).toHaveCount(0);
  await report.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await app.close();
});
