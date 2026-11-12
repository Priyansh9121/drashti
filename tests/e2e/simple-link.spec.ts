import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestPptx } from '../../src/main/import/testing/make-pptx';
import { makeDropboxLikeZip } from '../../src/main/import/testing/zip-writer';
import { expectNoSeriousA11yIssues } from './a11y';
import { clearOfShowControls, expectFits } from './fit';
import { dropboxStandIn, folderLink, type StandIn, type StandInFile } from './dropbox-stand-in';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { linkFinished, linkView as view, pasteLink } from './paste-link';
import { testFfmpeg } from './stream-helpers';
import { makeTestImage, makeTestTone, makeTestVideo } from './test-media';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Simple Mode uses the same one-field link import as Pro Mode. These tests use local stand-ins
 * and generated media at the CI operator size (1024 × 645).
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

const FAKE = join(__dirname, 'fake-yt-dlp.cjs');
const LINK = 'https://youtu.be/AAAAAAAAAAA?si=placeholderShare';

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

async function open(env: Record<string, string>) {
  const { app } = await launchApp(env);
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  await app.evaluate(({ shell }) => {
    shell.showItemInFolder = (path) => {
      (globalThis as { shown?: string[] }).shown = [
        ...((globalThis as { shown?: string[] }).shown ?? []),
        path,
      ];
    };
  });
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
  await expect(win.getByTestId('link-paste')).toBeVisible();
}

test('YouTube in Simple Mode imports to the open playlist at 1080p and can show the saved file', async () => {
  test.setTimeout(300_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-simple-link-'));
  const chosen = join(work, 'Videos', 'Drashti downloads');
  const log = join(work, 'fake.log');
  const { app, win } = await open({
    DRASHTI_TEST_FAKE_YT_DLP: FAKE,
    DRASHTI_TEST_FAKE_YT_DLP_CONFIG: JSON.stringify({
      log,
      title: 'Placeholder video',
      duration: 65,
    }),
    DRASHTI_TEST_DOWNLOADS_DIR: join(work, 'Videos'),
  });
  const [sunday = '', youth = ''] = await intoSimpleWith(win, ['Placeholder Sunday', 'Placeholder Youth']);
  expect(
    await win.evaluate(() => (globalThis as PageGlobals).drashti.links.setMaxHeight(1440)),
  ).toMatchObject({
    ok: true,
  });
  await fromALink(win);
  await expect(win.getByTestId('link-text')).toBeInViewport();
  const field = win.getByTestId('link-paste');
  await expectFits(field, 'the link input at 1024 × 645');
  await clearOfShowControls(win, field);
  await expectNoSeriousA11yIssues(win, 'the link input in Simple Mode', '[data-testid="link-paste"]');
  await expect(win.locator('[aria-modal="true"]')).toHaveCount(0);
  await pasteLink(win, LINK);
  await linkFinished(win);
  expect(readdirSync(chosen)).toEqual(['Placeholder video.mp4']);
  expect(readFileSync(log, 'utf8')).toMatch(/^done mp4 1080$/mu);
  await expect.poll(() => labels(win, sunday), { timeout: 60_000 }).toEqual(['Placeholder video.mp4']);
  expect(await labels(win, youth)).toEqual([]);

  const show = win.getByTestId('link-show-saved');
  await expect(show).toHaveText(process.platform === 'darwin' ? 'Show in Finder' : 'Show in Explorer');
  await show.click();
  await expect.poll(() => shownInFolder(app)).toEqual([join(chosen, 'Placeholder video.mp4')]);
  await expect(win.getByTestId('import-report')).toHaveCount(0);
  await expect(win.getByRole('button', { name: 'Report', exact: true })).toHaveCount(0);
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await app.close();
});

test('a Dropbox folder link in Simple Mode adds videos, decks, sounds and pictures to the open playlist in folder order', async () => {
  test.setTimeout(300_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-simple-link-folder-'));
  const made = join(work, 'made');
  mkdirSync(made);
  const chosen = join(work, 'Videos', 'Drashti downloads');
  // Served once the zip is made (its picture and videos need the window and FFmpeg).
  const folders: Record<string, StandInFile> = {};
  standIn = await dropboxStandIn({}, folders);
  const { app, win } = await open({
    DRASHTI_TEST_LINK_ORIGIN: standIn.origin,
    DRASHTI_TEST_DOWNLOADS_DIR: join(work, 'Videos'),
    DRASHTI_TEST_DECK_CONVERTER: '1',
  });
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
  await pasteLink(win, folderLink('foldSSSSSSSSSSS'));
  await linkFinished(win);
  expect((await view(win)).playlist).toBeNull();
  await expect
    .poll(() => labels(win, sunday), { timeout: 60_000 })
    .toEqual([
      'Opening clip.mp4',
      'Welcome',
      '# Week 1',
      'Second clip.mp4',
      'Placeholder tone.wav',
      'Placeholder picture.png',
    ]);
  expect(readdirSync(join(chosen, 'Placeholder Sabha folder')).sort()).toEqual([
    'Opening clip.mp4',
    'Week 1',
    'Welcome.pptx',
  ]);
  await expect(win.getByTestId('link-add-waiting')).toHaveCount(0);
  await expect(win.getByTestId('import-report')).toHaveCount(0);
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await app.close();
});
