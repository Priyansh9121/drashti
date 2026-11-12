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
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  type PageGlobals,
} from './helpers';
import { linkFinished, pasteLink } from './paste-link';
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

const conversionOf = (win: Page, name: string) =>
  win.evaluate(
    async (source) =>
      (await (globalThis as PageGlobals).drashti.media.conversions()).find((job) => job.name === source),
    name,
  );

function storedMedia(userData: string, id: string): string {
  const db = new Database(join(userData, 'drashti.sqlite'), { readonly: true });
  const row = db.prepare('SELECT path FROM media WHERE id = ?').get(id) as { path: string } | undefined;
  db.close();
  if (!row) throw new Error('The library has no row for the expected video');
  return join(userData, 'Media', row.path);
}

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

test('Dropbox: a file link and a folder link are pasted and imported from the default folder; on air holds it back', async () => {
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
  const chosen = join(work, 'Videos', 'Drashti downloads');
  const { app } = await launchApp({
    DRASHTI_TEST_LINK_ORIGIN: standIn.origin,
    DRASHTI_TEST_DOWNLOADS_DIR: downloads,
    DRASHTI_TEST_ON_AIR_HOOK: '1',
    // As if this computer had no Keynote or PowerPoint (CI's have neither), so the report says so.
    DRASHTI_TEST_NO_CONVERTER: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);

  await chooseMenuItem(app, 'import-from-link');
  const field = win.getByTestId('link-paste');
  await expect(field).toBeVisible();
  await expect(win.locator('[aria-modal="true"]')).toHaveCount(0);
  await expectNoSeriousA11yIssues(win, 'the link input', '[data-testid="link-paste"]');
  await pasteLink(win, 'https://example.net/scl/fi/abc/x.mp4', false);
  await expect(win.getByTestId('import-notice')).toContainText('Paste a share link from YouTube or Dropbox.');
  expect(standIn.requests).toHaveLength(0);

  // Dropbox's metadata can be read while streaming; the file itself waits.
  await setOnAir(app, true);
  await pasteLink(win, fileLink('clipAAAAAAAAAAA', 'Placeholder clip.mp4'));
  await expect(field).toHaveCount(0);
  const status = win.getByTestId('link-status');
  await expect(status).toHaveAttribute('data-phase', 'waiting');
  await expect(status).toContainText('Download waits');
  const asked = standIn.requests.length;
  await holdStill(() => standIn?.requests.length === asked, 2500, 'the file is not fetched on air');
  await setOnAir(app, false);
  await linkFinished(win);
  expect(readFileSync(join(chosen, 'Placeholder clip.mp4')).equals(clip)).toBe(true);
  await expect.poll(async () => (await listMedia(win)).map((m) => m.name)).toContain('Placeholder clip.mp4');
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder clip');

  await chooseMenuItem(app, 'import-from-link');
  await pasteLink(win, folderLink('foldAAAAAAAAAAA'));
  await linkFinished(win);
  const folder = join(chosen, 'Placeholder folder');
  expect(filesIn(folder)).toEqual(['Placeholder deck.pptx', 'Read me.txt', 'Videos/Placeholder 1080p.mp4']);
  expect(readFileSync(join(folder, 'Videos', 'Placeholder 1080p.mp4')).equals(full)).toBe(true);
  const notices = win.getByTestId('import-notice');
  await expect(notices.filter({ hasText: 'Read me.txt' })).toContainText('cannot be imported from a link');
  await expect(notices.filter({ hasText: 'Placeholder deck' })).toContainText('no Keynote or PowerPoint');
  await expect.poll(async () => (await listMedia(win)).map((m) => m.name)).toContain('Placeholder 1080p.mp4');
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder clip');
  const rows = win.getByTestId('open-playlist').getByTestId('playlist-item');
  await expect(rows.locator('[data-label]')).toHaveText([
    'Placeholder clip.mp4',
    'Videos',
    'Placeholder 1080p.mp4',
  ]);
  await expect(win.getByTestId('import-report')).toHaveCount(0);

  // Nothing of the downloads is left behind (no part-file, no work folder), and nothing was ever asked of
  // anything but Dropbox's own addresses (the stand-in, through the guard).
  expect(readdirSync(chosen).sort()).toEqual(['Placeholder clip.mp4', 'Placeholder folder']);
  for (const r of standIn.requests)
    expect(r.host).toMatch(/^(www\.dropbox\.com|uc\w+\.dl\.dropboxusercontent\.com)$/u);
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
  const chosen = join(work, 'Videos', 'Drashti downloads');
  const { app } = await launchApp({
    DRASHTI_TEST_LINK_ORIGIN: standIn.origin,
    DRASHTI_TEST_DOWNLOADS_DIR: join(work, 'Videos'),
    DRASHTI_TEST_NO_CONVERTER: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await chooseMenuItem(app, 'import-from-link');
  await pasteLink(win, folderLink('foldBBBBBBBBBBB'));
  await linkFinished(win);

  // Unpacked (alpha.3 refused it: "would leave the folder"), every subfolder kept.
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
  await expect(win.getByTestId('import-notice').filter({ hasText: 'सभा नोट्स.txt' })).toContainText(
    'cannot be imported from a link',
  );
  await expect(win.getByTestId('import-notice').filter({ hasText: 'Placeholder katha' })).toContainText(
    'no Keynote or PowerPoint',
  );
  await expect
    .poll(async () => (await listMedia(win)).map((m) => m.name).sort(), { timeout: 60_000 })
    .toEqual(expect.arrayContaining(['Opening video.mp4', 'પ્રવચન ભાગ 1.mp4']));
  await app.close();
});

test('Dropbox: a 4K file imports and another paste works while its 1080p copy waits for the show', async () => {
  test.setTimeout(240_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-link-e2e-'));
  const big = makeVideo(join(work, 'big.mp4'), '3840x2160');
  const small = makeVideo(join(work, 'small.mp4'), '320x180');
  const name = 'Placeholder 2160p.mp4';
  standIn = await dropboxStandIn(
    {
      bigAAAAAAAAAAAA: { name, body: big, type: 'video/mp4' },
      smallAAAAAAAAAA: { name: 'Placeholder other clip.mp4', body: small, type: 'video/mp4' },
    },
    {},
  );
  const chosen = join(work, 'Videos', 'Drashti downloads');
  const { app, userData } = await launchApp({
    DRASHTI_TEST_LINK_ORIGIN: standIn.origin,
    DRASHTI_TEST_DOWNLOADS_DIR: join(work, 'Videos'),
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await app.evaluate(({ shell }) => {
    shell.showItemInFolder = (path) => {
      (globalThis as { shown?: string[] }).shown = [
        ...((globalThis as { shown?: string[] }).shown ?? []),
        path,
      ];
    };
  });
  const still = await makeTestImage(win, join(work, 'Placeholder live picture.png'), { color: '#1e3a8a' });
  const [background = ''] = await importAndGetIds(win, [still]);
  expect(
    await win.evaluate(
      (mediaId) =>
        (globalThis as PageGlobals).drashti.engine.dispatch({
          type: 'setBackground',
          background: { kind: 'media', mediaId, media: 'image', fit: 'fit', loop: false },
        }),
      background,
    ),
  ).toMatchObject({ ok: true });

  await openLibrary(win);
  await win.getByTestId('library-sheet').getByRole('button', { name: 'Import…' }).click();
  await win.getByRole('menuitem', { name: 'From a Link…' }).click();
  await pasteLink(win, fileLink('bigAAAAAAAAAAAA', name));
  await linkFinished(win, 60_000);
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder 2160p');
  await expect(win.getByTestId('open-playlist').getByTestId('playlist-item')).toContainText(name);
  await expect
    .poll(() => conversionOf(win, name))
    .toMatchObject({
      maxHeight: 1080,
      state: 'waiting',
      note: 'Waits while the show is on, then carries on by itself.',
    });
  const conversion = win.getByTestId('link-conversion-status');
  await expect(conversion).toContainText('Waits while the show is on, then carries on by itself.');
  await expect(
    conversion.getByRole('button', { name: 'Stop converting Placeholder 2160p.mp4' }),
  ).toBeVisible();
  const original = (await listMedia(win)).find((item) => item.name === name);
  expect(original).toMatchObject({ convertedTo: null });
  expect(readFileSync(storedMedia(userData, original?.id ?? '')).equals(big)).toBe(true);
  await win.getByTestId('link-show-saved').click();
  await expect
    .poll(() => app.evaluate(() => (globalThis as { shown?: string[] }).shown ?? []))
    .toEqual([join(chosen, name)]);
  expect(readFileSync(join(chosen, name)).equals(big)).toBe(true);

  await chooseMenuItem(app, 'import-from-link');
  await pasteLink(win, fileLink('smallAAAAAAAAAA', 'Placeholder other clip.mp4'));
  await linkFinished(win, 60_000);
  await expect(
    win
      .getByTestId('open-playlist')
      .getByTestId('playlist-item')
      .filter({ hasText: 'Placeholder other clip.mp4' }),
  ).toBeVisible();
  const stillLive = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background,
  );
  expect(stillLive).toMatchObject({ kind: 'media', mediaId: background });
  expect(await conversionOf(win, name)).toMatchObject({ state: 'waiting', convertedId: null });

  await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearAll' }));
  await expect.poll(() => conversionOf(win, name), { timeout: 120_000 }).toMatchObject({ state: 'done' });
  const copy = await conversionOf(win, name);
  const stored = spawnSync(ffmpeg ?? '', [
    '-hide_banner',
    '-i',
    storedMedia(userData, copy?.convertedId ?? ''),
  ]);
  expect(stored.stderr.toString()).toMatch(/Video: h264/u);
  expect(stored.stderr.toString()).toMatch(/1920x1080/u);
  expect(readFileSync(join(chosen, name)).equals(big)).toBe(true);
  expect(
    existsSync(join(userData, 'Link downloads')) ? readdirSync(join(userData, 'Link downloads')) : [],
  ).toEqual([]);
  await app.close();
});

test('Dropbox: a saved 2160p setting does not lift the pasted link’s 1080p cap', async () => {
  test.setTimeout(240_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-link-e2e-'));
  const name = 'Placeholder 2160p.mp4';
  const big = makeVideo(join(work, 'big.mp4'), '3840x2160');
  standIn = await dropboxStandIn({ bigAAAAAAAAAAAA: { name, body: big, type: 'video/mp4' } }, {});
  const chosen = join(work, 'Videos', 'Drashti downloads');
  const { app, userData } = await launchApp({
    DRASHTI_TEST_LINK_ORIGIN: standIn.origin,
    DRASHTI_TEST_DOWNLOADS_DIR: join(work, 'Videos'),
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  expect(
    await win.evaluate(() => (globalThis as PageGlobals).drashti.links.setMaxHeight(2160)),
  ).toMatchObject({
    ok: true,
  });
  await chooseMenuItem(app, 'import-from-link');
  await pasteLink(win, fileLink('bigAAAAAAAAAAAA', name));
  await linkFinished(win);
  expect(readFileSync(join(chosen, name)).equals(big)).toBe(true);
  await expect
    .poll(() => conversionOf(win, name), { timeout: 120_000 })
    .toMatchObject({
      maxHeight: 1080,
      state: 'done',
    });
  const copy = await conversionOf(win, name);
  const db = new Database(join(userData, 'drashti.sqlite'), { readonly: true });
  const setting = db.prepare("SELECT value FROM app_meta WHERE key = 'setting.links.maxHeight'").get() as
    { value: string } | undefined;
  db.close();
  expect(setting?.value).toBe('2160');
  const stored = spawnSync(ffmpeg ?? '', [
    '-hide_banner',
    '-i',
    storedMedia(userData, copy?.convertedId ?? ''),
  ]);
  expect(stored.stderr.toString()).toMatch(/1920x1080/u);
  await app.close();
});

test('Dropbox: a missing saved folder falls back to Drashti downloads and says so once', async () => {
  test.setTimeout(180_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-link-fallback-e2e-'));
  const clip = makeVideo(join(work, 'clip.mp4'), '320x180');
  const name = 'Placeholder fallback.mp4';
  standIn = await dropboxStandIn({ clipAAAAAAAAAAA: { name, body: clip, type: 'video/mp4' } }, {});
  const chosen = join(work, 'Videos', 'Drashti downloads');
  const previous = join(work, 'Disconnected downloads');
  const { app } = await launchApp({
    DRASHTI_TEST_LINK_ORIGIN: standIn.origin,
    DRASHTI_TEST_DOWNLOADS_DIR: join(work, 'Videos'),
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, previous);
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.links.pickFolder())).toMatchObject({
    ok: true,
  });

  const url = fileLink('clipAAAAAAAAAAA', name);
  await chooseMenuItem(app, 'import-from-link');
  await pasteLink(win, url);
  await linkFinished(win, 60_000);
  const notice = win
    .getByTestId('import-notice')
    .filter({ hasText: 'The previous downloads folder couldn’t be used.' });
  await expect(notice).toContainText('Drashti downloads');
  expect(existsSync(previous)).toBe(false);
  expect(readFileSync(join(chosen, name)).equals(clip)).toBe(true);
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder fallback');
  await chooseMenuItem(app, 'import-from-link');
  await pasteLink(win, url);
  await linkFinished(win, 60_000);
  await expect(notice).toHaveCount(1);
  expect(readFileSync(join(chosen, 'Placeholder fallback (2).mp4')).equals(clip)).toBe(true);
  await app.close();
});

test('Dropbox: a folder link becomes one playlist, folder by folder, with headers; with PDFs and pictures included on the paste', async () => {
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
  const { app } = await launchApp({
    DRASHTI_TEST_LINK_ORIGIN: standIn.origin,
    DRASHTI_TEST_DOWNLOADS_DIR: join(work, 'Videos'),
    // The stand-in saves the .pptx files as PDF, as PowerPoint would (CI has no PowerPoint).
    DRASHTI_TEST_DECK_CONVERTER: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
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
    // A folder with only a picture still gets a part and its header.
    { path: 'Week 2/Darshan.png', data: readFileSync(picture) },
  ]);
  folders['foldCCCCCCCCCCC'] = { name: 'Placeholder Sabha folder.zip', body: zip, type: 'application/zip' };
  // A playlist already named like the folder: the new one is "… (2)".
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.playlists.create('Placeholder Sabha folder', null, false),
  );
  await chooseMenuItem(app, 'import-from-link');
  await pasteLink(win, folderLink('foldCCCCCCCCCCC'));

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
  await expect(win.getByTestId('link-add-waiting')).toHaveCount(0);
  await expect(win.getByTestId('import-notice').filter({ hasText: 'Read me.txt' })).toBeVisible();
  await expect(win.getByTestId('import-report')).toHaveCount(0);
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
